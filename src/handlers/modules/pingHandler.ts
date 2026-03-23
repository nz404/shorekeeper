import { getPingTargets, addPingTarget, removePingTarget, getPingStatus, checkTarget } from '../../jobs/pingMonitor';

// ─────────────────────────────────────────────
// SAFE EDIT
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
// MENU UTAMA PING MONITOR
// ─────────────────────────────────────────────

export const showPingMenu = async (ctx: any) => {
    const targets = await getPingStatus();

    let text = '📡 *Ping Monitor*\n\n';

    if (!targets.length) {
        text += '_Belum ada target yang dipantau._\n\n';
    } else {
        targets.forEach(t => {
            const status  = t.isUp === null ? '⏳' : t.isUp ? '🟢' : '🔴';
            const typeIcon = t.type === 'http' ? '🌐' : '📡';
            const detail  = '';
            text += `${status} ${typeIcon} *${t.name}*\n   \`${t.target}${detail}\`\n\n`;
        });
    }

    const delButtons = targets.map((t: any) => ([{
        text:          `🗑️ Hapus ${t.name}`,
        callback_data: `ping_del_${t.id}`,
    }]));

    return safeEdit(ctx, text, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '➕ HTTP/URL',  callback_data: 'ping_add_http' },
                    { text: '➕ IP/Host',   callback_data: 'ping_add_ip'   },
                ],
                [{ text: '🔄 Cek Sekarang', callback_data: 'ping_check_now' }],
                ...delButtons,
                [{ text: '⬅️ Kembali', callback_data: 'back_to_help' }],
            ],
        },
    });
};

// ─────────────────────────────────────────────
// ADD TARGET HANDLERS
// ─────────────────────────────────────────────

export const showPingAddPrompt = async (ctx: any, type: 'http' | 'ip') => {
    const examples = {
        http: 'Format: `nama | https://example.com`\nContoh: `Google | https://google.com`',
        ip:   'Format: `nama | ip-address`\nContoh: `Router | 192.168.1.1`',
    };

    return safeEdit(ctx, `➕ *Tambah Monitor ${type.toUpperCase()}*\n\n${examples[type]}`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'menu_ping' }]] }
    });
};

export const handleAddPingTarget = async (ctx: any, type: 'http' | 'ip', input: string) => {
    const parts = input.split('|').map(s => s.trim());

    if (parts.length < 2) {
        return ctx.reply(`❌ Format salah.`, { parse_mode: 'Markdown' });
    }

    const [name, target] = parts;
    const id = await addPingTarget(name, type, target);
    if (!id) return ctx.reply('❌ Gagal menambahkan target.');

    // Langsung cek status awal tanpa trigger alert
    const { initTargetStatus } = await import('../../jobs/pingMonitor');
    const isUp = await initTargetStatus(id, type, target);

    const typeIcon  = type === 'http' ? '🌐' : '📡';
    const statusIcon = isUp ? '🟢' : '🔴';
    return ctx.reply(
        `✅ Monitor ${type.toUpperCase()} ditambahkan!\n\n${statusIcon} ${typeIcon} *${name}*\n\`${target}\`\n\nStatus saat ini: ${isUp ? 'UP' : 'DOWN'}`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '📡 Lihat Monitor', callback_data: 'menu_ping' }]] } }
    );
};

export const handleDeletePingTarget = async (ctx: any, targetId: number) => {
    const ok = await removePingTarget(targetId);
    await ctx.answerCbQuery(ok ? '🗑️ Target dihapus.' : '❌ Gagal hapus.').catch(() => {});
    return showPingMenu(ctx);
};

// ─────────────────────────────────────────────
// CEK SEKARANG
// ─────────────────────────────────────────────

export const checkPingNow = async (ctx: any) => {
    await ctx.answerCbQuery('📡 Mengecek semua target...').catch(() => {});
    const loading = await ctx.reply('📡 SK sedang mengecek semua target...');


    const targets = await getPingTargets();

    if (!targets.length) {
        await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id).catch(() => {});
        return ctx.reply('Belum ada target yang dipantau.');
    }

    const results = await Promise.all(targets.map(async t => {
        const { up, latency } = await checkTarget(t);
        return { ...t, up, latency };
    }));

    const text = '📡 *Status Ping Sekarang:*\n\n' + results.map(r => {
        const icon   = r.up ? '🟢' : '🔴';
        const detail = '';
        const lat    = r.up ? ` (${r.latency}ms)` : ' (timeout)';
        return `${icon} *${r.name}*${lat}\n   \`${r.target}${detail}\``;
    }).join('\n\n');

    await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id).catch(() => {});
    return ctx.reply(text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '⬅️ Kembali', callback_data: 'menu_ping' }]] }
    });
};