import { Telegraf } from 'telegraf';
import { AI_MODEL, openai } from '../services/ai.service';
import { SHOREKEEPER_PROMPT } from '../config/persona';
import { formatLocal, isTime } from '../config/timezone';
import { db } from '../database/connection';
import { getResources, getNodesStatus } from '../services/proxmox.service';
import { sshExecSafe } from '../services/ssh.service';
import { getAllAliases, getAliasFromDB, getMonitorServers, getSetting, setSetting } from '../database/queries';
import { collectServerLogs, analyzeLogsWithAI, ServerLog } from './logAggregator.job';
import { getUptimeHistory, calculateUptimePct, UptimeHistoryService } from '../services/uptimeHistory.service';

// ─────────────────────────────────────────────
// SCHEDULE STATE — bisa diupdate runtime
// ─────────────────────────────────────────────

type ReportSession = 'pagi' | 'malam';
type ReportSchedule = { hour: number; minute: number; enabled: boolean };
export type ReportDestination = { chatId: string; enabled: boolean; title?: string };

let reportSchedule: Record<ReportSession, ReportSchedule> = {
    pagi:  { hour: 9,  minute: 0, enabled: true },
    malam: { hour: 18, minute: 0, enabled: true },
};
let defaultReportChatId = '';

export const getReportSchedule = () => reportSchedule;

export const getReportDestinations = async (): Promise<ReportDestination[]> => {
    const [[rows], [groupRows]] = await Promise.all([
        db.execute('SELECT chat_id, enabled FROM report_subscribers'),
        db.execute('SELECT chat_id, title FROM telegram_groups WHERE active = 1'),
    ]);
    const enabledById = new Map(
        (rows as Array<{ chat_id: string | number; enabled: number | boolean | string }>)
            .map(row => [String(row.chat_id), row.enabled === true || row.enabled === 1 || row.enabled === '1']),
    );
    const titles = new Map(
        (groupRows as Array<{ chat_id: string | number; title: string }>)
            .map(row => [String(row.chat_id), row.title]),
    );
    const destinations = new Set([defaultReportChatId, ...titles.keys(), ...enabledById.keys()]);
    return [...destinations].filter(Boolean).map(chatId => ({
        chatId,
        enabled: enabledById.get(chatId) ?? chatId === defaultReportChatId,
        title: titles.get(chatId),
    }));
};

export const setReportDestination = async (chatId: string, enabled: boolean): Promise<void> => {
    await db.execute(
        `INSERT INTO report_subscribers (chat_id, enabled) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)`,
        [chatId, enabled ? 1 : 0],
    );
};

const sendReportToDestinations = async (bot: Telegraf, report: string): Promise<void> => {
    const destinations = (await getReportDestinations()).filter(destination => destination.enabled);
    if (!destinations.length) {
        console.warn('⚠️ Laporan terjadwal tidak dikirim: belum ada tujuan laporan aktif.');
        return;
    }
    await Promise.all(destinations.map(async ({ chatId }) => {
        try {
            await bot.telegram.sendMessage(chatId, report);
        } catch (error) {
            console.error(`Gagal mengirim laporan ke Telegram chat ${chatId}:`, error);
        }
    }));
};

export const updateReportSchedule = async (
    session: ReportSession, hour: number, minute: number
) => {
    if (!Number.isInteger(hour) || hour < 0 || hour > 23
        || !Number.isInteger(minute) || minute < 0 || minute > 59) {
        throw new Error('Jam jadwal laporan tidak valid.');
    }
    await setSetting(`report_${session}`, `${hour}:${minute}`);
    reportSchedule[session] = { ...reportSchedule[session], hour, minute };
};

export const updateReportScheduleEnabled = async (session: ReportSession, enabled: boolean) => {
    await setSetting(`report_${session}_enabled`, String(enabled));
    reportSchedule[session].enabled = enabled;
};

export const loadReportSchedule = async () => {
    const pagi  = await getSetting('report_pagi');
    const malam = await getSetting('report_malam');
    const pagiEnabled = await getSetting('report_pagi_enabled');
    const malamEnabled = await getSetting('report_malam_enabled');
    if (pagi) {
        const [hour, minute] = pagi.split(':').map(Number);
        if (Number.isInteger(hour) && hour >= 0 && hour <= 23
            && Number.isInteger(minute) && minute >= 0 && minute <= 59) {
            reportSchedule.pagi.hour = hour;
            reportSchedule.pagi.minute = minute;
        } else {
            console.warn(`⚠️ Jadwal laporan pagi di database tidak valid: ${pagi}`);
        }
    }
    if (malam) {
        const [hour, minute] = malam.split(':').map(Number);
        if (Number.isInteger(hour) && hour >= 0 && hour <= 23
            && Number.isInteger(minute) && minute >= 0 && minute <= 59) {
            reportSchedule.malam.hour = hour;
            reportSchedule.malam.minute = minute;
        } else {
            console.warn(`⚠️ Jadwal laporan malam di database tidak valid: ${malam}`);
        }
    }
    if (pagiEnabled === 'true' || pagiEnabled === 'false') {
        reportSchedule.pagi.enabled = pagiEnabled === 'true';
    }
    if (malamEnabled === 'true' || malamEnabled === 'false') {
        reportSchedule.malam.enabled = malamEnabled === 'true';
    }
    if (pagiEnabled && pagiEnabled !== 'true' && pagiEnabled !== 'false') {
        console.warn(`⚠️ Status jadwal laporan pagi di database tidak valid: ${pagiEnabled}`);
    }
    if (malamEnabled && malamEnabled !== 'true' && malamEnabled !== 'false') {
        console.warn(`⚠️ Status jadwal laporan malam di database tidak valid: ${malamEnabled}`);
    }
    const p = reportSchedule.pagi;
    const m = reportSchedule.malam;
    console.log(
        `📋 Jadwal laporan: pagi ${p.enabled ? 'aktif' : 'nonaktif'} ${p.hour}:${String(p.minute).padStart(2,'0')}, ` +
        `malam ${m.enabled ? 'aktif' : 'nonaktif'} ${m.hour}:${String(m.minute).padStart(2,'0')}`
    );
};

// ─────────────────────────────────────────────
// KUMPULKAN RINGKASAN SERVER
// ─────────────────────────────────────────────

const getServerSummary = async (server: any) => {
    const cfg = { host: server.host, port: server.port, username: server.username, password: server.password };
    try {
        const [cpuOut, ramOut, diskOut, uptimeOut] = await Promise.all([
            sshExecSafe(cfg, "awk '/^cpu / {idle=$5; total=$2+$3+$4+$5+$6+$7+$8; printf \"%.1f\", 100-(idle/total*100)}' /proc/stat"),
            sshExecSafe(cfg, "free | awk '/^Mem:/ {printf \"%.0f/%.0f MB (%.0f%%)\", $3/1024, $2/1024, $3/$2*100}'"),
            sshExecSafe(cfg, "df -h / | awk 'NR==2 {print $3\"/\"$2\" (\"$5\")'\""),
            sshExecSafe(cfg, "uptime -p 2>/dev/null || uptime"),
        ]);
        return { alias: server.alias, cpu: `${cpuOut}%`, ram: ramOut, disk: diskOut, uptime: uptimeOut };
    } catch (err: any) {
        return { alias: server.alias, cpu: '-', ram: '-', disk: '-', uptime: '-', error: err.message };
    }
};

// ─────────────────────────────────────────────
// BUILD LAPORAN HARIAN
// ─────────────────────────────────────────────

export const buildDailyReport = async (session: 'pagi' | 'malam'): Promise<string> => {
    const waktu = formatLocal(new Date(), { dateStyle: 'full', timeStyle: 'short' });
    const sesi  = session === 'pagi' ? 'Laporan Pagi' : 'Laporan Malam';

    // Proxmox section
    let proxmoxSection = '';
    try {
        const [resources, nodeStatus] = await Promise.all([getResources(), getNodesStatus()]);
        const running = resources.filter((r: any) => r.status === 'running').length;
        const stopped = resources.filter((r: any) => r.status !== 'running').length;
        proxmoxSection = `PROXMOX CLUSTER\nVM/LXC Running: ${running}\nVM/LXC Stopped: ${stopped}\nTotal: ${resources.length}\n\n${nodeStatus}`;
    } catch {
        proxmoxSection = 'PROXMOX: Tidak dapat dihubungi';
    }

    // Server SSH section
    let serverSection = '';
    const monitorList = await getMonitorServers();
    if (monitorList.length) {
        const allAliases  = await getAllAliases();
        const servers     = allAliases.filter((a: any) => monitorList.includes(a.alias));
        const fullServers = await Promise.all(servers.map((s: any) => getAliasFromDB(s.alias)));
        const valid       = fullServers.filter(Boolean);
        const summaries   = await Promise.all(valid.map(getServerSummary));

        serverSection = 'STATUS SERVER\n' + summaries.map((s: any) => {
            if (s.error) return `${s.alias}: Tidak dapat dihubungi`;
            return `${s.alias}\n  CPU: ${s.cpu} | RAM: ${s.ram}\n  Disk: ${s.disk} | Uptime: ${s.uptime}`;
        }).join('\n\n');

        const serverLogs: ServerLog[] = await Promise.all(valid.map(collectServerLogs));
        const logAnalysis = await analyzeLogsWithAI(serverLogs);
        serverSection += `\n\nANALISIS LOG 24 JAM TERAKHIR\n${logAnalysis}`;
    } else {
        serverSection = 'SERVER SSH: Belum ada server di daftar monitor.';
    }

    const rawReport = `${sesi} — ${waktu}\n\n${proxmoxSection}\n\n${serverSection}`;

    try {
        const res = await openai.chat.completions.create({
            model: AI_MODEL,
            messages: [
                { role: 'system', content: SHOREKEEPER_PROMPT },
                {
                    role: 'user',
                    content: `SK menyampaikan laporan ${session} infrastruktur kepada ${process.env.ADMIN_NAME || 'Irvan'}.\n\nData:\n${rawReport.slice(0, 6000)}\n\nSampaikan dengan gaya SK yang tenang dan informatif. Jangan gunakan karakter Markdown.`,
                },
            ],
            max_tokens: 1500,
        });
        return res.choices[0]?.message?.content || rawReport;
    } catch {
        return rawReport;
    }
};

// ─────────────────────────────────────────────
// BUILD LAPORAN MINGGUAN DENGAN ANALITIK & REKOMENDASI
// ─────────────────────────────────────────────

export const buildWeeklyReport = async (): Promise<string> => {
    const waktu = formatLocal(new Date(), { dateStyle: 'full', timeStyle: 'short' });

    // Kumpulkan data tren uptime
    const monitorList = await getMonitorServers();
    let uptimeAnalysis = '';
    if (monitorList.length) {
        const allAliases = await getAllAliases();
        const servers = allAliases.filter((a: any) => monitorList.includes(a.alias));
        const fullServers = await Promise.all(servers.map((s: any) => getAliasFromDB(s.alias)));
        const valid = fullServers.filter(Boolean);

        const uptimeData = await Promise.all(valid.map(async (s: any) => {
            const pct = await calculateUptimePct(s.alias, 7);
            const history = await getUptimeHistory(s.alias, 7);
            const downCount = history.filter((h: any) => h.status === 'down').length;
            return { alias: s.alias, uptimePct: pct, downEvents: downCount };
        }));

        uptimeAnalysis = uptimeData.map(d =>
            `${d.alias}: Uptime ${d.uptimePct.toFixed(1)}% (${d.downEvents} kali down dalam 7 hari)`
        ).join('\n');
    }

    // Analisis Proxmox (jika ada data historis, tapi untuk sederhana gunakan status terkini)
    let proxmoxAnalysis = '';
    try {
        const [resources, nodeStatus] = await Promise.all([getResources(), getNodesStatus()]);
        const running = resources.filter((r: any) => r.status === 'running').length;
        const total = resources.length;
        proxmoxAnalysis = `Proxmox: ${running}/${total} VM/LXC running. ${nodeStatus}`;
    } catch {
        proxmoxAnalysis = 'Proxmox: Tidak dapat dianalisis.';
    }

    // Data mentah untuk AI
    const rawData = `UPTIME TREN 7 HARI:\n${uptimeAnalysis}\n\nPROXMOX STATUS:\n${proxmoxAnalysis}`;

    // Gunakan AI untuk analisis dan rekomendasi
    try {
        const res = await openai.chat.completions.create({
            model: AI_MODEL,
            messages: [
                { role: 'system', content: SHOREKEEPER_PROMPT },
                {
                    role: 'user',
                    content: `SK membuat laporan mingguan analitik infrastruktur untuk ${process.env.ADMIN_NAME || 'Irvan'}.\n\nData Tren:\n${rawData}\n\nAnalisis tren uptime, identifikasi pola masalah (misalnya server yang sering down), dan berikan rekomendasi preventif untuk meningkatkan stabilitas. Jangan gunakan Markdown.`,
                },
            ],
            max_tokens: 1000,
        });
        return `📊 Laporan Mingguan Analitik — ${waktu}\n\n${res.choices[0]?.message?.content || rawData}`;
    } catch {
        return `📊 Laporan Mingguan Analitik — ${waktu}\n\n${rawData}`;
    }
};

// ─────────────────────────────────────────────
// INIT REPORTER JOB
// ─────────────────────────────────────────────

export const initReporterJob = async (bot: Telegraf, chatId: string) => {
    defaultReportChatId = chatId;
    await db.execute(
        'INSERT IGNORE INTO report_subscribers (chat_id, enabled) VALUES (?, 1)',
        [chatId],
    );
    await loadReportSchedule();

    // Laporan harian
    setInterval(async () => {
        try {
            const { pagi, malam } = getReportSchedule();
            if (pagi.enabled && isTime(pagi.hour, pagi.minute)) {
                const report = await buildDailyReport('pagi');
                await sendReportToDestinations(bot, report);
            }
            if (malam.enabled && isTime(malam.hour, malam.minute)) {
                const report = await buildDailyReport('malam');
                await sendReportToDestinations(bot, report);
            }
        } catch (err: any) {
            console.error('Reporter error:', err.message);
        }
    }, 60_000);

    // Laporan mingguan (setiap Senin pukul 9 pagi)
    setInterval(async () => {
        try {
            const now = new Date();
            if (now.getDay() === 1 && now.getHours() === 9 && now.getMinutes() === 0) { // Senin 09:00
                const report = await buildWeeklyReport();
                await sendReportToDestinations(bot, report);
            }
        } catch (err: any) {
            console.error('Weekly reporter error:', err.message);
        }
    }, 60_000);
};