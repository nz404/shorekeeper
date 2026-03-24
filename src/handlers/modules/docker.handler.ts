import { listContainers, controlContainer, getContainerLogs, getContainerStats } from '../../services/docker.service';
import { getAllAliases, getAliasFromDB } from '../../database/queries';

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
// MENU PILIH SERVER
// ─────────────────────────────────────────────

export const showDockerMenu = async (ctx: any) => {
    const aliases = await getAllAliases();
    if (!aliases.length) {
        return safeEdit(ctx,
            '⚠️ Belum ada alias SSH.\n\nTambahkan dulu dengan:\n`add_alias [nama] [user]@[ip]:[port] [pass]`',
            { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ Kembali', callback_data: 'back_to_help' }]] } }
        );
    }

    const buttons = aliases.map((a: any) => ([{
        text: `🐳 ${a.alias}  (${a.host})`,
        callback_data: `dock_server_${a.alias}`
    }]));
    buttons.push([{ text: '⬅️ Kembali', callback_data: 'back_to_help' }]);

    return safeEdit(ctx, '🐳 **Docker Manager — Pilih Server:**', {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
    });
};

// ─────────────────────────────────────────────
// LIST CONTAINERS DI SERVER
// ─────────────────────────────────────────────

export const showContainerList = async (ctx: any, alias: string) => {
    await ctx.answerCbQuery('🐳 Mengambil daftar container...').catch(() => {});

    const server = await getAliasFromDB(alias);
    if (!server) return ctx.reply(`❌ Alias \`${alias}\` tidak ditemukan.`, { parse_mode: 'Markdown' });

    const result = await listContainers(server);

    if (result.error) {
        return safeEdit(ctx, `❌ **${alias}:** ${result.error}`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Kembali', callback_data: 'menu_docker' }]] }
        });
    }

    if (!result.containers.length) {
        return safeEdit(ctx, `🐳 **${alias}** — Tidak ada container.`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Kembali', callback_data: 'menu_docker' }]] }
        });
    }

    const buttons = result.containers.map(c => ([{
        text: `${c.running ? '🟢' : '🔴'} ${c.name}`,
        callback_data: `dock_info_${alias}_${c.id}`
    }]));
    buttons.push([{ text: '🔄 Refresh', callback_data: `dock_server_${alias}` }]);
    buttons.push([{ text: '⬅️ Kembali', callback_data: 'menu_docker' }]);

    const summary = `🐳 **Docker — ${alias}**\n${result.containers.length} container | 🟢 ${result.containers.filter(c => c.running).length} running | 🔴 ${result.containers.filter(c => !c.running).length} stopped`;

    return safeEdit(ctx, summary, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
    });
};

// ─────────────────────────────────────────────
// DETAIL + KONTROL CONTAINER
// ─────────────────────────────────────────────

export const showContainerInfo = async (ctx: any, alias: string, containerId: string) => {
    const server = await getAliasFromDB(alias);
    if (!server) return ctx.reply('❌ Server tidak ditemukan.');

    const result = await listContainers(server);
    const c = result.containers.find(x => x.id === containerId || containerId.startsWith(x.id));
    if (!c) return ctx.reply('❌ Container tidak ditemukan.');

    const text =
        `🐳 **${c.name}**\n` +
        `├ Status: ${c.running ? '🟢 Running' : '🔴 Stopped'}\n` +
        `├ Image: \`${c.image}\`\n` +
        `├ ID: \`${c.id}\`\n` +
        `└ Ports: \`${c.ports || '-'}\``;

    const actionBtns = c.running
        ? [
            { text: '🛑 Stop',    callback_data: `dock_act_${alias}_${c.id}_stop`    },
            { text: '🔄 Restart', callback_data: `dock_act_${alias}_${c.id}_restart` },
          ]
        : [
            { text: '▶️ Start',   callback_data: `dock_act_${alias}_${c.id}_start`   },
          ];

    return safeEdit(ctx, text, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                actionBtns,
                [
                    { text: '📋 Logs',  callback_data: `dock_log_${alias}_${c.id}` },
                    { text: '📊 Stats', callback_data: `dock_stat_${alias}_${c.id}` },
                ],
                [{ text: '⬅️ Kembali', callback_data: `dock_server_${alias}` }],
            ]
        }
    });
};

// ─────────────────────────────────────────────
// AKSI CONTAINER
// ─────────────────────────────────────────────

export const handleContainerAction = async (ctx: any, alias: string, containerId: string, action: string) => {
    await ctx.answerCbQuery(`⏳ ${action}...`).catch(() => {});

    const server = await getAliasFromDB(alias);
    if (!server) return ctx.reply('❌ Server tidak ditemukan.');

    try {
        await controlContainer(server, containerId, action as any);
        await safeEdit(ctx, `✅ **${action.toUpperCase()}** berhasil dikirim ke \`${containerId}\``, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Kembali', callback_data: `dock_server_${alias}` }]] }
        });
    } catch (err: any) {
        await safeEdit(ctx, `❌ **Gagal:** ${err.message}`, {
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Kembali', callback_data: `dock_server_${alias}` }]] }
        });
    }
};

// ─────────────────────────────────────────────
// LOGS CONTAINER
// ─────────────────────────────────────────────

export const showContainerLogs = async (ctx: any, alias: string, containerId: string) => {
    await ctx.answerCbQuery('📋 Mengambil logs...').catch(() => {});

    const server = await getAliasFromDB(alias);
    if (!server) return ctx.reply('❌ Server tidak ditemukan.');

    try {
        const logs = await getContainerLogs(server, containerId);
        const safe = logs.length > 3000 ? '...(dipotong)\n' + logs.slice(-3000) : logs;
        return ctx.reply(
            `📋 **Logs \`${containerId}\`:**\n\`\`\`\n${safe}\n\`\`\``,
            {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Kembali', callback_data: `dock_info_${alias}_${containerId}` }]] }
            }
        );
    } catch (err: any) {
        return ctx.reply(`❌ ${err.message}`);
    }
};

// ─────────────────────────────────────────────
// STATS CONTAINER
// ─────────────────────────────────────────────

export const showContainerStats = async (ctx: any, alias: string, containerId: string) => {
    await ctx.answerCbQuery('📊 Mengambil stats...').catch(() => {});

    const server = await getAliasFromDB(alias);
    if (!server) return ctx.reply('❌ Server tidak ditemukan.');

    try {
        const stats = await getContainerStats(server, containerId);
        return safeEdit(ctx,
            `📊 **Stats \`${containerId}\`:**\n\`${stats}\``,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 Refresh', callback_data: `dock_stat_${alias}_${containerId}` }],
                        [{ text: '⬅️ Kembali', callback_data: `dock_info_${alias}_${containerId}` }],
                    ]
                }
            }
        );
    } catch (err: any) {
        return ctx.reply(`❌ ${err.message}`);
    }
};