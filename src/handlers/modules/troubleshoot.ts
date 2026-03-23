import OpenAI from 'openai';
import { SHOREKEEPER_PROMPT, TEKS, wrapWithSKVoice } from '../../config/persona';
import { runRemoteSSH } from '../../services/ssh.service';

// ─────────────────────────────────────────────
// GROQ CLIENT
// ─────────────────────────────────────────────

const openai = new OpenAI({
    apiKey:  process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
});

// ─────────────────────────────────────────────
// SAFE EDIT — fallback ke reply jika gagal
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
// DIAGNOSA PER KATEGORI
// ─────────────────────────────────────────────

export const DIAGNOSA: Record<string, { label: string; emoji: string; commands: string[] }> = {
    general: {
        label: 'General Linux', emoji: '🐧',
        commands: [
            'uptime',
            'top -bn1 | head -20',
            'free -h',
            'df -h',
            'ss -tulnp | head -20',
            'tail -n 20 /var/log/syslog 2>/dev/null || journalctl -n 20 --no-pager 2>/dev/null',
        ],
    },
    nginx: {
        label: 'Nginx', emoji: '🌐',
        commands: [
            'systemctl status nginx --no-pager',
            'nginx -t 2>&1',
            'tail -n 20 /var/log/nginx/error.log 2>/dev/null',
            'tail -n 10 /var/log/nginx/access.log 2>/dev/null',
        ],
    },
    apache: {
        label: 'Apache', emoji: '🪶',
        commands: [
            'systemctl status apache2 --no-pager 2>/dev/null || systemctl status httpd --no-pager 2>/dev/null',
            'apache2ctl -t 2>&1 || apachectl -t 2>&1',
            'tail -n 20 /var/log/apache2/error.log 2>/dev/null || tail -n 20 /var/log/httpd/error_log 2>/dev/null',
        ],
    },
    docker: {
        label: 'Docker', emoji: '🐳',
        commands: [
            'systemctl status docker --no-pager',
            'docker ps -a',
            'docker stats --no-stream',
            'docker system df',
        ],
    },
    mysql: {
        label: 'MySQL / MariaDB', emoji: '🐬',
        commands: [
            'systemctl status mysql --no-pager 2>/dev/null || systemctl status mariadb --no-pager 2>/dev/null',
            'mysqladmin status 2>/dev/null || echo "(Perlu kredensial untuk cek status MySQL)"',
            'tail -n 20 /var/log/mysql/error.log 2>/dev/null || tail -n 20 /var/log/mariadb/mariadb.log 2>/dev/null',
        ],
    },
    postgresql: {
        label: 'PostgreSQL', emoji: '🐘',
        commands: [
            'systemctl status postgresql --no-pager',
            'tail -n 20 /var/log/postgresql/*.log 2>/dev/null | head -25',
        ],
    },
    pm2: {
        label: 'Node.js / PM2', emoji: '🟢',
        commands: [
            'pm2 list 2>/dev/null || echo "(PM2 tidak ditemukan)"',
            'pm2 logs --nostream --lines 20 2>/dev/null || echo "(Tidak ada log PM2)"',
            'node -v 2>/dev/null',
        ],
    },
    proxmox: {
        label: 'Proxmox VE', emoji: '🖥️',
        commands: [
            'pveversion 2>/dev/null',
            'pvecm status 2>/dev/null || echo "(Standalone node)"',
            'systemctl status pvedaemon --no-pager',
            'systemctl status pveproxy --no-pager',
            'pvesh get /nodes --output-format json-pretty 2>/dev/null | head -30',
            'tail -n 20 /var/log/syslog 2>/dev/null | grep -i pve',
            'df -h /var/lib/vz 2>/dev/null',
        ],
    },
};

export const KATEGORI_LIST = Object.keys(DIAGNOSA);

// ─────────────────────────────────────────────
// SSH DIAGNOSA

const runSSHDiagnosa = async (
    host: string, port: number, username: string, password: string, kategori: string
): Promise<string> => {
    const config  = { host, port, username, password };
    const results: string[] = [];

    for (const cmd of DIAGNOSA[kategori].commands) {
        try {
            const out = await runRemoteSSH({ ...config, readyTimeout: 10_000 }, cmd, 15_000).catch((e: any) => `[ERROR] ${e.message}`);
            results.push(`$ ${cmd}\n${out || '(tidak ada output)'}`);
        } catch (err: any) {
            results.push(`$ ${cmd}\n[ERROR] ${err.message}`);
        }
    }

    return results.join('\n\n');
};

// ─────────────────────────────────────────────
// ANALISIS DENGAN GROQ
// ─────────────────────────────────────────────

const analisisWithAI = async (alias: string, kategori: string, rawOutput: string): Promise<string> => {
    const { label } = DIAGNOSA[kategori];

    const res = await openai.chat.completions.create({
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        messages: [
            { role: 'system', content: SHOREKEEPER_PROMPT },
            {
                role: 'user',
                content:
`Diagnosa ${label} pada server "${alias}".

Output dari server:
\`\`\`
${rawOutput.slice(0, 5000)}
\`\`\`

Analisis:
1. Ada masalah atau tidak?
2. Jika ada, jelaskan masalahnya
3. Berikan langkah perbaikan konkret
4. Jika normal, sampaikan dengan gaya SK yang tenang

Jawaban singkat dan padat dengan gaya Shorekeeper. Jangan gunakan Markdown.`,
            },
        ],
        max_tokens: 800,
    });

    const analisisTeknis = res.choices[0]?.message?.content || 'SK tidak mendapat respons dari AI.';
    return wrapWithSKVoice('troubleshoot', analisisTeknis, alias);
};

// ─────────────────────────────────────────────
// HANDLER UTAMA TROUBLESHOOT
// ─────────────────────────────────────────────

export const handleTroubleshoot = async (
    ctx: any,
    server: { alias: string; host: string; port: number; username: string; password: string },
    kategori: string
) => {
    const { label, emoji } = DIAGNOSA[kategori];

    const loading = await ctx.reply(
        TEKS.tsLoading(emoji, label, server.alias),
        { parse_mode: 'Markdown' }
    );

    try {
        const rawOutput = await runSSHDiagnosa(
            server.host, server.port, server.username, server.password, kategori
        );

        await ctx.telegram.editMessageText(
            ctx.chat.id, loading.message_id, undefined,
            TEKS.tsAnalisis()
        ).catch(() => {});

        const analisis = await analisisWithAI(server.alias, kategori, rawOutput);
        await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id).catch(() => {});

        return ctx.reply(
            `📋 Diagnosa ${emoji} ${label}\n🖥️ Server: ${server.alias}\n\n${analisis}`,
            {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `${emoji} Diagnosa Ulang`, callback_data: `ts_${kategori}_${server.alias}` }],
                        [{ text: '🔍 Kategori Lain',        callback_data: `ts_server_${server.alias}` }],
                        [{ text: '⬅️ Kembali ke Menu',      callback_data: 'back_to_help' }],
                    ],
                },
            }
        );

    } catch (err: any) {
        await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id).catch(() => {});
        const msg = err.message?.includes('ECONNREFUSED') || err.message?.includes('ETIMEDOUT')
            ? TEKS.tsGagalKoneksi(server.alias)
            : `❌ Error: ${err.message}`;
        return ctx.reply(msg, { parse_mode: 'Markdown' });
    }
};

// ─────────────────────────────────────────────
// MENU PILIH SERVER
// ─────────────────────────────────────────────

export const showTroubleshootMenu = async (ctx: any, aliases: any[]) => {
    if (!aliases.length) {
        return safeEdit(ctx,
            '⚠️ *Belum ada alias SSH.*\n\nTambahkan dulu dengan:\n`add_alias [nama] [user]@[ip]:[port] [pass]`',
            {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Kembali', callback_data: 'back_to_help' }]] },
            }
        );
    }

    const buttons = aliases.map((a: any) => ([{
        text:          `🖥️ ${a.alias}  (${a.host})`,
        callback_data: `ts_server_${a.alias}`,
    }]));
    buttons.push([{ text: '⬅️ Kembali', callback_data: 'back_to_help' }]);

    return safeEdit(ctx, '🔍 *Troubleshoot — Pilih Server:*', {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons },
    });
};

// ─────────────────────────────────────────────
// MENU PILIH KATEGORI
// ─────────────────────────────────────────────

export const showKategoriMenu = async (ctx: any, serverAlias: string) => {
    const buttons = Object.entries(DIAGNOSA).map(([key, val]) => ([{
        text:          `${val.emoji} ${val.label}`,
        callback_data: `ts_${key}_${serverAlias}`,
    }]));
    buttons.push([{ text: '⬅️ Pilih Server Lain', callback_data: 'menu_troubleshoot' }]);

    return safeEdit(ctx,
        `🔍 *Troubleshoot \`${serverAlias}\`*\n\nPilih kategori diagnosa:`,
        {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons },
        }
    );
};