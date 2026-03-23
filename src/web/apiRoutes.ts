import { Router } from 'express';
import fetch2 from 'node-fetch';
import { sessions, requireAuth, requireAdmin, checkGuestLimit, GUEST_LIMIT, createSession,
    checkLoginAttempt, recordFailedLogin, resetLoginAttempt } from './authMiddleware';
import {
    saveChat, getChatContext, getAllAliases, getAliasFromDB,
    addReminder, getActiveReminders, deactivateReminder,
    addNote, getNotes, getNoteById, searchNotes, deleteNote,
} from '../database/queries';
import { db } from '../database/connection';
import { getReportSchedule, updateReportSchedule } from '../jobs/reporter';
import { getCurrentMood, getMoodEmoji } from '../config/mood';
import { getUptimeSummary, getUptimeHistory, calculateUptimePct, UptimeHistoryService } from '../services/uptimeHistory.service';
import { listContainers, controlContainer, getContainerLogs, DockerService } from '../services/docker.service';
import {
    getAllClusters, addCluster, removeCluster,
    testClusterConnection, getNodesStatus, getResources,
} from '../services/proxmox.service';

export const router = Router();

const UID = () => parseInt(process.env.MY_CHAT_ID || '0');

// ─────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────

router.post('/login', (req, res) => {
    // Ambil IP — support proxy (Nginx, Cloudflare, dll)
    const ip = (
        req.headers['cf-connecting-ip'] ||
        req.headers['x-real-ip'] ||
        req.headers['x-forwarded-for']?.toString().split(',')[0].trim() ||
        req.socket.remoteAddress ||
        'unknown'
    ) as string;

    // Cek brute force
    const attempt = checkLoginAttempt(ip);
    if (!attempt.allowed) {
        console.warn(`🚫 Login blocked: ${ip} (locked ${attempt.retryAfter}s)`);
        return (res as any).status(429).json({
            ok: false,
            message: `Terlalu banyak percobaan gagal. Coba lagi dalam ${Math.ceil((attempt.retryAfter || 0) / 60)} menit.`,
        });
    }

    const { username, password } = req.body;
    if (!username || !password) {
        return (res as any).status(400).json({ ok: false, message: 'Username dan password wajib diisi.' });
    }

    const ADMIN_USER  = process.env.WEB_ADMIN_USER     || 'admin';
    const WEB_PASS    = process.env.WEB_PASSWORD       || 'shorekeeper';
    const GUEST_USER  = process.env.WEB_GUEST_USER     || 'demo';
    const GUEST_PASS  = process.env.WEB_GUEST_PASSWORD || 'demo';

    let role: 'admin' | 'guest' | null = null;
    if (username === ADMIN_USER && password === WEB_PASS)        role = 'admin';
    else if (username === GUEST_USER && password === GUEST_PASS) role = 'guest';

    if (!role) {
        recordFailedLogin(ip);
        const updated = checkLoginAttempt(ip);
        const msg = updated.remaining > 0
            ? `Username atau password salah. (${updated.remaining} percobaan tersisa)`
            : `Akun terkunci 15 menit karena terlalu banyak percobaan gagal.`;
        return (res as any).status(401).json({ ok: false, message: msg });
    }

    // Login berhasil — reset counter
    resetLoginAttempt(ip);
    const token = createSession(role, username);
    console.log(`✅ Login: ${username} (${role}) dari ${ip}`);
    return (res as any).json({ ok: true, token, role });
});

router.get('/verify', (req, res) => {
    const token   = req.headers.authorization?.replace('Bearer ', '');
    const session = token ? sessions.get(token) : null;
    return (res as any).json({ ok: !!session, role: session?.role || null });
});

router.post('/logout', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) sessions.delete(token);
    return (res as any).json({ ok: true });
});

router.get('/guest-info', (req, res) => {
    const session = requireAuth(req, res);
    if (!session || session.role !== 'guest') return;
    const today = new Date().toISOString().slice(0, 10);
    const entry = (req as any).guestCounter?.get(session.username);
    const used  = (entry && entry.date === today) ? entry.count : 0;
    return (res as any).json({ ok: true, remaining: Math.max(0, GUEST_LIMIT - used), limit: GUEST_LIMIT, used });
});

// ─────────────────────────────────────────────
// TTS (admin only)
// ─────────────────────────────────────────────

router.post('/tts', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { text } = req.body;
    if (!text) return (res as any).status(400).json({ ok: false });
    const ELEVEN_KEY   = process.env.ELEVENLABS_API_KEY;
    const ELEVEN_VOICE = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';
    if (!ELEVEN_KEY) return (res as any).status(503).json({ ok: false, message: 'ElevenLabs API key belum diset.' });
    try {
        const cleanText = text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').trim().slice(0, 500);
        const response  = await fetch2(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE}/stream`, {
            method:  'POST',
            headers: { 'xi-api-key': ELEVEN_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
            body:    JSON.stringify({ text: cleanText, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
        });
        if (!response.ok) return (res as any).status(500).json({ ok: false, message: await response.text() });
        res.setHeader('Content-Type', 'audio/mpeg');
        (response.body as any).pipe(res);
    } catch (err: any) { (res as any).status(500).json({ ok: false, message: err.message }); }
});

// ─────────────────────────────────────────────
// MOOD
// ─────────────────────────────────────────────

router.get('/mood', (req, res) => {
    if (!requireAuth(req, res)) return;
    const mood = getCurrentMood();
    return (res as any).json({ ok: true, mood: mood.mood, expression: mood.expression, reason: mood.reason, emoji: getMoodEmoji(mood.mood) });
});

// ─────────────────────────────────────────────
// REMINDERS
// ─────────────────────────────────────────────

router.get('/reminders', async (req, res) => {
    if (!requireAuth(req, res)) return;
    return (res as any).json({ ok: true, reminders: await getActiveReminders(UID()) });
});

router.post('/reminders', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const { message, remindAt, repeatType } = req.body;
    if (!message || !remindAt) return (res as any).status(400).json({ ok: false, message: 'message dan remindAt wajib diisi.' });
    const id = await addReminder(UID(), message, new Date(remindAt), repeatType || 'none');
    return (res as any).json({ ok: !!id, id });
});

// EDIT reminder — ubah pesan dan/atau waktu
router.put('/reminders/:id', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const { message, remindAt, repeatType } = req.body;
    const id = parseInt(req.params.id);
    try {
        const fields: string[] = [];
        const values: any[]    = [];
        if (message)    { fields.push('message = ?');     values.push(message); }
        if (remindAt)   { fields.push('remind_at = ?');   values.push(new Date(remindAt)); }
        if (repeatType) { fields.push('repeat_type = ?'); values.push(repeatType); }
        if (!fields.length) return (res as any).status(400).json({ ok: false, message: 'Tidak ada yang diubah.' });
        values.push(id, UID());
        await db.execute(`UPDATE reminders SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, values);
        return (res as any).json({ ok: true });
    } catch (err: any) { return (res as any).status(500).json({ ok: false, message: err.message }); }
});

router.delete('/reminders/:id', async (req, res) => {
    if (!requireAuth(req, res)) return;
    await deactivateReminder(parseInt(req.params.id));
    return (res as any).json({ ok: true });
});

// ─────────────────────────────────────────────
// NOTES
// ─────────────────────────────────────────────

router.get('/notes', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const { tag, q } = req.query as any;
    const notes = q ? await searchNotes(UID(), q) : await getNotes(UID(), tag || undefined);
    return (res as any).json({ ok: true, notes });
});

router.get('/notes/:id', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const note = await getNoteById(parseInt(req.params.id), UID());
    if (!note) return (res as any).status(404).json({ ok: false, message: 'Catatan tidak ditemukan.' });
    return (res as any).json({ ok: true, note });
});

router.post('/notes', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const { title, content, tag } = req.body;
    if (!title || !content) return (res as any).status(400).json({ ok: false, message: 'title dan content wajib diisi.' });
    const id = await addNote(UID(), title, content, tag || 'general');
    return (res as any).json({ ok: !!id, id });
});

// EDIT note — ubah title, content, atau tag
router.put('/notes/:id', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const { title, content, tag } = req.body;
    const id = parseInt(req.params.id);
    try {
        const fields: string[] = [];
        const values: any[]    = [];
        if (title)   { fields.push('title = ?');   values.push(title); }
        if (content) { fields.push('content = ?'); values.push(content); }
        if (tag)     { fields.push('tag = ?');     values.push(tag); }
        if (!fields.length) return (res as any).status(400).json({ ok: false, message: 'Tidak ada yang diubah.' });
        values.push(id, UID());
        await db.execute(`UPDATE notes SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, values);
        return (res as any).json({ ok: true });
    } catch (err: any) { return (res as any).status(500).json({ ok: false, message: err.message }); }
});

router.delete('/notes/:id', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const ok = await deleteNote(parseInt(req.params.id), UID());
    return (res as any).json({ ok });
});

// ─────────────────────────────────────────────
// REPORT SCHEDULE
// ─────────────────────────────────────────────

router.get('/report-schedule', (req, res) => {
    if (!requireAuth(req, res)) return;
    const { pagi, malam } = getReportSchedule();
    return (res as any).json({
        ok:    true,
        pagi:  `${String(pagi.hour).padStart(2,'0')}:${String(pagi.minute).padStart(2,'0')}`,
        malam: `${String(malam.hour).padStart(2,'0')}:${String(malam.minute).padStart(2,'0')}`,
    });
});

router.post('/report-schedule', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const { pagi, malam } = req.body;
    if (pagi)  { const [h, m] = pagi.split(':').map(Number);  await updateReportSchedule('pagi',  h, m); }
    if (malam) { const [h, m] = malam.split(':').map(Number); await updateReportSchedule('malam', h, m); }
    return (res as any).json({ ok: true });
});

// ─────────────────────────────────────────────
// UPTIME
// ─────────────────────────────────────────────

router.get('/uptime', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const days    = parseInt((req.query as any).days || '7');
    const aliases = await getAllAliases();
    const summary = await getUptimeSummary(aliases.map((a: any) => a.alias), days);
    return (res as any).json({ ok: true, summary, days });
});

router.get('/uptime/:alias', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const { alias } = req.params;
    const days      = parseInt((req.query as any).days || '7');
    const [pct, events] = await Promise.all([
        calculateUptimePct(alias, days),
        getUptimeHistory(alias, days),
    ]);
    return (res as any).json({ ok: true, alias, uptimePct: pct, events, days });
});

// ─────────────────────────────────────────────
// PROXMOX CLUSTERS
// ─────────────────────────────────────────────

// GET semua cluster
router.get('/proxmox/clusters', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const clusters = await getAllClusters();
    return (res as any).json({ ok: true, clusters });
});

// POST tambah cluster baru
router.post('/proxmox/clusters', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { name, host, port, user, secret } = req.body;
    if (!name || !host || !port || !user || !secret) {
        return (res as any).status(400).json({ ok: false, message: 'Semua field wajib diisi.' });
    }
    // Test koneksi dulu
    const test = await testClusterConnection({ name, host, port: parseInt(port), user, token_id: 'shorekeeper', secret, token_secret: secret });
    if (!test.ok) {
        return (res as any).status(400).json({ ok: false, message: `Koneksi gagal: ${test.msg}` });
    }
    const id = await addCluster(name, host, parseInt(port), user, secret);
    return (res as any).json({ ok: !!id, id, version: test.msg });
});

// DELETE hapus cluster
router.delete('/proxmox/clusters/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const ok = await removeCluster(parseInt(req.params.id));
    return (res as any).json({ ok });
});

// GET test koneksi tanpa simpan
router.post('/proxmox/clusters/test', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { name, host, port, user, secret } = req.body;
    const test = await testClusterConnection({ name: name || 'test', host, port: parseInt(port), user, token_id: 'shorekeeper', secret, token_secret: secret });
    return (res as any).json(test);
});

// GET resources semua cluster
router.get('/proxmox/resources', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const resources = await getResources();
    return (res as any).json({ ok: true, resources });
});

// ─────────────────────────────────────────────
// DOCKER
// ─────────────────────────────────────────────

router.get('/docker/servers', async (req, res) => {
    if (!requireAuth(req, res)) return;
    return (res as any).json({ ok: true, aliases: await getAllAliases() });
});

router.post('/docker/containers', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const server = await getAliasFromDB(req.body.alias);
    if (!server) return (res as any).json({ ok: false, message: 'Server tidak ditemukan' });
    try {
        const result = await listContainers(server);
        return (res as any).json(result.error ? { ok: false, message: result.error } : { ok: true, containers: result.containers });
    } catch (err: any) { return (res as any).json({ ok: false, message: err.message }); }
});

router.post('/docker/action', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const server = await getAliasFromDB(req.body.alias);
    if (!server) return (res as any).json({ ok: false, message: 'Server tidak ditemukan' });
    try {
        await controlContainer(server, req.body.containerId, req.body.action);
        return (res as any).json({ ok: true });
    } catch (err: any) { return (res as any).json({ ok: false, message: err.message }); }
});

router.post('/docker/logs', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const server = await getAliasFromDB(req.body.alias);
    if (!server) return (res as any).json({ ok: false, message: 'Server tidak ditemukan' });
    try {
        const logs = await getContainerLogs(server, req.body.containerId);
        return (res as any).json({ ok: true, logs });
    } catch (err: any) { return (res as any).json({ ok: false, message: err.message }); }
});