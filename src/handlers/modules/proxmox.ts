import { getResources, getNodesStatus, controlResource } from '../../services/proxmox.service';

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
// DAFTAR VM & LXC
// ─────────────────────────────────────────────

export const handleManageNode = async (ctx: any) => {
    const resources = await getResources();

    const buttons = resources.map((r: any) => ([{
        text:          `${r.status === 'running' ? '🟢' : '🔴'} ${r.name}`,
        callback_data: `info_${r.type}_${r.vmid}_${r.node}`,
    }]));

    buttons.push([{ text: '⬅️ Kembali', callback_data: 'back_to_help' }]);

    return safeEdit(ctx, '🖥️ *Daftar VM & Container:*', {
        parse_mode:   'Markdown',
        reply_markup: { inline_keyboard: buttons },
    });
};

// ─────────────────────────────────────────────
// STATUS NODE
// ─────────────────────────────────────────────

export const handleCheckStatus = async (ctx: any) => {
    const status = await getNodesStatus();
    return safeEdit(ctx, `📊 *Status Node Proxmox:*\n\n${status}`, {
        parse_mode:   'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '⬅️ Kembali', callback_data: 'back_to_help' }]] },
    });
};

// ─────────────────────────────────────────────
// AKSI PROXMOX (info / exec)
// ─────────────────────────────────────────────

export const handleProxmoxAction = async (
    ctx: any,
    action: string,
    type: string,
    id: string,
    node: string
) => {
    // ── Tampilkan opsi start / stop / reboot ──
    if (action === 'info') {
        return safeEdit(ctx, `🛠️ *Opsi untuk ${type.toUpperCase()} ID ${id}* (node: ${node}):`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '▶️ Start',  callback_data: `exec_${type}_${id}_start_${node}`  },
                        { text: '🛑 Stop',   callback_data: `exec_${type}_${id}_stop_${node}`   },
                        { text: '🔄 Reboot', callback_data: `exec_${type}_${id}_reboot_${node}` },
                    ],
                    [{ text: '⬅️ Kembali', callback_data: 'menu_proxmox' }],
                ],
            },
        });
    }

    // ── Jalankan perintah ──
    if (action === 'exec') {
        const parts      = (ctx.callbackQuery.data as string).split('_');
        const resType    = parts[1] as 'qemu' | 'lxc';
        const vmid       = parseInt(parts[2]);
        const task       = parts[3];
        const targetNode = parts[4];

        try {
            const result = await controlResource(vmid, resType, task, targetNode);
            await ctx.answerCbQuery(`✅ ${task} dikirim`).catch(() => {});
            return safeEdit(ctx, `✅ *${task.toUpperCase()}* berhasil dikirim:\n\n${result}`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: '⬅️ Kembali ke Daftar', callback_data: 'menu_proxmox' }]],
                },
            });
        } catch (err: any) {
            return safeEdit(ctx, `❌ *Gagal:* ${err.message}`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: '⬅️ Kembali ke Daftar', callback_data: 'menu_proxmox' }]],
                },
            });
        }
    }
};