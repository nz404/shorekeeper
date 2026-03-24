import {
    getResources, getNodesStatus, controlResource,
    getAllClusters, addCluster, removeCluster, testClusterConnection,
} from '../../services/proxmox.service';

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
// MENU UTAMA PROXMOX
// ─────────────────────────────────────────────

export const handleProxmoxMenu = async (ctx: any) => {
    const clusters   = await getAllClusters();
    const clusterStr = clusters.length
        ? clusters.map(c => `• \`${c.name}\` — ${c.host}:${c.port}`).join('\n')
        : '_Belum ada cluster terdaftar._';

    return safeEdit(ctx, `🖥️ *Proxmox Manager*\n\nCluster terdaftar:\n${clusterStr}`, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '📋 Daftar VM/LXC', callback_data: 'pve_list'     },
                    { text: '📊 Status Node',   callback_data: 'pve_status'   },
                ],
                [
                    { text: '➕ Tambah Cluster', callback_data: 'pve_add'      },
                    { text: '🗑️ Hapus Cluster',  callback_data: 'pve_del_menu' },
                ],
                [{ text: '⬅️ Kembali',           callback_data: 'back_to_help' }],
            ],
        },
    });
};

// ─────────────────────────────────────────────
// DAFTAR VM & LXC
// ─────────────────────────────────────────────

export const handleManagePulau = async (ctx: any) => {
    const resources = await getResources();
    const clusters  = await getAllClusters();
    const multi     = clusters.length > 1;

    if (!resources.length) {
        return safeEdit(ctx,
            '🖥️ *Daftar VM & Container*\n\n_Tidak ada VM/LXC ditemukan atau belum ada cluster._',
            {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Kembali', callback_data: 'menu_proxmox' }]] },
            }
        );
    }

    const buttons = resources.map((r: any) => ([{
        text:          `${r.status === 'running' ? '🟢' : '🔴'} ${r.name}${multi ? ` [${r.clusterName}]` : ''}`,
        callback_data: `pve_info_${r.type}_${r.vmid}_${r.node}_${r.clusterId}`,
    }]));
    buttons.push([{ text: '⬅️ Kembali', callback_data: 'menu_proxmox' }]);

    const title = multi
        ? `🖥️ *VM & Container — ${clusters.length} cluster, ${resources.length} total:*`
        : `🖥️ *VM & Container (${resources.length} total):*`;

    return safeEdit(ctx, title, {
        parse_mode:   'Markdown',
        reply_markup: { inline_keyboard: buttons },
    });
};

// ─────────────────────────────────────────────
// STATUS NODE
// ─────────────────────────────────────────────

export const handleCheckStatus = async (ctx: any) => {
    const status = await getNodesStatus();
    return safeEdit(ctx, status, {
        parse_mode:   'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '⬅️ Kembali', callback_data: 'menu_proxmox' }]] },
    });
};

// ─────────────────────────────────────────────
// AKSI VM — info (tampilkan tombol) / exec (jalankan)
// ─────────────────────────────────────────────

export const handleProxmoxAction = async (
    ctx: any,
    action: string,
    type: string,
    id: string,
    node: string,
    clusterId: number,
) => {
    if (action === 'info') {
        return safeEdit(ctx, `🛠️ *Opsi untuk ${type.toUpperCase()} ID ${id}* (node: ${node}):`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '▶️ Start',  callback_data: `pve_exec_${type}_${id}_start_${node}_${clusterId}`  },
                        { text: '🛑 Stop',   callback_data: `pve_exec_${type}_${id}_stop_${node}_${clusterId}`   },
                        { text: '🔄 Reboot', callback_data: `pve_exec_${type}_${id}_reboot_${node}_${clusterId}` },
                    ],
                    [{ text: '⬅️ Kembali ke Daftar', callback_data: 'pve_list' }],
                ],
            },
        });
    }

    if (action === 'exec') {
        // format: pve_exec_{type}_{vmid}_{task}_{node}_{clusterId}
        const parts   = (ctx.callbackQuery.data as string).split('_');
        const resType = parts[2] as 'qemu' | 'lxc';
        const vmid    = parseInt(parts[3]);
        const task    = parts[4];
        const tNode   = parts[5];
        const cId     = parseInt(parts[6]);

        await ctx.answerCbQuery(`⏳ Mengirim ${task}...`).catch(() => {});
        const result = await controlResource(vmid, resType, task, tNode, cId);
        return safeEdit(ctx, result, {
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Kembali', callback_data: 'pve_list' }]] },
        });
    }
};

// ─────────────────────────────────────────────
// TAMBAH CLUSTER — Wizard step by step
// ─────────────────────────────────────────────

export const showAddClusterPrompt = async (ctx: any) => {
    // Step 1: minta nama cluster
    return safeEdit(ctx,
        '➕ *Tambah Cluster Proxmox*\n\n' +
        '*Step 1/5* — Ketik *nama* cluster ini:\n' +
        '_Contoh: rumah, kantor, vps-utama_',
        {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'menu_proxmox' }]] },
        }
    );
};

// Wizard step progress bar helper
const stepBar = (current: number, total = 5): string => {
    const filled = '▰'.repeat(current);
    const empty  = '▱'.repeat(total - current);
    return `${filled}${empty}  ${current}/${total}`;
};

export const handlePveWizardStep = async (
    ctx: any,
    userId: number,
    input: string,
    session: any,
    remoteSessions: Map<number, any>
): Promise<void> => {
    const step = session.pve_step as string;

    // Batal
    if (input.toLowerCase() === 'batal' || input.toLowerCase() === 'cancel') {
        remoteSessions.delete(userId);
        await ctx.reply('❌ Penambahan cluster dibatalkan.', {
            reply_markup: { inline_keyboard: [[{ text: '🖥️ Kembali', callback_data: 'menu_proxmox' }]] },
        });
        return;
    }

    if (step === 'pve_name') {
        if (!/^[\w\-]+$/.test(input)) {
            await ctx.reply('❌ Nama hanya boleh huruf, angka, dan tanda -\nContoh: `rumah`, `vps-1`', { parse_mode: 'Markdown' });
            return;
        }
        remoteSessions.set(userId, { ...session, pve_name: input, pve_step: 'pve_host' });
        await ctx.reply(
            `${stepBar(2)}\n\n` +
            `📌 Nama: \`${input}\`\n\n` +
            '*Step 2/5* — Ketik *IP/hostname* Proxmox:\n' +
            '_Contoh: 192.168.1.100 atau pve.domain.com_',
            { parse_mode: 'Markdown' }
        );
        return;
    }

    if (step === 'pve_host') {
        remoteSessions.set(userId, { ...session, pve_host: input, pve_step: 'pve_port' });
        await ctx.reply(
            `${stepBar(3)}\n\n` +
            `📌 Nama: \`${session.pve_name}\`\n` +
            `🌐 Host: \`${input}\`\n\n` +
            '*Step 3/5* — Ketik *port* Proxmox:\n' +
            '_Default: 8006 — ketik 8006 kalau tidak tahu_',
            { parse_mode: 'Markdown' }
        );
        return;
    }

    if (step === 'pve_port') {
        const port = parseInt(input);
        if (isNaN(port) || port < 1 || port > 65535) {
            await ctx.reply('❌ Port tidak valid. Masukkan angka 1–65535, biasanya `8006`', { parse_mode: 'Markdown' });
            return;
        }
        remoteSessions.set(userId, { ...session, pve_port: port, pve_step: 'pve_user' });
        await ctx.reply(
            `${stepBar(4)}\n\n` +
            `📌 Nama: \`${session.pve_name}\`\n` +
            `🌐 Host: \`${session.pve_host}:${port}\`\n\n` +
            '*Step 4/5* — Ketik *user@realm* Proxmox:\n' +
            '_Contoh: root@pam atau admin@pve_',
            { parse_mode: 'Markdown' }
        );
        return;
    }

    if (step === 'pve_user') {
        remoteSessions.set(userId, { ...session, pve_user: input, pve_step: 'pve_secret' });
        await ctx.reply(
            `${stepBar(5)}\n\n` +
            `📌 Nama: \`${session.pve_name}\`\n` +
            `🌐 Host: \`${session.pve_host}:${session.pve_port}\`\n` +
            `👤 User: \`${input}\`\n\n` +
            '*Step 5/5* — Ketik *API Token Secret* Proxmox:\n' +
            '_Buat di: Datacenter → API Tokens → Add_\n' +
            '_Token Name harus: *shorekeeper*_',
            { parse_mode: 'Markdown' }
        );
        return;
    }

    if (step === 'pve_secret') {
        remoteSessions.delete(userId);

        const { pve_name, pve_host, pve_port, pve_user } = session;
        const loading = await ctx.reply('🔍 SK sedang test koneksi ke cluster...');
        const test    = await testClusterConnection({
            name: pve_name, host: pve_host, port: pve_port, user: pve_user, token_id: 'shorekeeper', secret: input, token_secret: input,
        });
        await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id).catch(() => {});

        if (!test.ok) {
            await ctx.reply(
                `❌ *Koneksi gagal:* ${test.msg}\n\nCluster tidak disimpan.\n` +
                'Periksa host, port, user, dan token — lalu coba lagi dari menu.',
                {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '🔄 Coba Lagi', callback_data: 'pve_add' }, { text: '⬅️ Batal', callback_data: 'menu_proxmox' }]] },
                }
            );
            return;
        }

        const id = await addCluster(pve_name, pve_host, pve_port, pve_user, input);
        if (!id) {
            await ctx.reply('❌ Gagal simpan ke database. Nama cluster mungkin sudah digunakan.');
            return;
        }

        await ctx.reply(
            `✅ *Cluster berhasil ditambahkan!*\n\n` +
            `📌 Nama : \`${pve_name}\`\n` +
            `🌐 Host : \`${pve_host}:${pve_port}\`\n` +
            `👤 User : \`${pve_user}\`\n` +
            `✅ Versi : ${test.msg}`,
            {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '🖥️ Lihat Cluster', callback_data: 'menu_proxmox' }]] },
            }
        );
        return;
    }
};

// ─────────────────────────────────────────────
// TAMBAH CLUSTER — proses input
// ─────────────────────────────────────────────

export const handleAddCluster = async (ctx: any, args: string[]): Promise<void> => {
    if (args.length < 5) {
        await ctx.reply(
            '❌ Format salah.\n\nGunakan:\n`pve add [nama] [host] [port] [user@realm] [token_secret]`',
            { parse_mode: 'Markdown' }
        );
        return;
    }

    const [name, host, portStr, user, secret] = args;
    const port = parseInt(portStr);

    if (isNaN(port)) {
        await ctx.reply('❌ Port harus angka. Contoh: `8006`', { parse_mode: 'Markdown' });
        return;
    }

    const loading = await ctx.reply('🔍 SK sedang test koneksi ke cluster...');
    const test    = await testClusterConnection({ name, host, port, user, token_id: 'shorekeeper', secret, token_secret: secret });
    await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id).catch(() => {});

    if (!test.ok) {
        await ctx.reply(
            `❌ *Koneksi gagal:* ${test.msg}\n\nCluster tidak disimpan. Periksa host, port, dan token.`,
            { parse_mode: 'Markdown' }
        );
        return;
    }

    const id = await addCluster(name, host, port, user, secret);
    if (!id) {
        await ctx.reply('❌ Gagal simpan ke database. Nama cluster mungkin sudah digunakan.');
        return;
    }

    await ctx.reply(
        `✅ *Cluster berhasil ditambahkan!*\n\n` +
        `📌 Nama  : \`${name}\`\n` +
        `🌐 Host  : \`${host}:${port}\`\n` +
        `✅ Versi  : ${test.msg}\n` +
        `🆔 ID DB : \`${id}\``,
        {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🖥️ Lihat Cluster', callback_data: 'menu_proxmox' }]] },
        }
    );
};

// ─────────────────────────────────────────────
// HAPUS CLUSTER — menu pilih
// ─────────────────────────────────────────────

export const showDeleteClusterMenu = async (ctx: any) => {
    const clusters = await getAllClusters();

    if (!clusters.length) {
        return safeEdit(ctx, '⚠️ Belum ada cluster yang terdaftar.', {
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Kembali', callback_data: 'menu_proxmox' }]] },
        });
    }

    const buttons = clusters.map(c => ([{
        text:          `🗑️ ${c.name} (${c.host}:${c.port})`,
        callback_data: `pve_del_${c.id}`,
    }]));
    buttons.push([{ text: '⬅️ Kembali', callback_data: 'menu_proxmox' }]);

    return safeEdit(ctx, '🗑️ *Hapus Cluster — Pilih:*', {
        parse_mode:   'Markdown',
        reply_markup: { inline_keyboard: buttons },
    });
};

// ─────────────────────────────────────────────
// HAPUS CLUSTER — eksekusi
// ─────────────────────────────────────────────

export const handleDeleteCluster = async (ctx: any, clusterId: number) => {
    const clusters = await getAllClusters();
    const cluster  = clusters.find(c => c.id === clusterId);

    if (!cluster) {
        await ctx.answerCbQuery('❌ Cluster tidak ditemukan.').catch(() => {});
        return;
    }

    const ok = await removeCluster(clusterId);
    await ctx.answerCbQuery(
        ok ? `🗑️ Cluster ${cluster.name} dihapus.` : '❌ Gagal hapus.'
    ).catch(() => {});
    return showDeleteClusterMenu(ctx);
};