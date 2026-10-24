import { WebSocketServer, WebSocket } from 'ws';
import { AI_MODEL, openai } from '../services/ai.service';
import { removeEmoji, SHOREKEEPER_PROMPT } from '../config/persona';
import { getCurrentMood, getMoodLabel, PRAISE_KEYWORDS } from '../config/mood';
import { saveChat, getChatContext, getAllAliases, getAliasFromDB } from '../database/queries';
import { getNodesStatus, getResources } from '../services/proxmox.service';
import { buildFullReport } from '../jobs/monitor.job';
import { buildDailyReport } from '../jobs/reporter.job';
import { localHour } from '../config/timezone';
import { runRemoteSSH, SSHService } from '../services/ssh.service';
import { listContainers, DockerService } from '../services/docker.service';
import {
    getSession,
} from './authMiddleware';

const ADMIN_NAME = () => process.env.ADMIN_NAME || 'Irvan';

// ─────────────────────────────────────────────
// DETEKSI EKSPRESI DARI REPLY SK
// ─────────────────────────────────────────────

const detectExpression = (text: string): string => {
    const t = text.toLowerCase();
    if (/gagal|error|anomali|masalah|rusak|down|offline/.test(t))          return 'surprised';
    if (/maaf|mohon maaf|aduh|khawatir/.test(t))                           return 'confused';
    if (/tidak yakin|mungkin|sepertinya|belum pasti/.test(t))              return 'confused';
    if (/berhasil|aman|stabil|aktif|online|normal|lancar|selesai/.test(t)) return 'heart';
    if (/waspada|peringatan|alert|threshold|hati-hati/.test(t))            return 'surprised';
    if (/laporan|status|summary|hasil|data|cpu|ram|disk/.test(t))          return 'star';
    return '';
};

// ─────────────────────────────────────────────
// BROADCAST MOOD KE SEMUA CLIENT
// ─────────────────────────────────────────────

const broadcastMood = (
    wss: WebSocketServer,
    mood: string,
    expression: string,
    label: string,
    reason: string
) => {
    wss.clients.forEach((client: WebSocket) => {
        if (client.readyState === WebSocket.OPEN && (client as any).shorekeeperAuthenticated) {
            client.send(JSON.stringify({ type: 'mood_update', mood, expression, label, reason }));
        }
    });
};

// ─────────────────────────────────────────────
// COMMAND HANDLER — dipanggil saat input dimulai "/"
// ─────────────────────────────────────────────

const handleCommand = async (cmd: string, args: string[]): Promise<string> => {
    const lines: string[] = [];

    // /help
    if (cmd === 'help' || cmd === '?') {
        return [
            '📋 Daftar Perintah SK:',
            '',
            '/ping              — Cek status semua server monitor',
            '/proxmox           — List VM & Container Proxmox',
            '/ssh               — List semua alias SSH',
            '/ssh [alias] [cmd] — Jalankan command di server',
            '/docker [alias]    — List container Docker',
            '/laporan           — Generate laporan sekarang',
            '/help              — Tampilkan daftar ini',
        ].join('\n');
    }

    // /ping atau /status
    if (cmd === 'ping' || cmd === 'status') {
        return await buildFullReport();
    }

    // /proxmox atau /pve
    if (cmd === 'proxmox' || cmd === 'pve') {
        const resources = await getResources();
        const run  = resources.filter((r: any) => r.status === 'running');
        const stop = resources.filter((r: any) => r.status !== 'running');
        lines.push(`🖥️ VM & Container (${resources.length} total)`);
        lines.push('');
        lines.push(`🟢 Running (${run.length}):`);
        run.forEach((r: any) => lines.push(`  • ${r.name} [${r.type.toUpperCase()}] ID:${r.vmid}`));
        if (stop.length) {
            lines.push('');
            lines.push(`🔴 Stopped (${stop.length}):`);
            stop.forEach((r: any) => lines.push(`  • ${r.name} [${r.type.toUpperCase()}] ID:${r.vmid}`));
        }
        return lines.join('\n');
    }

    // /laporan atau /report
    if (cmd === 'laporan' || cmd === 'report') {
        return await buildDailyReport(localHour() < 12 ? 'pagi' : 'malam');
    }

    // /ssh [alias] [command]
    if (cmd === 'ssh') {
        if (!args.length) {
            const aliases = await getAllAliases();
            if (!aliases.length) return 'Belum ada alias SSH.';
            lines.push(`🌐 Alias SSH (${aliases.length}):`);
            aliases.forEach((a: any) => lines.push(`  • ${a.alias} → ${a.host}`));
            return lines.join('\n');
        }

        const alias   = args[0];
        const command = args.slice(1).join(' ');

        if (!command) {
            return 'Format: /ssh [alias] [perintah]\nContoh: /ssh vps1 df -h';
        }

        const server = await getAliasFromDB(alias);
        if (!server) return `❌ Alias "${alias}" tidak ditemukan.`;

        const output = await runRemoteSSH({
            host:     server.host,
            port:     server.port,
            username: server.username,
            password: server.password,
        }, command, 30_000).catch((e: any) => `❌ Error: ${e.message}`);

        return `$ ${command}\n${output || '(tidak ada output)'}`;
    }

    // /docker [alias]
    if (cmd === 'docker') {
        if (!args.length) {
            const aliases = await getAllAliases();
            lines.push('Format: /docker [alias]');
            lines.push('Server tersedia:');
            aliases.forEach((a: any) => lines.push(`  • ${a.alias}`));
            return lines.join('\n');
        }

        const server = await getAliasFromDB(args[0]);
        if (!server) return `❌ Alias "${args[0]}" tidak ditemukan.`;

        const result = await listContainers(server);
        if (result.error) return `❌ ${result.error}`;
        if (!result.containers.length) return `🐳 ${args[0]}: tidak ada container.`;

        lines.push(`🐳 Docker — ${args[0]} (${result.containers.length} container):`);
        lines.push('');
        result.containers.forEach(c => {
            lines.push(`${c.running ? '🟢' : '🔴'} ${c.name}`);
            lines.push(`   Image : ${c.image}`);
            lines.push(`   Status: ${c.status}`);
        });
        return lines.join('\n');
    }

    return `❓ Perintah "/${cmd}" tidak dikenal.\nKetik /help untuk daftar perintah.`;
};

// ─────────────────────────────────────────────
// INIT WEBSOCKET
// ─────────────────────────────────────────────

export const initWebSocket = (wss: WebSocketServer) => {

    wss.on('connection', (ws: WebSocket) => {
        let authenticated = false;
        let webUserId     = parseInt(process.env.MY_CHAT_ID || '0');
        let sessionToken  = '';
        const authTimeout = setTimeout(() => {
            if (!authenticated) ws.close(1008, 'Authentication required');
        }, 10_000);

        ws.on('message', async (raw) => {
            try {
                const msg = JSON.parse(raw.toString());

                // ── AUTH ──
                if (msg.type === 'auth') {
                    const session = typeof msg.token === 'string'
                        ? getSession(`Bearer ${msg.token}`)
                        : null;
                    if (!session) {
                        ws.send(JSON.stringify({ type: 'auth', ok: false }));
                        ws.close();
                        return;
                    }

                    authenticated = true;
                    clearTimeout(authTimeout);
                    (ws as any).shorekeeperAuthenticated = true;
                    sessionToken  = msg.token;
                    const name    = ADMIN_NAME();

                    webUserId = parseInt(process.env.MY_CHAT_ID || '0');

                    const greeting = `Shorekeeper terhubung. Selamat datang kembali, Kak ${name}.`;

                    const mood = getCurrentMood();
                    ws.send(JSON.stringify({
                        type:       'auth',
                        ok:         true,
                        role:       'admin',
                        message:    greeting,
                        mood:       mood.mood,
                        expression: mood.expression,
                        moodLabel:  getMoodLabel(mood.mood),
                        adminName:  name,
                    }));
                    return;
                }

                if (!authenticated) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Tidak terautentikasi.' }));
                    return;
                }

                const chatSession = getSession(`Bearer ${sessionToken}`);
                if (!chatSession) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Sesi tidak valid.' }));
                    return;
                }

                // ── ACTION (tombol quick action, admin only) ──
                if (msg.type === 'action') {
                    ws.send(JSON.stringify({ type: 'typing', status: true }));
                    let result = '';
                    try {
                        if      (msg.action === 'status')  result = await getNodesStatus();
                        else if (msg.action === 'monitor') result = await buildFullReport();
                        else if (msg.action === 'laporan') result = await buildDailyReport(localHour() < 12 ? 'pagi' : 'malam');
                        else if (msg.action === 'proxmox') result = await handleCommand('proxmox', []);
                        else if (msg.action === 'ssh')     result = await handleCommand('ssh', []);
                    } catch (err: any) {
                        result = `Gagal: ${err.message}`;
                    }

                    ws.send(JSON.stringify({ type: 'typing', status: false }));
                    ws.send(JSON.stringify({ type: 'chat', role: 'assistant', content: result }));
                    return;
                }

                // ── CHAT ──
                if (msg.type === 'chat') {
                    const userInput = (msg.content || '').trim();
                    if (!userInput) return;

                    // ── COMMAND (admin only, dimulai dengan "/") ──
                    if (chatSession.role === 'admin' && userInput.startsWith('/')) {
                        const parts = userInput.slice(1).trim().split(/\s+/);
                        const cmd   = parts[0].toLowerCase();
                        const args  = parts.slice(1);

                        ws.send(JSON.stringify({ type: 'typing', status: true }));
                        let cmdResult = '';
                        try {
                            cmdResult = await handleCommand(cmd, args);
                        } catch (err: any) {
                            cmdResult = `❌ Error: ${err.message}`;
                        }
                        ws.send(JSON.stringify({ type: 'typing', status: false }));
                        ws.send(JSON.stringify({ type: 'chat', role: 'assistant', content: cmdResult }));
                        return;
                    }

                    // ── DETEKSI PUJIAN → MOOD MALU (admin only) ──
                    if (chatSession.role === 'admin') {
                        const isPraise = PRAISE_KEYWORDS.some((kw: string) => userInput.toLowerCase().includes(kw));
                        if (isPraise) {
                            broadcastMood(wss, 'hangat', 'heart', 'Hangat', 'Saya senang bisa membantu, Kak.');
                            setTimeout(() => {
                                const cur = getCurrentMood();
                                broadcastMood(wss, cur.mood, cur.expression, getMoodLabel(cur.mood), cur.reason);
                            }, 10_000);
                        }
                    }

                    // ── AI CHAT ──
                    ws.send(JSON.stringify({ type: 'typing', status: true }));

                    const history   = await getChatContext(webUserId);
                    const name      = ADMIN_NAME();

                    const messages = [
                        { role: 'system', content: SHOREKEEPER_PROMPT },
                        ...history.map((h: any) => ({ role: h.role, content: h.message })),
                        { role: 'user',   content: userInput },
                    ];

                    const completion = await openai.chat.completions.create({
                        model:      AI_MODEL,
                        messages:   messages as any,
                        max_tokens: 1024,
                    });

                    const reply = removeEmoji(
                        completion.choices[0]?.message?.content
                        || 'SK sedang mengalami gangguan koneksi. Silakan coba kembali sebentar lagi.',
                    );

                    await saveChat(webUserId, 'user', userInput);
                    await saveChat(webUserId, 'assistant', reply);

                    const expression = detectExpression(reply);
                    ws.send(JSON.stringify({ type: 'typing', status: false }));
                    ws.send(JSON.stringify({ type: 'chat', role: 'assistant', content: reply, expression }));
                }

            } catch (err: any) {
                console.error('WS Error:', err.message);
                try { ws.send(JSON.stringify({ type: 'error', message: 'Terjadi kesalahan.' })); } catch {}
            }
        });

        ws.on('close', () => clearTimeout(authTimeout));
        ws.on('error', (err) => console.error('WS connection error:', err.message));
    });
};