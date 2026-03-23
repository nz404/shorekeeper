import { Telegraf } from 'telegraf';
import { getResources } from '../services/proxmox.service';
import { sshExecSafe } from '../services/ssh.service';
import {
    getAllAliases,
    getAliasFromDB,
    getMonitorServers,
    addMonitorServer,
    removeMonitorServer,
} from '../database/queries';
import { TEKS, wrapWithSKVoice } from '../config/persona';
import { createPendingFix, AutoFixService } from '../services/autoFix.service';
import { updateMood, ServerStatus } from '../config/mood';
import { recordUptimeEvent, initServerStatus, UptimeHistoryService } from '../services/uptimeHistory.service';

// ─────────────────────────────────────────────
// SAFE EDIT — fallback ke reply jika gagal (bukan rekursif!)
// ─────────────────────────────────────────────

const safeEdit = async (ctx: any, text: string, extra?: any): Promise<any> => {
    try {
        return await ctx.editMessageText(text, extra);
    } catch (err: any) {
        if (err.message?.includes('message is not modified')) return;
        return ctx.reply(text, extra).catch(() => {});
    }
};

// ─────────────────────────────────────────────
// THRESHOLD (override via .env)
// ─────────────────────────────────────────────

const THRESHOLD = {
    cpu:  parseInt(process.env.MONITOR_CPU_THRESHOLD  || '80'),
    ram:  parseInt(process.env.MONITOR_RAM_THRESHOLD  || '85'),
    disk: parseInt(process.env.MONITOR_DISK_THRESHOLD || '90'),
};

const INTERVAL_MS = parseInt(process.env.MONITOR_INTERVAL_MS || '300000');

// ─────────────────────────────────────────────
// AMBIL METRIK SERVER VIA SSH
// ─────────────────────────────────────────────

interface Metric {
    alias:    string;
    cpu:      number;
    ramUsed:  number;
    ramTotal: number;
    ramPct:   number;
    disks:    { mount: string; usedPct: number }[];
    error?:   string;
}

const getMetrics = async (server: any): Promise<Metric> => {
    const cfg = { host: server.host, port: server.port, username: server.username, password: server.password };
    try {
        const [cpuOut, ramOut, diskOut] = await Promise.all([
            sshExecSafe(cfg, "awk '/^cpu / {idle=$5; total=$2+$3+$4+$5+$6+$7+$8; print 100-(idle/total*100)}' /proc/stat"),
            sshExecSafe(cfg, "free | awk '/^Mem:/ {printf \"%s %s\", $3, $2}'"),
            sshExecSafe(cfg, "df --output=pcent,target | tail -n +2 | grep -v tmpfs | grep -v udev"),
        ]);

        const cpu = parseFloat(cpuOut) || 0;
        const [usedKB, totalKB] = ramOut.split(' ').map(Number);
        const ramUsed  = Math.round(usedKB  / 1024);
        const ramTotal = Math.round(totalKB / 1024);
        const ramPct   = totalKB > 0 ? Math.round((usedKB / totalKB) * 100) : 0;
        const disks    = diskOut.split('\n')
            .map(line => {
                const p = line.trim().split(/\s+/);
                return { mount: p[1] || '/', usedPct: parseInt(p[0]) || 0 };
            })
            .filter(d =>
                d.usedPct > 0 &&
                !d.mount.includes('/overlay') &&
                !d.mount.includes('/snap') &&
                !d.mount.includes('/docker') &&
                !d.mount.startsWith('/var/lib/') &&
                d.mount.length < 30
            );

        return { alias: server.alias, cpu, ramUsed, ramTotal, ramPct, disks };

    } catch (err: any) {
        return {
            alias: server.alias, cpu: 0, ramUsed: 0, ramTotal: 0, ramPct: 0, disks: [],
            error: err.message?.includes('ECONNREFUSED') || err.message?.includes('ETIMEDOUT')
                ? 'Server tidak dapat dihubungi'
                : err.message,
        };
    }
};

// ─────────────────────────────────────────────
// FORMAT ALERT
// ─────────────────────────────────────────────

const buildAlertMessage = async (metrics: Metric[]): Promise<string | null> => {
    const alerts: string[] = [];

    for (const m of metrics) {
        if (m.error) { alerts.push(`🔴 *${m.alias}* — ${m.error}`); continue; }

        const lines: string[] = [];
        if (m.cpu > THRESHOLD.cpu)
            lines.push(`├ 🔥 CPU: \`${m.cpu.toFixed(1)}%\` (>${THRESHOLD.cpu}%)`);
        if (m.ramPct > THRESHOLD.ram)
            lines.push(`├ 💾 RAM: \`${m.ramUsed}/${m.ramTotal}MB (${m.ramPct}%)\` (>${THRESHOLD.ram}%)`);
        for (const d of m.disks) {
            if (d.usedPct > THRESHOLD.disk)
                lines.push(`├ 💿 Disk \`${d.mount}\`: \`${d.usedPct}%\` (>${THRESHOLD.disk}%)`);
        }
        if (lines.length) alerts.push(`⚠️ *${m.alias}*\n${lines.join('\n')}`);
    }

    if (!alerts.length) return null;

    const rawAlert = alerts.join('\n\n');
    return wrapWithSKVoice('alert', rawAlert);
};

// ─────────────────────────────────────────────
// LAPORAN MANUAL (buildFullReport)
// ─────────────────────────────────────────────

export const buildFullReport = async (): Promise<string> => {
    const monitorList = await getMonitorServers();
    if (!monitorList.length) return TEKS.monitorTidakAda();

    const allAliases   = await getAllAliases();
    const servers      = allAliases.filter((a: any) => monitorList.includes(a.alias));
    const fullServers  = await Promise.all(servers.map((s: any) => getAliasFromDB(s.alias)));
    const validServers = fullServers.filter(Boolean);

    if (!validServers.length) return '⚠️ Server monitor tidak ditemukan di daftar alias SSH.';

    const results = await Promise.all(validServers.map(getMetrics));
    let report    = '📊 *Laporan Monitor Server:*\n';

    for (const m of results) {
        if (m.error) { report += `\n🔴 *${m.alias}* — ${m.error}\n`; continue; }

        report += `\n🖥️ *${m.alias}*\n`;
        report += `├ ${m.cpu > THRESHOLD.cpu ? '🔥' : '✅'} CPU: \`${m.cpu.toFixed(1)}%\`\n`;
        report += `├ ${m.ramPct > THRESHOLD.ram ? '⚠️' : '✅'} RAM: \`${m.ramUsed}/${m.ramTotal}MB (${m.ramPct}%)\`\n`;
        if (m.disks.length) {
            const diskLines = m.disks.map(d =>
                `│  ${d.usedPct > THRESHOLD.disk ? '⚠️' : '✅'} \`${d.mount}\`: ${d.usedPct}%`
            ).join('\n');
            report += `└ Disk:\n${diskLines}\n`;
        }
    }

    return report;
};

// ─────────────────────────────────────────────
// MENU MANAJEMEN MONITOR (via Telegram)
// ─────────────────────────────────────────────

export const showMonitorMenu = async (ctx: any) => {
    const monitored  = await getMonitorServers();
    const allAliases = await getAllAliases();

    const monitoredStr = monitored.length
        ? monitored.map((a: string) => `• \`${a}\``).join('\n')
        : '_Belum ada server yang dimonitor_';

    const addButtons = allAliases
        .filter((a: any) => !monitored.includes(a.alias))
        .map((a: any) => ([{ text: `➕ ${a.alias}`, callback_data: `mon_add_${a.alias}` }]));

    const removeButtons = monitored.map((a: string) => ([{
        text:          `➖ ${a}`,
        callback_data: `mon_del_${a}`,
    }]));

    const menuText   = `🖥️ *Monitor Server*\n\nDimonitor:\n${monitoredStr}\n\nThreshold: CPU>${THRESHOLD.cpu}% | RAM>${THRESHOLD.ram}% | Disk>${THRESHOLD.disk}%`;
    const menuMarkup = {
        inline_keyboard: [
            ...addButtons,
            ...removeButtons,
            [{ text: '📊 Cek Sekarang', callback_data: 'mon_check' }],
            [{ text: '⬅️ Kembali',      callback_data: 'back_to_help' }],
        ],
    };

    return safeEdit(ctx, menuText, {
        parse_mode: 'Markdown',
        reply_markup: menuMarkup,
    });
};

// ─────────────────────────────────────────────
// HANDLER AKSI MONITOR
// ─────────────────────────────────────────────

export const handleMonitorAction = async (ctx: any, action: string, alias: string) => {
    if (action === 'add') {
        const server = await getAliasFromDB(alias);
        if (!server) return ctx.answerCbQuery(`❌ Alias ${alias} tidak ditemukan.`, { show_alert: true });
        await addMonitorServer(alias);
        await ctx.answerCbQuery(`✅ ${alias} ditambahkan ke monitor.`);
        return showMonitorMenu(ctx);
    }

    if (action === 'del') {
        await removeMonitorServer(alias);
        await ctx.answerCbQuery(`🗑️ ${alias} dihapus dari monitor.`);
        return showMonitorMenu(ctx);
    }

    if (action === 'check') {
        await ctx.answerCbQuery('🔍 Mengecek semua server...').catch(() => {});
        const report      = await buildFullReport();
        const checkMarkup = {
            inline_keyboard: [
                [{ text: '🔄 Refresh',   callback_data: 'mon_check'    }],
                [{ text: '⚙️ Kelola',    callback_data: 'menu_monitor' }],
                [{ text: '⬅️ Kembali',   callback_data: 'back_to_help' }],
            ],
        };
        return safeEdit(ctx, report, {
            parse_mode: 'Markdown',
            reply_markup: checkMarkup,
        });
    }
};

// ─────────────────────────────────────────────
// INIT MONITOR JOB
// ─────────────────────────────────────────────

let lastProxmoxStatus: Record<number, string> = {};

export const initMonitorJob = (bot: Telegraf, chatId: string) => {
    console.log(`🛡️ Monitor aktif | Proxmox: setiap 60s | SSH: setiap ${INTERVAL_MS / 1000}s`);

    // ── Monitor Proxmox VM on/off ──
    const checkProxmox = async () => {
        try {
            const resources = await getResources();
            for (const res of resources) {
                const id     = res.vmid;
                const status = res.status;

                if (lastProxmoxStatus[id] === 'running' && status === 'stopped') {
                    bot.telegram.sendMessage(chatId,
                        `⚠️ *VM/LXC ${res.name}* (ID: ${id}) offline!`,
                        { parse_mode: 'Markdown' }
                    );
                    await recordUptimeEvent(res.name, false);
                } else if (lastProxmoxStatus[id] === 'stopped' && status === 'running') {
                    bot.telegram.sendMessage(chatId,
                        `✅ *VM/LXC ${res.name}* (ID: ${id}) online kembali!`,
                        { parse_mode: 'Markdown' }
                    );
                    await recordUptimeEvent(res.name, true);
                }

                lastProxmoxStatus[id] = status;
            }
        } catch {}
    };

    // ── Monitor SSH threshold ──
    const checkSSHThreshold = async () => {
        try {
            const monitorList = await getMonitorServers();
            if (!monitorList.length) return;

            const allAliases  = await getAllAliases();
            const servers     = allAliases.filter((a: any) => monitorList.includes(a.alias));
            const fullServers = await Promise.all(servers.map((s: any) => getAliasFromDB(s.alias)));
            const valid       = fullServers.filter(Boolean);
            if (!valid.length) return;

            const results = await Promise.all(valid.map(getMetrics));

            // Update uptime history & mood
            const serverStatuses: ServerStatus[] = results.map(m => ({
                alias:   m.alias,
                online:  !m.error,
                cpu:     m.cpu,
                ram:     m.ramPct,
                disk:    m.disks.length ? Math.max(...m.disks.map(d => d.usedPct)) : 0,
                errors:  0,
            }));

            for (const m of results) {
                await recordUptimeEvent(m.alias, !m.error);
            }

            updateMood(serverStatuses);

            const alertMsg = await buildAlertMessage(results);
            if (alertMsg) await bot.telegram.sendMessage(chatId, alertMsg);

            // Trigger auto-fix untuk masalah yang terdeteksi
            for (const m of results) {
                if (m.error) {
                    await createPendingFix(bot, chatId, {
                        type:     'service_down',
                        severity: 'critical',
                        alias:    m.alias,
                        detail:   `Server ${m.alias} tidak dapat dihubungi: ${m.error}`,
                    }).catch(() => {});
                    continue;
                }

                if (m.cpu > THRESHOLD.cpu) {
                    await createPendingFix(bot, chatId, {
                        type:     'high_cpu',
                        severity: m.cpu > 95 ? 'critical' : 'warning',
                        alias:    m.alias,
                        detail:   `CPU pada ${m.alias} tinggi: ${m.cpu.toFixed(1)}%`,
                        metrics:  { cpu: m.cpu },
                    }).catch(() => {});
                }

                if (m.ramPct > THRESHOLD.ram) {
                    await createPendingFix(bot, chatId, {
                        type:     'high_ram',
                        severity: m.ramPct > 95 ? 'critical' : 'warning',
                        alias:    m.alias,
                        detail:   `RAM pada ${m.alias} tinggi: ${m.ramPct}% (${m.ramUsed}/${m.ramTotal}MB)`,
                        metrics:  { ram: m.ramPct },
                    }).catch(() => {});
                }

                for (const d of m.disks) {
                    if (d.usedPct > THRESHOLD.disk) {
                        await createPendingFix(bot, chatId, {
                            type:     'disk_full',
                            severity: d.usedPct > 95 ? 'critical' : 'warning',
                            alias:    m.alias,
                            detail:   `Disk ${d.mount} pada ${m.alias} hampir penuh: ${d.usedPct}%`,
                            metrics:  { disk: d.usedPct },
                        }).catch(() => {});
                    }
                }
            }

        } catch (err: any) {
            console.error('🚨 SSH Monitor error:', err.message);
        }
    };

    // Init status Proxmox awal + inisialisasi uptime
    getResources().then((res: any[]) => {
        res.forEach((r: any) => {
            lastProxmoxStatus[r.vmid] = r.status;
            initServerStatus(r.name, r.status === 'running');
        });
    }).catch(() => {});

    setInterval(checkProxmox, 60_000);
    checkSSHThreshold();
    setInterval(checkSSHThreshold, INTERVAL_MS);
};