import OpenAI from 'openai';
import { SHOREKEEPER_PROMPT } from '../config/persona';
import { sshExecMulti } from './ssh.service';
import { getAliasFromDB } from '../database/queries';

// ═══════════════════════════════════════════════
// AUTO-FIX ENGINE
// ═══════════════════════════════════════════════

const openai = new OpenAI({
    apiKey:  process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
});

// ─────────────────────────────────────────────
// PENDING APPROVALS — simpan di memory
// ─────────────────────────────────────────────

interface PendingFix {
    alias:     string;
    issue:     string;
    commands:  string[];
    analysis:  string;
    createdAt: Date;
}

export const pendingFixes = new Map<string, PendingFix>();

const generateFixId = (): string =>
    `fix_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

// ─────────────────────────────────────────────
// DETEKSI ISSUE & GENERATE FIX COMMANDS
// ─────────────────────────────────────────────

export interface DetectedIssue {
    type:     'service_down' | 'disk_full' | 'high_cpu' | 'high_ram' | 'container_crash' | 'network_issue';
    severity: 'warning' | 'critical';
    alias:    string;
    detail:   string;
    metrics?: { cpu?: number; ram?: number; disk?: number };
}

const FIX_COMMANDS: Record<string, (detail: string) => string[]> = {
    service_down: (detail) => {
        const service = detail.match(/service[:\s]+(\S+)/i)?.[1] || 'nginx';
        return [
            `sudo systemctl restart ${service}`,
            `sudo systemctl status ${service} --no-pager -l`,
        ];
    },
    disk_full: () => [
        `sudo journalctl --vacuum-size=100M`,
        `sudo find /var/log -name "*.log" -mtime +7 -delete 2>/dev/null || true`,
        `sudo find /tmp -mtime +3 -delete 2>/dev/null || true`,
        `df -h /`,
    ],
    high_cpu: () => [
        `ps aux --sort=-%cpu | head -10`,
        `sudo systemctl status --no-pager -l | grep -i fail`,
        `uptime`,
    ],
    high_ram: () => [
        `ps aux --sort=-%mem | head -10`,
        `free -h`,
        `sudo systemctl status --no-pager -l | grep -i fail`,
    ],
    container_crash: (detail) => {
        const container = detail.match(/container[:\s]+(\S+)/i)?.[1] || '';
        if (container) {
            return [
                `docker restart ${container}`,
                `sleep 3`,
                `docker inspect --format='{{.State.Status}}' ${container}`,
                `docker logs ${container} --tail 20`,
            ];
        }
        return [
            `docker ps --filter status=exited --format "table {{.Names}}\t{{.Status}}"`,
            `docker ps -a --format "{{.Names}}" | xargs -I{} sh -c 'docker inspect --format="{{.Name}} {{.State.Status}}" {}'`,
        ];
    },
    network_issue: () => [
        `ping -c 4 8.8.8.8`,
        `ip route show`,
        `sudo systemctl status networking --no-pager -l`,
        `sudo systemctl status NetworkManager --no-pager -l 2>/dev/null || echo "NetworkManager not found"`,
    ],
};

// ─────────────────────────────────────────────
// ANALISA ISSUE VIA GROQ
// ─────────────────────────────────────────────

export const analyzeIssue = async (issue: DetectedIssue): Promise<string> => {
    const ADMIN_NAME = process.env.ADMIN_NAME || 'Irvan';
    try {
        const res = await openai.chat.completions.create({
            model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: SHOREKEEPER_PROMPT },
                {
                    role: 'user',
                    content: [
                        `SK mendeteksi masalah pada server ${issue.alias}:`,
                        `Tipe: ${issue.type}`,
                        `Detail: ${issue.detail}`,
                        issue.metrics ? `Metrics: CPU ${issue.metrics.cpu}%, RAM ${issue.metrics.ram}%, Disk ${issue.metrics.disk}%` : '',
                        ``,
                        `Jelaskan masalah ini kepada Kak ${ADMIN_NAME} secara singkat dan padat.`,
                        `Sebutkan kemungkinan penyebab dan apa yang akan SK lakukan untuk memperbaikinya.`,
                        `Jangan gunakan Markdown.`,
                    ].filter(Boolean).join('\n'),
                },
            ],
            max_tokens: 300,
        });
        return res.choices[0]?.message?.content || `Terdeteksi ${issue.type} pada ${issue.alias}.`;
    } catch {
        return `Terdeteksi ${issue.type} pada server ${issue.alias}. Detail: ${issue.detail}`;
    }
};

// ─────────────────────────────────────────────
// BUAT PENDING FIX & KIRIM KE TELEGRAM
// ─────────────────────────────────────────────

export const createPendingFix = async (
    bot: any,
    chatId: string,
    issue: DetectedIssue
): Promise<void> => {
    const analysis = await analyzeIssue(issue);
    const commands = FIX_COMMANDS[issue.type]?.(issue.detail) || [];

    if (!commands.length) return;

    const fixId = generateFixId();
    pendingFixes.set(fixId, {
        alias:    issue.alias,
        issue:    issue.detail,
        commands,
        analysis,
        createdAt: new Date(),
    });

    // Auto-expire setelah 30 menit
    setTimeout(() => pendingFixes.delete(fixId), 30 * 60 * 1000);

    const severityIcon = issue.severity === 'critical' ? '🚨' : '⚠️';
    const cmdPreview   = commands.slice(0, 3).join('\n');

    const msg = [
        `${severityIcon} *Deteksi Masalah — ${issue.alias}*`,
        ``,
        analysis,
        ``,
        `*Rencana perbaikan:*`,
        cmdPreview,
        commands.length > 3 ? `...dan ${commands.length - 3} perintah lainnya` : '',
        ``,
        `_Izinkan SK mengeksekusi perbaikan ini?_`,
    ].filter(s => s !== undefined).join('\n');

    await bot.telegram.sendMessage(chatId, msg, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[
                { text: '✅ Izinkan SK Fix', callback_data: `autofix_approve_${fixId}` },
                { text: '❌ Tolak',           callback_data: `autofix_reject_${fixId}`  },
            ]],
        },
    });
};

// ─────────────────────────────────────────────
// EKSEKUSI FIX VIA SSH

// ─────────────────────────────────────────────
// APPROVE & EKSEKUSI
// ─────────────────────────────────────────────

export const approveFix = async (
    ctx: any,
    fixId: string
): Promise<void> => {
    const fix = pendingFixes.get(fixId);
    if (!fix) {
        await ctx.answerCbQuery('❌ Fix sudah kadaluarsa atau tidak ditemukan.').catch(() => {});
        return;
    }

    pendingFixes.delete(fixId);
    await ctx.answerCbQuery('⚙️ SK mulai mengeksekusi perbaikan...').catch(() => {});

    // Edit pesan jadi loading
    await ctx.editMessageText(
        `⚙️ *SK sedang mengeksekusi perbaikan pada ${fix.alias}...*\n\nMohon tunggu sebentar, Kak ${process.env.ADMIN_NAME || 'Irvan'}.`,
        { parse_mode: 'Markdown' }
    ).catch(() => {});

// add service object wrapper at end

    // Ambil config SSH
    const server = await getAliasFromDB(fix.alias);
    if (!server) {
        await ctx.editMessageText(`❌ Server ${fix.alias} tidak ditemukan di daftar alias.`).catch(() => {});
        return;
    }

    // Eksekusi
    const output = await sshExecMulti({
        host:     server.host,
        port:     server.port,
        username: server.username,
        password: server.password,
    }, fix.commands);

// existing code continues ...

    // Analisa hasil
    const ADMIN_NAME = process.env.ADMIN_NAME || 'Irvan';
    let resultMsg = '';
    try {
        const res = await openai.chat.completions.create({
            model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: SHOREKEEPER_PROMPT },
                {
                    role: 'user',
                    content: [
                        `SK baru selesai mengeksekusi perbaikan pada server ${fix.alias}.`,
                        `Output:\n${output.slice(0, 2000)}`,
                        `Laporkan hasilnya kepada Kak ${ADMIN_NAME} secara singkat.`,
                        `Apakah perbaikan berhasil? Ada masalah lain yang perlu diperhatikan?`,
                        `Jangan gunakan Markdown.`,
                    ].join('\n'),
                },
            ],
            max_tokens: 300,
        });
        resultMsg = res.choices[0]?.message?.content || output;
    } catch {
        resultMsg = output;
    }

    const preview = output.length > 500 ? output.slice(0, 500) + '...' : output;
    await ctx.editMessageText(
        `✅ *Perbaikan selesai — ${fix.alias}*\n\n${resultMsg}\n\n*Output:*\n\`\`\`\n${preview}\n\`\`\``,
        { parse_mode: 'Markdown' }
    ).catch(() => ctx.reply(`✅ Perbaikan selesai pada ${fix.alias}.\n\n${resultMsg}`));
};

export const rejectFix = async (ctx: any, fixId: string): Promise<void> => {
    pendingFixes.delete(fixId);
    await ctx.answerCbQuery('Perbaikan dibatalkan.').catch(() => {});
    await ctx.editMessageText(
        `❌ Perbaikan dibatalkan oleh Kak ${process.env.ADMIN_NAME || 'Irvan'}. SK tidak akan mengeksekusi perubahan apapun.`,
    ).catch(() => {});
};

export const AutoFixService = {
    pendingFixes,
    analyzeIssue,
    createPendingFix,
    approveFix,
    rejectFix,
};