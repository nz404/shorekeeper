import * as dotenv from 'dotenv';
dotenv.config();

import { Telegraf } from 'telegraf';
import { handleAIChat } from './modules/ai.handler';
import {
    handleManagePulau, handleCheckStatus, handleProxmoxAction,
    handleProxmoxMenu, showAddClusterPrompt,
    showDeleteClusterMenu, showEditClusterMenu, handleDeleteCluster,
    handlePveWizardStep,
} from './modules/proxmox.handler';
import { cancelSessionTimeout, handleSSHWizard, resetSessionTimeout } from './modules/ssh.handler';
import { handleLocalTerminal } from './modules/terminal.handler';
import { showTroubleshootMenu, showKategoriMenu, handleTroubleshoot, KATEGORI_LIST } from './modules/troubleshoot.handler';
import { showMonitorMenu, handleMonitorAction } from '../jobs/monitor.job';
import { showDockerMenu, showContainerList, showContainerInfo, handleContainerAction, showContainerLogs, showContainerStats } from './modules/docker.handler';
import { showPingMenu, showPingAddPrompt, showPingEditPrompt, handleAddPingTarget, handleEditPingTarget, handleDeletePingTarget, checkPingNow } from './modules/ping.handler';
import { approveFix, rejectFix, AutoFixService } from '../services/autoFix.service';
import {
    showReminderMenu, showReminderAddStep1, showReminderAddStep2, showReminderAddStep3,
    resolveReminderTime, saveReminder, handleDeleteReminder, handleAddReminder,
    showNotesMenu, showNoteAddPrompt, showNoteDetail, handleEditNote, handleDeleteNote, handleSearchNotes, handleAddNote,
    showLaporanSchedule, showSchedulePicker, handleSetSchedule, handleSetReportScheduleEnabled,
} from './modules/reminder.handler';
import {
    buildDailyReport,
    getReportDestinations,
    setReportDestination,
} from '../jobs/reporter.job';
import { TEKS } from '../config/persona';
import { getAIProviderStatus, saveAIProviderConfig } from '../services/ai.service';
import {
    addAuthorizedTelegramUser,
    getAuthorizedTelegramUsers,
    getAlertDestinationSettings,
    getAlertSubscribers,
    isTelegramAdmin,
    isTelegramUserAuthorized,
    removeAuthorizedTelegramUser,
    setAlertSubscription,
    updateAuthorizedTelegramUser,
} from '../services/alert.service';

// --- IMPORT RELEVANT QUERIES & HANDLERS (FIX MERAH) ---
import {
    getAliasFromDB, getAliasById, addAliasToDB, updateAliasInDB, getAllAliases, removeAliasFromDB,
    clearChatHistory, getAllChatHistory, getAllAliasesForBackup,
    importChatHistory, importAliases, getMikrotikStats, getMikrotikDeviceById,
    getMikrotikDevices, updateMikrotikDevice, saveMikrotikDevice, updateReminderMessage
} from '../database/queries';

import {
    handleMikrotikLogs,
    handleMikrotikBackup
} from './modules/mikrotik.handler';
import { getClusterById, testClusterConnection, updateCluster } from '../services/proxmox.service';
import { inputControls } from './inputControls';

// ------------------------------------------------------

import { Client } from 'ssh2';
import * as fs from 'fs';
import * as path from 'path';
import fetch from 'node-fetch';

// Session state per user
const remoteSessions = new Map<number, any>();

const userSessions = new Map<number, { step: string; data?: any }>();

/** Mengedit pesan Telegram atau mengirim pesan pengganti jika edit gagal. */
const safeEdit = async (ctx: any, text: string, extra?: any): Promise<any> => {
    try {
        return await ctx.editMessageText(text, extra);
    } catch (err: any) {
        if (err.message?.includes('message is not modified')) return;
        return ctx.reply(text, extra).catch(() => {});
    }
};

/** Mengonfirmasi callback Telegram agar indikator loading segera hilang. */
const ack = async (ctx: any, text?: string) => {
    try {
        await ctx.answerCbQuery(text || '').catch(() => {});
    } catch {}
};

/** Mendaftarkan command, menu, dan alur interaksi bot Telegram. */
export const registerHandlers = (bot: Telegraf, MY_CHAT_ID: string) => {
    bot.use(async (ctx, next) => {
        const userId = ctx.from ? String(ctx.from.id) : '';
        if (!userId || !(await isTelegramUserAuthorized(userId, MY_CHAT_ID))) {
            if (ctx.chat?.type === 'private') {
                return ctx.reply(
                    `Akses ditolak${userId ? `. Telegram ID kamu: ${userId}` : ''}. ` +
                    'Minta admin menambahkan ID kamu ke daftar user bot.',
                );
            }
            return;
        }
        return next();
    });

    /** Membuat isi dan tombol menu utama sesuai hak akses user. */
    const getMainMenu = (showAdminMenu: boolean) => ({
        text: TEKS.menuUtama(),
        markup: {
            inline_keyboard: [
                [{ text: '📊 Status', callback_data: 'status' }, { text: '🛡️ Monitor', callback_data: 'menu_monitor' }],
                [{ text: '🌐 SSH', callback_data: 'menu_ssh' }, { text: '📋 Alias SSH', callback_data: 'list_aliases' }],
                [{ text: '🖥️ Proxmox', callback_data: 'menu_proxmox' }, { text: '🐳 Docker', callback_data: 'menu_docker' }],
                [{ text: '📡 Ping', callback_data: 'menu_ping' }, { text: '🔍 Troubleshoot', callback_data: 'menu_troubleshoot' }],
                [{ text: '📟 MikroTik', callback_data: 'menu_mikrotik' }, { text: '📈 Laporan', callback_data: 'menu_laporan' }],
                [{ text: '⏰ Reminder', callback_data: 'menu_reminder' }, { text: '📝 Catatan', callback_data: 'menu_notes' }],
                [{ text: '⚙️ Maintenance', callback_data: 'menu_maintenance' }],
                showAdminMenu
                    ? [
                        { text: '👥 Kelola User', callback_data: 'admin_users' },
                        { text: '📣 Kelola Alert', callback_data: 'admin_alerts' },
                    ]
                    : [{ text: '❌ Tutup Menu', callback_data: 'close_menu' }],
                ...(showAdminMenu
                    ? [[
                        { text: '🤖 Provider AI', callback_data: 'admin_ai_provider' },
                        { text: '❌ Tutup', callback_data: 'close_menu' },
                    ]]
                    : []),
            ],
        },
    });

    /** Mengirim menu utama sebagai pesan baru. */
    const sendHelp = (ctx: any) => {
        const menu = getMainMenu(isTelegramAdmin(String(ctx.from.id), MY_CHAT_ID));
        return ctx.reply(menu.text, { parse_mode: 'Markdown', reply_markup: menu.markup });
    };

    /** Mengembalikan pesan menu aktif ke menu utama. */
    const editToHelp = (ctx: any) => {
        const menu = getMainMenu(isTelegramAdmin(String(ctx.from.id), MY_CHAT_ID));
        return safeEdit(ctx, menu.text, { parse_mode: 'Markdown', reply_markup: menu.markup });
    };

    /** Menampilkan menu admin untuk mengelola user Telegram yang diizinkan. */
    const showUserManagement = async (ctx: any) => {
        if (!isTelegramAdmin(String(ctx.from.id), MY_CHAT_ID) || ctx.chat?.type !== 'private') {
            await ack(ctx, 'Menu ini hanya tersedia untuk admin melalui chat pribadi.');
            return;
        }

        const users = await getAuthorizedTelegramUsers();
        const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
            [{ text: '➕ Tambah user', callback_data: 'admin_user_add' }],
        ];
        for (const id of users) {
            keyboard.push([
                { text: `✏️ Edit ${id}`, callback_data: `admin_user_edit_${id}` },
                { text: `🗑 Hapus`, callback_data: `admin_user_remove_${id}` },
            ]);
        }
        keyboard.push([{ text: '⬅️ Kembali ke menu', callback_data: 'back_to_help' }]);

        const message = users.length
            ? `👥 *Kelola User Bot*\n\nUser yang diizinkan:\n${users.map(id => `• \`${id}\``).join('\n')}\n\nPilih Edit untuk mengganti ID atau Hapus untuk mencabut akses.`
            : '👥 *Kelola User Bot*\n\nBelum ada user tambahan.';
        await ack(ctx);
        return safeEdit(ctx, message, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard },
        });
    };

    /** Menampilkan dan mengatur tujuan langganan alert Telegram. */
    const showAlertManagement = async (ctx: any) => {
        if (!isTelegramAdmin(String(ctx.from.id), MY_CHAT_ID) || ctx.chat?.type !== 'private') {
            await ack(ctx, 'Menu ini hanya tersedia untuk admin melalui chat pribadi.');
            return;
        }

        const destinations = await getAlertDestinationSettings();
        const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
        const labels = new Map<string, string>();
        await Promise.all(destinations.map(async destination => {
            try {
                const chat = await ctx.telegram.getChat(destination.chatId);
                if (chat.type === 'private') {
                    const name = [chat.first_name, chat.last_name].filter(Boolean).join(' ');
                    const username = chat.username ? ` @${chat.username}` : '';
                    labels.set(
                        destination.chatId,
                        `${name || destination.title || 'PM'}${username} (${destination.chatId})`,
                    );
                } else {
                    labels.set(
                        destination.chatId,
                        `${chat.title} (${destination.chatId})`,
                    );
                }
            } catch (error) {
                console.warn(`Gagal mengambil nama chat alert ${destination.chatId}:`, error);
            }
        }));
        for (const destination of destinations) {
            const type = destination.chatId.startsWith('-') ? 'Grup' : 'PM';
            const label = labels.get(destination.chatId)
                || `${destination.title || type} (${destination.chatId})`;
            keyboard.push([{
                text: `${destination.enabled ? '🔔' : '🔕'} ${label}${destination.configuredInEnv ? ' [env]' : ''}`,
                callback_data: `alert_toggle_${destination.chatId}`,
            }]);
        }
        keyboard.push([{ text: '⬅️ Kembali ke menu', callback_data: 'back_to_help' }]);

        const message = destinations.length
            ? '📣 *Tujuan Alert Server*\n\nGrup akan terdeteksi otomatis setelah bot ditambahkan atau menerima pesan di grup. Pilih tujuan untuk menyalakan atau mematikan alert. Perubahan ini mengesampingkan `.env` untuk chat tersebut.'
            : '📣 *Tujuan Alert Server*\n\nBelum ada grup yang terdeteksi. Tambahkan bot ke grup atau kirim pesan/perintah di grup; grup akan muncul otomatis di sini.';
        await ack(ctx);
        return safeEdit(ctx, message, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard },
        });
    };

    const showReportDestinations = async (ctx: any) => {
        if (!isTelegramAdmin(String(ctx.from.id), MY_CHAT_ID) || ctx.chat?.type !== 'private') {
            await ack(ctx, 'Pengaturan tujuan laporan hanya tersedia untuk admin melalui chat pribadi.');
            return;
        }

        const destinations = await getReportDestinations();
        const labels = new Map<string, string>();
        await Promise.all(destinations.map(async destination => {
            try {
                const chat = await ctx.telegram.getChat(destination.chatId);
                if (chat.type === 'private') {
                    const name = [chat.first_name, chat.last_name].filter(Boolean).join(' ');
                    const username = chat.username ? ` @${chat.username}` : '';
                    labels.set(destination.chatId, `${name || 'PM'}${username} (${destination.chatId})`);
                } else {
                    labels.set(destination.chatId, `${chat.title} (${destination.chatId})`);
                }
            } catch (error) {
                console.warn(`Gagal mengambil nama tujuan laporan ${destination.chatId}:`, error);
            }
        }));

        const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
        for (const destination of destinations) {
            const label = labels.get(destination.chatId)
                || `${destination.title || 'Chat'} (${destination.chatId})`;
            keyboard.push([{
                text: `${destination.enabled ? '🔔' : '🔕'} ${label}`,
                callback_data: `report_dest_toggle_${destination.chatId}`,
            }]);
        }
        keyboard.push([{ text: '⬅️ Kembali ke jadwal laporan', callback_data: 'laporan_schedule' }]);
        await ack(ctx);
        return safeEdit(
            ctx,
            '📬 *Tujuan Laporan Terjadwal*\n\nPilih PM/grup untuk mengaktifkan atau mematikan penerimaan laporan harian dan mingguan. Pengaturan ini terpisah dari tujuan alert.',
            { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } },
        );
    };

    /** Menampilkan status dan pilihan konfigurasi provider AI. */
    const showAIProviderMenu = async (ctx: any) => {
        if (!isTelegramAdmin(String(ctx.from.id), MY_CHAT_ID) || ctx.chat?.type !== 'private') {
            await ack(ctx, 'Konfigurasi AI hanya tersedia untuk admin melalui chat pribadi.');
            return;
        }
        const status = await getAIProviderStatus();
        const keyboard = [
            [
                { text: 'Groq', callback_data: 'ai_provider_groq' },
                { text: 'OpenAI', callback_data: 'ai_provider_openai' },
            ],
            [
                { text: 'OpenRouter', callback_data: 'ai_provider_openrouter' },
                { text: 'Gemini', callback_data: 'ai_provider_gemini' },
            ],
            [
                { text: '9Router', callback_data: 'ai_provider_9router' },
                { text: 'Custom API', callback_data: 'ai_provider_custom' },
            ],
            [{ text: '⬅️ Kembali ke menu', callback_data: 'back_to_help' }],
        ];
        const source = status.source === 'database' ? 'Database' : 'Environment (.env)';
        await ack(ctx);
        return safeEdit(
            ctx,
            `🤖 Konfigurasi Provider AI\n\nProvider: ${status.provider}\nModel: ${status.model}\nAPI key: ${status.configured ? 'tersimpan (tidak ditampilkan)' : 'belum diatur'}\nSumber konfigurasi: ${source}\n\nPilih provider untuk memperbarui konfigurasi. API key disimpan ke database dan tidak ditampilkan kembali.`,
            { reply_markup: { inline_keyboard: keyboard } },
        );
    };

    const aiConfigControls = {
        inline_keyboard: [[
            { text: '⬅️ Kembali', callback_data: 'ai_config_back' },
            { text: '❌ Batal', callback_data: 'ai_config_cancel' },
        ]],
    };

    bot.start((ctx) => sendHelp(ctx));

    bot.command('cancel', ctx => {
        const session = remoteSessions.get(ctx.from.id);
        if (!session) return ctx.reply('Tidak ada proses input yang sedang berjalan.');
        remoteSessions.delete(ctx.from.id);
        cancelSessionTimeout(ctx.from.id);
        const message = session.step?.startsWith('ai_config_')
            ? 'Konfigurasi AI dibatalkan; nilai yang belum disimpan dihapus.'
            : 'Proses dibatalkan.';
        return ctx.reply(message, {
            reply_markup: { inline_keyboard: [[{ text: '⬅️ Kembali ke menu', callback_data: 'back_to_help' }]] },
        });
    });

    bot.command('users', async ctx => {
        const adminId = String(ctx.from.id);
        if (!isTelegramAdmin(adminId, MY_CHAT_ID)) {
            return ctx.reply('Perintah ini hanya untuk admin bot.');
        }
        if (ctx.chat.type !== 'private') {
            return ctx.reply('Kelola akses user lewat chat pribadi bot: /users.');
        }

        const [, action = 'list', targetId] = ctx.message.text.trim().split(/\s+/);
        if (action === 'add' || action === 'remove') {
            if (!targetId || !/^\d+$/.test(targetId)) {
                return ctx.reply(
                    `Format: /users ${action} <telegram_user_id>\n` +
                    'Contoh: /users add 123456789',
                );
            }
            if (isTelegramAdmin(targetId, MY_CHAT_ID)) {
                return ctx.reply('Admin di TELEGRAM_ADMIN_USER_IDS tidak bisa dihapus dari daftar admin.');
            }

            if (action === 'add') {
                await addAuthorizedTelegramUser(targetId, adminId);
                return ctx.reply(`✅ User ${targetId} sekarang dapat menggunakan bot.`);
            }
            await removeAuthorizedTelegramUser(targetId);
            return ctx.reply(`✅ Akses user ${targetId} sudah dihapus.`);
        }
        if (action !== 'list') {
            return ctx.reply('Gunakan /users, /users add <id>, atau /users remove <id>.');
        }

        const users = await getAuthorizedTelegramUsers();
        return ctx.reply(
            users.length
                ? `User yang diizinkan:\n${users.map(id => `• ${id}`).join('\n')}`
                : 'Belum ada user tambahan yang diizinkan.',
        );
    });

    bot.command('alerts', async ctx => {
        const action = ctx.message.text.trim().split(/\s+/)[1] || 'status';
        const chatId = String(ctx.chat.id);

        if (action === 'on') {
            await setAlertSubscription(chatId, true);
            return ctx.reply('✅ Alert server sekarang dikirim ke chat ini.');
        }
        if (action === 'off') {
            await setAlertSubscription(chatId, false);
            return ctx.reply('🔕 Alert server tidak lagi dikirim ke chat ini.');
        }
        if (action !== 'status') {
            return ctx.reply('Gunakan /alerts on, /alerts off, atau /alerts status.');
        }

        const subscribers = await getAlertSubscribers();
        const subscribed = subscribers.includes(chatId);
        return ctx.reply(
            `Status alert: ${subscribed ? 'aktif' : 'nonaktif'}.\n` +
            'Gunakan /alerts on untuk berlangganan atau /alerts off untuk berhenti.',
        );
    });

    bot.on('callback_query', async (ctx: any) => {
        let data     = ctx.callbackQuery.data as string;
        const userId = ctx.from.id;

        const cancelInputMatch = data.match(/^cancel_input:(back_to_help|menu_[a-z_]+|list_aliases|admin_users|menu_maintenance)$/);
        if (cancelInputMatch) {
            remoteSessions.delete(userId);
            cancelSessionTimeout(userId);
            data = cancelInputMatch[1];
        }

        if (data === 'back_to_help') { await ack(ctx); return editToHelp(ctx); }
        if (data === 'close_menu')   { await ack(ctx); return ctx.deleteMessage().catch(() => {}); }
        if (data === 'admin_users') return showUserManagement(ctx);
        if (data === 'admin_alerts') return showAlertManagement(ctx);
        if (data === 'admin_ai_provider') return showAIProviderMenu(ctx);

        if (data === 'ai_config_back' || data === 'ai_config_cancel') {
            if (!isTelegramAdmin(String(userId), MY_CHAT_ID) || ctx.chat?.type !== 'private') {
                await ack(ctx, 'Konfigurasi AI hanya tersedia untuk admin melalui chat pribadi.');
                return;
            }
            const session = remoteSessions.get(userId);
            if (!session?.step?.startsWith('ai_config_')) {
                await ack(ctx, 'Tidak ada konfigurasi AI yang sedang berjalan.');
                return showAIProviderMenu(ctx);
            }
            if (data === 'ai_config_cancel') {
                remoteSessions.delete(userId);
                await ack(ctx, 'Konfigurasi dibatalkan.');
                return showAIProviderMenu(ctx);
            }

            if (session.step === 'ai_config_base_url') {
                remoteSessions.set(userId, { ...session, step: 'ai_config_model' });
                await ack(ctx);
                return ctx.reply(
                    `Masukkan model ID untuk ${session.provider} (nama model dari dashboard provider).`,
                    { reply_markup: aiConfigControls },
                );
            }
            if (session.step === 'ai_config_model') {
                remoteSessions.set(userId, { ...session, step: 'ai_config_key' });
                await ack(ctx);
                return ctx.reply(
                    `Masukkan API key untuk provider ${session.provider}. Key tidak akan ditampilkan kembali.`,
                    { reply_markup: aiConfigControls },
                );
            }
            remoteSessions.delete(userId);
            await ack(ctx);
            return showAIProviderMenu(ctx);
        }

        const aiProviderMatch = data.match(/^ai_provider_(groq|openai|openrouter|gemini|9router|custom)$/);
        if (aiProviderMatch) {
            if (!isTelegramAdmin(String(userId), MY_CHAT_ID) || ctx.chat?.type !== 'private') {
                await ack(ctx, 'Konfigurasi AI hanya tersedia untuk admin melalui chat pribadi.');
                return;
            }
            const provider = aiProviderMatch[1];
            remoteSessions.set(userId, { step: 'ai_config_key', provider });
            await ack(ctx);
            return ctx.reply(
                `Masukkan API key untuk provider ${provider}. Key tidak akan ditampilkan kembali. Kirim hanya di chat pribadi ini, bukan di grup. Ketik /cancel untuk membatalkan.`,
                { reply_markup: aiConfigControls },
            );
        }

        const alertToggleMatch = data.match(/^alert_toggle_(-?\d+)$/);
        if (alertToggleMatch) {
            if (!isTelegramAdmin(String(userId), MY_CHAT_ID) || ctx.chat?.type !== 'private') {
                await ack(ctx, 'Menu ini hanya tersedia untuk admin melalui chat pribadi.');
                return;
            }
            const chatId = alertToggleMatch[1];
            const destination = (await getAlertDestinationSettings())
                .find(item => item.chatId === chatId);
            if (!destination) {
                await ack(ctx, 'Tujuan alert tidak ditemukan.');
                return showAlertManagement(ctx);
            }
            await setAlertSubscription(chatId, !destination.enabled);
            await ack(ctx, `Alert ${!destination.enabled ? 'dinyalakan' : 'dimatikan'}`);
            return showAlertManagement(ctx);
        }

        if (data === 'admin_user_add') {
            await ack(ctx);
            if (!isTelegramAdmin(String(userId), MY_CHAT_ID) || ctx.chat?.type !== 'private') {
                return ctx.reply('Tambah user hanya tersedia untuk admin lewat chat pribadi.');
            }
            remoteSessions.set(userId, { step: 'add_telegram_user' });
            return ctx.reply('Kirim Telegram user ID yang ingin diberi akses. Ketik /cancel untuk membatalkan.', {
                reply_markup: inputControls('admin_users'),
            });
        }

        if (data.startsWith('admin_user_edit_')) {
            await ack(ctx);
            if (!isTelegramAdmin(String(userId), MY_CHAT_ID) || ctx.chat?.type !== 'private') {
                return ctx.reply('Edit user hanya tersedia untuk admin lewat chat pribadi.');
            }
            const targetId = data.slice('admin_user_edit_'.length);
            if (!/^\d+$/.test(targetId)) return ctx.reply('User ID tidak valid.', {
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Kembali ke Kelola User', callback_data: 'admin_users' }]] },
            });
            remoteSessions.set(userId, { step: 'edit_telegram_user', targetId });
            return ctx.reply(
                `Kirim Telegram user ID baru untuk mengganti \`${targetId}\`. Ketik /cancel untuk membatalkan.`,
                { parse_mode: 'Markdown', reply_markup: inputControls('admin_users') },
            );
        }

        if (data.startsWith('admin_user_remove_') && !data.startsWith('admin_user_remove_confirm_')) {
            await ack(ctx);
            if (!isTelegramAdmin(String(userId), MY_CHAT_ID) || ctx.chat?.type !== 'private') {
                return ctx.reply('Pengelolaan user hanya tersedia untuk admin lewat chat pribadi.');
            }
            const targetId = data.slice('admin_user_remove_'.length);
            if (!/^\d+$/.test(targetId) || isTelegramAdmin(targetId, MY_CHAT_ID)) {
                return ctx.reply('User tidak valid atau merupakan admin.');
            }
            return safeEdit(ctx, `Cabut akses user \`${targetId}\`?`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '✅ Ya, cabut akses', callback_data: `admin_user_remove_confirm_${targetId}` },
                        { text: 'Batal', callback_data: 'admin_users' },
                    ]],
                },
            });
        }

        if (data.startsWith('admin_user_remove_confirm_')) {
            await ack(ctx);
            if (!isTelegramAdmin(String(userId), MY_CHAT_ID) || ctx.chat?.type !== 'private') {
                return ctx.reply('Pengelolaan user hanya tersedia untuk admin lewat chat pribadi.');
            }
            const targetId = data.slice('admin_user_remove_confirm_'.length);
            if (!/^\d+$/.test(targetId) || isTelegramAdmin(targetId, MY_CHAT_ID)) {
                return ctx.reply('User tidak valid atau merupakan admin.');
            }
            await removeAuthorizedTelegramUser(targetId);
            return showUserManagement(ctx);
        }

        if (data === 'menu_ssh') {
            await ack(ctx);
            if (String(remoteSessions.get(userId)?.step || '').startsWith('alias_')) remoteSessions.delete(userId);
            return safeEdit(ctx, TEKS.menuSSH(), {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '➕ Tambah Alias',      callback_data: 'add_alias_info' }],
                        [{ text: '📋 Lihat Semua Alias', callback_data: 'list_aliases'   }],
                        [{ text: '⬅️ Kembali',           callback_data: 'back_to_help'   }],
                    ],
                },
            });
        }

        if (data === 'list_aliases') {
            await ack(ctx);
            if (String(remoteSessions.get(userId)?.step || '').startsWith('alias_')) remoteSessions.delete(userId);
            const aliases = await getAllAliases();
            
            if (!aliases.length) {
                return safeEdit(ctx, "📋 **Daftar Alias Kosong**\nBelum ada server yang terdaftar.", {
                    reply_markup: { inline_keyboard: [[{ text: '⬅️ Kembali', callback_data: 'menu_ssh' }]] },
                });
            }

            // Map daftar alias menjadi baris tombol: [Nama Alias] [Tombol Hapus]
            const keyboard = aliases.map((a: any) => [
                { text: `🔗 ssh ${a.alias}`, callback_data: `info_ssh_${a.id}` },
                { text: '✏️ Edit', callback_data: `edit_ssh_${a.id}` },
                { text: `🗑️ Hapus`, callback_data: `conf_del_ssh_${a.id}_${a.alias}` }
            ]);

            keyboard.push([{ text: '⬅️ Kembali', callback_data: 'menu_ssh' }]);

            return safeEdit(ctx, "📋 **Manajer Alias SSH**\nKlik nama alias untuk info atau ikon sampah untuk menghapus.", {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard },
            });
        }

                // --- TAHAP 1: Konfirmasi Hapus ---
        if (data.startsWith('conf_del_ssh_')) {
            await ack(ctx);
            const [, , , id, aliasName] = data.split('_');
            
            return safeEdit(ctx, `⚠️ **Konfirmasi Hapus**\n\nApakah Kakak yakin ingin menghapus alias \`${aliasName}\`?`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ Ya, Hapus', callback_data: `exec_del_ssh_${id}_${aliasName}` },
                            { text: '❌ Batal', callback_data: 'list_aliases' }
                        ]
                    ]
                }
            });
        }

        if (data.startsWith('exec_del_ssh_')) {
            await ack(ctx);
            const parts = data.split('_');
            const aliasName = parts[4]; // Sekarang indeks ke-4 ada isinya (Nama Alias)

            if (!aliasName) {
                console.log("Error: Nama alias tidak ditemukan di callback data");
                return;
            }

            const success = await removeAliasFromDB(aliasName);

            return safeEdit(ctx, success ? `✅ Alias *${aliasName}* berhasil dihapus!` : "❌ Gagal menghapus alias.", {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Kembali', callback_data: 'list_aliases' }]] }
            });
        }

        if (data === 'add_alias_info') {
            await ack(ctx);
            // Inisialisasi session menggunakan Map remoteSessions milik Kakak
            remoteSessions.set(ctx.from.id, { step: 'alias_name' });
            
            return safeEdit(ctx, "📝 **Langkah 1:**\nMasukkan nama **Alias** baru (misal: `pve-backup`)", {
                parse_mode: 'Markdown',
                reply_markup: inputControls('menu_ssh'),
            });
        }
        if (data.startsWith('edit_ssh_')) {
            await ack(ctx);
            if (ctx.chat?.type !== 'private') return ctx.reply('Edit alias SSH hanya tersedia lewat chat pribadi bot.');
            const alias = await getAliasById(Number(data.replace('edit_ssh_', '')));
            if (!alias) return ctx.reply('❌ Alias SSH tidak ditemukan.');
            remoteSessions.set(ctx.from.id, {
                step: 'alias_name',
                editing: true,
                originalAlias: alias.alias,
            });
            return safeEdit(ctx, `✏️ *Edit Alias SSH: ${alias.alias}*\n\nKirim nama alias baru untuk memulai edit. Lanjutkan dengan host, username, port, dan password baru.`, {
                parse_mode: 'Markdown',
                reply_markup: inputControls('list_aliases', 'Kembali ke Alias'),
            });
        }

        if (data === 'menu_maintenance') {
            await ack(ctx);
            return safeEdit(ctx, TEKS.menuMaintenance(), {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📥 Export Full Backup',     callback_data: 'export_data'  }],
                        [{ text: '🧹 Bersihkan Riwayat Chat', callback_data: 'clear_chat'   }],
                        [{ text: '⬅️ Kembali',                callback_data: 'back_to_help' }],
                    ],
                },
            });
        }

        if (data === 'clear_chat') {
            await ack(ctx);
            remoteSessions.set(userId, { step: 'confirm_clear' });
            return safeEdit(ctx, TEKS.konfirmasiClear(), {
                parse_mode: 'Markdown',
                reply_markup: inputControls('menu_maintenance'),
            });
        }

        if (data === 'export_data') {
            await ack(ctx, '📦 Menyiapkan backup...');
            const history = await getAllChatHistory(userId);
            const aliases = await getAllAliasesForBackup();
            const buffer  = Buffer.from(JSON.stringify({ chats: history, aliases, exported_at: new Date().toISOString() }, null, 2));
            return ctx.replyWithDocument(
                { source: buffer, filename: `shorekeeper_backup_${userId}.json` },
                { caption: TEKS.exportCaption(), parse_mode: 'Markdown' }
            );
        }

        if (data === 'menu_proxmox')  { await ack(ctx); return handleProxmoxMenu(ctx); }
        if (data === 'pve_list')      { await ack(ctx); return handleManagePulau(ctx); }
        if (data === 'pve_status')    { await ack(ctx); return handleCheckStatus(ctx); }
        if (data === 'status')        { await ack(ctx); return handleCheckStatus(ctx); }
        if (data === 'pve_add') {
            await ack(ctx);
            remoteSessions.set(userId, { pve_step: 'pve_name' });
            return showAddClusterPrompt(ctx);
        }
        if (data === 'pve_edit_menu') { await ack(ctx); return showEditClusterMenu(ctx); }
        if (data.startsWith('pve_edit_')) {
            await ack(ctx);
            if (ctx.chat?.type !== 'private') return ctx.reply('Edit cluster hanya tersedia lewat chat pribadi bot.');
            const clusterId = Number(data.replace('pve_edit_', ''));
            const cluster = Number.isSafeInteger(clusterId) ? await getClusterById(clusterId) : null;
            if (!cluster) return ctx.reply('Cluster tidak ditemukan.');
            remoteSessions.set(userId, { step: 'pve_edit', clusterId });
            return ctx.reply(
                `✏️ Edit cluster *${cluster.name}*. Kirim seluruh nilai dengan format:\n\`nama | host | port | user@realm | token_secret\`\nToken lama tidak ditampilkan. Ketik /cancel untuk membatalkan.`,
                { parse_mode: 'Markdown', reply_markup: inputControls('menu_proxmox') },
            );
        }
        if (data === 'pve_del_menu')  { await ack(ctx); return showDeleteClusterMenu(ctx); }

        if (data.startsWith('pve_del_') && !data.startsWith('pve_del_menu')) {
            const cId = parseInt(data.replace('pve_del_', ''));
            return handleDeleteCluster(ctx, cId);
        }

        if (data.startsWith('pve_info_')) {
            await ack(ctx);
            const p = data.split('_');
            return handleProxmoxAction(ctx, 'info', p[2], p[3], p[4], parseInt(p[5]));
        }

        if (data.startsWith('pve_exec_')) {
            const p = data.split('_');
            return handleProxmoxAction(ctx, 'exec', p[2], p[3], p[4], parseInt(p[6]));
        }

        if (data === 'menu_monitor') { await ack(ctx); return showMonitorMenu(ctx); }

        if (data.startsWith('mon_')) {
            const parts  = data.split('_');
            const action = parts[1];
            const alias  = parts.slice(2).join('_');
            return handleMonitorAction(ctx, action, alias);
        }

        if (data === 'menu_troubleshoot') {
            await ack(ctx);
            const aliases = await getAllAliases();
            return showTroubleshootMenu(ctx, aliases);
        }

        if (data.startsWith('ts_server_')) {
            await ack(ctx);
            const alias = data.replace('ts_server_', '');
            return showKategoriMenu(ctx, alias);
        }

        if (data.startsWith('ts_') && !data.startsWith('ts_server_')) {
            const parts    = data.split('_');
            const kategori = parts[1];
            const alias    = parts.slice(2).join('_');
            if (KATEGORI_LIST.includes(kategori)) {
                await ack(ctx);
                const server = await getAliasFromDB(alias);
                if (!server) return ctx.reply(TEKS.aliasTidakAda(), { parse_mode: 'Markdown' });
                return handleTroubleshoot(ctx, {
                    alias,
                    host:      server.host,
                    port:      server.port,
                    username: server.username,
                    password: server.password,
                }, kategori);
            }
        }

        if (data === 'menu_laporan') {
            await ack(ctx);
            return safeEdit(ctx, '📋 *Laporan Infrastruktur*\n\nPilih opsi:', {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📊 Laporan Sekarang',       callback_data: 'laporan_now'      }],
                        [{ text: '⏰ Atur Jadwal Laporan',     callback_data: 'laporan_schedule' }],
                        [{ text: '⬅️ Kembali',                 callback_data: 'back_to_help'     }],
                    ],
                },
            });
        }

        if (data === 'laporan_now') {
            await ack(ctx, '📋 Menyusun laporan...');
            const loading = await ctx.reply('📋 SK sedang menyusun laporan, mohon tunggu...');
            const hour    = new Date().getHours();
            const report  = await buildDailyReport(hour < 12 ? 'pagi' : 'malam');
            await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id).catch(() => {});
            return ctx.reply(report, {
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Kembali', callback_data: 'menu_laporan' }]] },
            });
        }

        if (data === 'laporan_schedule') {
            await ack(ctx);
            return showLaporanSchedule(ctx);
        }

        if (data === 'laporan_destinations') {
            return showReportDestinations(ctx);
        }

        const reportDestinationMatch = data.match(/^report_dest_toggle_(-?\d+)$/);
        if (reportDestinationMatch) {
            if (!isTelegramAdmin(String(userId), MY_CHAT_ID) || ctx.chat?.type !== 'private') {
                await ack(ctx, 'Pengaturan tujuan laporan hanya tersedia untuk admin melalui chat pribadi.');
                return;
            }
            const chatId = reportDestinationMatch[1];
            const destination = (await getReportDestinations())
                .find(item => item.chatId === chatId);
            if (!destination) {
                await ack(ctx, 'Tujuan laporan tidak ditemukan.');
                return showReportDestinations(ctx);
            }
            await setReportDestination(chatId, !destination.enabled);
            await ack(ctx, `Tujuan laporan ${!destination.enabled ? 'diaktifkan' : 'dimatikan'}`);
            return showReportDestinations(ctx);
        }

        if (/^sched_(enable|disable)_(pagi|malam)$/.test(data)) {
            const [, action, session] = data.split('_');
            return handleSetReportScheduleEnabled(ctx, session as 'pagi' | 'malam', action === 'enable');
        }

        if (data.startsWith('sched_set_')) {
            const parts   = data.split('_');
            const session = parts[2] as 'pagi' | 'malam';
            const hour    = parseInt(parts[3]);
            const minute  = parseInt(parts[4]);
            return handleSetSchedule(ctx, session, hour, minute);
        }

        if (data === 'sched_pagi') {
            await ack(ctx);
            return showSchedulePicker(ctx, 'pagi');
        }

        if (data === 'sched_malam') {
            await ack(ctx);
            return showSchedulePicker(ctx, 'malam');
        }

        if (data === 'menu_docker') { await ack(ctx); return showDockerMenu(ctx); }
        if (data.startsWith('dock_server_')) { return showContainerList(ctx, data.replace('dock_server_', '')); }
        if (data.startsWith('dock_info_')) { const parts = data.split('_'); return showContainerInfo(ctx, parts[2], parts[3]); }
        if (data.startsWith('dock_act_')) { const parts = data.split('_'); return handleContainerAction(ctx, parts[2], parts[3], parts[4]); }
        if (data.startsWith('dock_log_')) { const parts = data.split('_'); return showContainerLogs(ctx, parts[2], parts[3]); }
        if (data.startsWith('dock_stat_')) { const parts = data.split('_'); return showContainerStats(ctx, parts[2], parts[3]); }

        if (data === 'menu_reminder') { await ack(ctx); return showReminderMenu(ctx, userId); }
        if (data === 'rem_add_step1') {
            await ack(ctx);
            remoteSessions.set(userId, { step: 'rem_add_msg' });
            return showReminderAddStep1(ctx);
        }

        if (data.startsWith('rem_time_')) {
            await ack(ctx);
            const session  = remoteSessions.get(userId);
            const timeCode = data.replace('rem_time_', '');
            if (timeCode === 'custom') {
                remoteSessions.set(userId, { ...session, step: 'rem_add_time_custom' });
                return safeEdit(ctx, '✏️ Ketik waktu reminder:\nContoh: `jam 10 malam`, `besok jam 9 pagi`, `15 april jam 8`', {
                    parse_mode: 'Markdown',
                    reply_markup: inputControls('menu_reminder'),
                });
            }
            const remindAt = resolveReminderTime(timeCode);
            if (!remindAt) {
                return ctx.reply('❌ Waktu sudah lewat, pilih waktu lain.', {
                    reply_markup: { inline_keyboard: [[{ text: '⬅️ Kembali', callback_data: 'rem_add_step1' }]] },
                });
            }
            remoteSessions.set(userId, { ...session, step: 'rem_add_repeat', remindAt });
            return showReminderAddStep3(ctx);
        }

        if (data.startsWith('rem_repeat_')) {
            await ack(ctx);
            const session  = remoteSessions.get(userId);
            const repeat   = data.replace('rem_repeat_', '') as 'none' | 'daily' | 'weekly';
            const remindAt = session?.remindAt;
            const message  = session?.message;
            remoteSessions.delete(userId);
            if (!remindAt || !message) return ctx.reply('❌ Session expired, mulai ulang.');
            return saveReminder(ctx, userId, message, remindAt, repeat);
        }

        if (data.startsWith('rem_del_')) {
            const remId = parseInt(data.replace('rem_del_', ''));
            return handleDeleteReminder(ctx, userId, remId);
        }
        if (data.startsWith('rem_edit_')) {
            await ack(ctx);
            const reminderId = Number(data.replace('rem_edit_', ''));
            if (!Number.isSafeInteger(reminderId) || reminderId < 1) return ctx.reply('ID reminder tidak valid.');
            remoteSessions.set(userId, { step: 'rem_edit_message', reminderId });
            return ctx.reply('Kirim isi reminder yang baru. Ketik /cancel untuk membatalkan.', {
                reply_markup: inputControls('menu_reminder'),
            });
        }

        if (data === 'menu_notes') { await ack(ctx); return showNotesMenu(ctx, userId); }
        if (data === 'note_add_prompt') {
            await ack(ctx);
            remoteSessions.set(userId, { step: 'note_add' });
            return showNoteAddPrompt(ctx);
        }
        if (data.startsWith('note_tag_')) { await ack(ctx); return showNotesMenu(ctx, userId, data.replace('note_tag_', '')); }
        if (data.startsWith('note_edit_')) {
            await ack(ctx);
            const noteId = Number(data.replace('note_edit_', ''));
            if (!Number.isSafeInteger(noteId) || noteId < 1) return ctx.reply('ID catatan tidak valid.');
            remoteSessions.set(userId, { step: 'note_edit', noteId });
            return ctx.reply('Kirim catatan baru dengan format `#tag judul | isi` (tag opsional). Ketik /cancel untuk membatalkan.', {
                parse_mode: 'Markdown',
                reply_markup: inputControls('menu_notes'),
            });
        }
        if (data.startsWith('note_view_')) { await ack(ctx); return showNoteDetail(ctx, userId, parseInt(data.replace('note_view_', ''))); }
        if (data.startsWith('note_del_')) { return handleDeleteNote(ctx, userId, parseInt(data.replace('note_del_', ''))); }
        if (data === 'note_search_prompt') {
            await ack(ctx);
            remoteSessions.set(userId, { step: 'note_search' });
            return safeEdit(ctx, '🔍 *Cari Catatan*\n\nKetik kata kunci pencarian:', {
                parse_mode: 'Markdown',
                reply_markup: inputControls('menu_notes'),
            });
        }

        if (data === 'menu_ping') { await ack(ctx); return showPingMenu(ctx); }
        if (data === 'ping_check_now') return checkPingNow(ctx);
        if (data.startsWith('ping_edit_')) {
            await ack(ctx);
            const targetId = Number(data.replace('ping_edit_', ''));
            if (!Number.isSafeInteger(targetId) || targetId < 1) return ctx.reply('ID target tidak valid.');
            remoteSessions.set(userId, { step: 'ping_edit', targetId });
            return showPingEditPrompt(ctx, targetId);
        }
        if (data === 'ping_add_http') { await ack(ctx); remoteSessions.set(userId, { step: 'ping_add_http' }); return showPingAddPrompt(ctx, 'http'); }
        if (data === 'ping_add_ip') { await ack(ctx); remoteSessions.set(userId, { step: 'ping_add_ip' }); return showPingAddPrompt(ctx, 'ip'); }
        if (data.startsWith('ping_del_')) {
            const targetId = parseInt(data.replace('ping_del_', ''));
            return handleDeletePingTarget(ctx, targetId);
        }

        if (data.startsWith('autofix_approve_')) { return approveFix(ctx, data.replace('autofix_approve_', '')); }
        if (data.startsWith('autofix_reject_')) { return rejectFix(ctx, data.replace('autofix_reject_', '')); }

        // 📟 MIKROTIK HANDLERS (CLEANED)
        if (data === 'menu_mikrotik') {
            await ack(ctx);
            const devices = await getMikrotikDevices();
            let msg = '📟 *MikroTik Monitor*\n\nPilih perangkat untuk detail:';
            const keyboard = [];

            if (devices.length === 0) {
                msg = '📟 *MikroTik Monitor*\n\n_Belum ada perangkat terdaftar._';
            } else {
                devices.forEach((d: any) => {
                    const statusEmoji = d.status === 'up' ? '🟢' : '🔴';
                    keyboard.push([{ text: `${statusEmoji} ${d.alias}`, callback_data: `stat_mt_${d.id}` }]);
                });
            }
            keyboard.push([{ text: '➕ Tambah MikroTik', callback_data: 'add_mt_info' }]);
            keyboard.push([{ text: '⬅️ Kembali', callback_data: 'back_to_help' }]);

            return safeEdit(ctx, msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
        }

        if (data.startsWith('stat_mt_')) {
            await ack(ctx);
            const devId = parseInt(data.replace('stat_mt_', ''));
            const rows = await getMikrotikDeviceById(devId);
            const dev = rows[0];

            if (!dev) return ctx.reply('❌ Perangkat tidak ditemukan.');
            const statusEmoji = dev.status === 'up' ? '🟢' : '🔴';
            const detailMsg = `📟 *Detail MikroTik: ${dev.alias}*\n` +
                            `───────────────────\n` +
                            `🌐 Host: \`${dev.host}\`\n` +
                            `🚦 Status: ${statusEmoji} ${dev.status.toUpperCase()}\n` +
                            `🔥 CPU: \`${dev.last_cpu}%\`\n` +
                            `⏳ Uptime: \`${dev.last_uptime}\`\n` +
                            `📥 RX: \`${dev.rx_rate || '0bps'}\` | 📤 TX: \`${dev.tx_rate || '0bps'}\`\n` +
                            `🕒 Check: _${new Date(dev.last_check).toLocaleString('id-ID')}_\n` +
                            `───────────────────`;

            return safeEdit(ctx, detailMsg, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📊 Grafik Trafik', callback_data: `menu_graph_${dev.id}` }, { text: '📜 Log Router', callback_data: `log_mt_${dev.id}` }],
                        [{ text: '✏️ Edit Perangkat', callback_data: `mt_edit_${dev.id}` }],
                        [{ text: '💾 Backup Konfigurasi (.rsc)', callback_data: `backup_mt_${dev.id}` }],
                        [{ text: '⬅️ Kembali ke Daftar', callback_data: 'menu_mikrotik' }]
                    ]
                }
            });
        }

        if (data.startsWith('mt_edit_')) {
            await ack(ctx);
            if (ctx.chat?.type !== 'private') return ctx.reply('Edit MikroTik hanya tersedia lewat chat pribadi bot.');
            const deviceId = Number(data.replace('mt_edit_', ''));
            const [device] = Number.isSafeInteger(deviceId) ? await getMikrotikDeviceById(deviceId) : [];
            if (!device) return ctx.reply('Perangkat MikroTik tidak ditemukan.');
            remoteSessions.set(userId, { step: 'mt_edit', deviceId });
            return ctx.reply(
                `✏️ Edit MikroTik *${device.alias}*. Kirim seluruh nilai dengan format:\n\`alias | host | port | username | password\`\nKetik /cancel untuk membatalkan.`,
                { parse_mode: 'Markdown', reply_markup: inputControls('menu_mikrotik') },
            );
        }

        if (data.startsWith('log_mt_')) {
            const devId = parseInt(data.replace('log_mt_', ''));
            await ack(ctx, '📜 Mengambil log...');
            const rows = await getMikrotikDeviceById(devId);
            return handleMikrotikLogs(ctx, rows[0]);
        }

        if (data.startsWith('backup_mt_')) {
            const devId = parseInt(data.replace('backup_mt_', ''));
            await ack(ctx, '💾 Menyiapkan backup...');
            const rows = await getMikrotikDeviceById(devId);
            return handleMikrotikBackup(ctx, rows[0]);
        }

        if (data.startsWith('menu_graph_')) {
            await ack(ctx);
            const deviceId = data.replace('menu_graph_', '');
            return safeEdit(ctx, '📊 *Pilih Rentang Waktu Grafik:*', {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🕒 24 Jam Terakhir', callback_data: `gen_graph_${deviceId}_24` }],
                        [{ text: '📅 7 Hari Terakhir', callback_data: `gen_graph_${deviceId}_168` }],
                        [{ text: '🗓️ 30 Hari Terakhir', callback_data: `gen_graph_${deviceId}_720` }],
                        [{ text: '⬅️ Kembali', callback_data: `stat_mt_${deviceId}` }]
                    ]
                }
            });
        }

        if (data.startsWith('gen_graph_')) {
            const parts = data.split('_');
            const deviceId = parseInt(parts[2]);
            const hours = parseInt(parts[3]);
            await ack(ctx, '⏳ Sedang menggambar...');
            
            try {
                const rows = await getMikrotikDeviceById(deviceId);
                const device = rows[0];
                const stats = await getMikrotikStats(deviceId, hours);

                if (!stats || stats.length < 2) {
                    return ctx.reply('❌ Data histori belum cukup untuk membuat grafik. Tunggu Shorekeeper mengumpulkan data.');
                }

                const { generateMikrotikChart } = await import('../utils/graphGenerator');
                const imageBuffer = await generateMikrotikChart(device.alias, stats);
                await ctx.replyWithPhoto({ source: imageBuffer }, {
                    caption: `📊 **Grafik Trafik: ${device.alias}**\nRentang: ${hours/24} hari terakhir.`,
                    parse_mode: 'Markdown'
                });
            } catch (err) {
                console.error('Gagal membuat grafik MikroTik:', err);
                return ctx.reply(
                    '❌ Gagal membuat grafik. Pastikan dependensi native canvas sudah dipasang ulang di server Linux.',
                );
            }
        }
        
        await ack(ctx);
    });

    bot.on('text', async (ctx) => {
        const userId     = ctx.from.id;
        const userInput  = ctx.message.text;
        const lowerInput = userInput.toLowerCase();
        const session    = remoteSessions.get(userId);

        if (session && /^\/cancel(?:@\w+)?$/i.test(userInput.trim())) {
            remoteSessions.delete(userId);
            const message = session.step?.startsWith('ai_config_')
                ? 'Konfigurasi AI dibatalkan; nilai yang belum disimpan dihapus.'
                : session.step === 'add_telegram_user' || session.step === 'edit_telegram_user'
                    ? 'Pengelolaan user dibatalkan.'
                    : 'Proses dibatalkan.';
            return ctx.reply(message, {
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Kembali ke menu', callback_data: 'back_to_help' }]] },
            });
        }

        if (session?.step === 'add_telegram_user' || session?.step === 'edit_telegram_user') {
            if (!isTelegramAdmin(String(userId), MY_CHAT_ID) || ctx.chat.type !== 'private') {
                remoteSessions.delete(userId);
                return;
            }
            if (/^\/cancel(?:@\w+)?$/i.test(userInput.trim())) {
                remoteSessions.delete(userId);
                return ctx.reply('Pengelolaan user dibatalkan.');
            }
            const targetId = userInput.trim();
            if (!/^\d+$/.test(targetId)) {
                return ctx.reply('ID harus berupa angka. Coba lagi atau ketik /cancel.', {
                    reply_markup: inputControls('admin_users'),
                });
            }
            if (session.step === 'edit_telegram_user' && targetId === session.targetId) {
                return ctx.reply('ID baru sama dengan ID saat ini. Kirim ID lain atau ketik /cancel.', {
                    reply_markup: inputControls('admin_users'),
                });
            }
            if (isTelegramAdmin(targetId, MY_CHAT_ID)) {
                remoteSessions.delete(userId);
                return ctx.reply('ID tersebut sudah menjadi admin.', {
                    reply_markup: { inline_keyboard: [[{ text: '⬅️ Kembali ke Kelola User', callback_data: 'admin_users' }]] },
                });
            }
            if (session.step === 'edit_telegram_user') {
                if (await isTelegramUserAuthorized(targetId, MY_CHAT_ID)) {
                    return ctx.reply('ID tersebut sudah memiliki akses. Kirim ID lain atau ketik /cancel.', {
                        reply_markup: inputControls('admin_users'),
                    });
                }
                const updated = await updateAuthorizedTelegramUser(session.targetId, targetId, String(userId));
                if (!updated) {
                    remoteSessions.delete(userId);
                    return ctx.reply('User yang dipilih sudah tidak terdaftar. Buka kembali menu Kelola User.');
                }
            } else {
                await addAuthorizedTelegramUser(targetId, String(userId));
            }
            remoteSessions.delete(userId);
            await ctx.reply(
                session.step === 'edit_telegram_user'
                    ? `✅ ID user berhasil diubah menjadi ${targetId}.`
                    : `✅ User ${targetId} berhasil ditambahkan.`,
            );
            return showUserManagement(ctx);
        }

        if (session?.step?.startsWith('ai_config_')) {
            if (!isTelegramAdmin(String(userId), MY_CHAT_ID) || ctx.chat.type !== 'private') {
                remoteSessions.delete(userId);
                return;
            }
            if (/^\/cancel(?:@\w+)?$/i.test(userInput.trim())) {
                remoteSessions.delete(userId);
                return ctx.reply('Konfigurasi AI dibatalkan; nilai yang belum disimpan dihapus.');
            }

            if (session.step === 'ai_config_key') {
                const apiKey = userInput.trim();
                if (!apiKey || apiKey.length > 500 || /[\r\n]/.test(apiKey)) {
                    return ctx.reply('API key tidak valid (maksimum 500 karakter). Coba lagi atau pilih Kembali/Batal.', {
                        reply_markup: aiConfigControls,
                    });
                }
                try {
                    await ctx.deleteMessage();
                } catch {
                    console.warn('Pesan API key tidak dapat dihapus otomatis. Admin perlu menghapusnya dari riwayat chat secara manual.');
                }
                remoteSessions.set(userId, { ...session, step: 'ai_config_model', apiKey });
                return ctx.reply(`Masukkan model ID untuk ${session.provider} (nama model dari dashboard provider). Jika pesan API key masih terlihat di riwayat, hapus secara manual.`, {
                    reply_markup: aiConfigControls,
                });
            }

            if (session.step === 'ai_config_model') {
                const model = userInput.trim();
                if (!model || model.length > 200 || /[\r\n]/.test(model)) {
                    return ctx.reply('Model ID tidak valid (maksimum 200 karakter). Coba lagi atau pilih Kembali/Batal.', {
                        reply_markup: aiConfigControls,
                    });
                }
                remoteSessions.set(userId, { ...session, step: 'ai_config_base_url', model });
                return ctx.reply(
                    session.provider === 'custom'
                        ? 'Masukkan base URL API OpenAI-compatible (contoh: https://api.example.com/v1).'
                        : 'Masukkan base URL kustom atau ketik `default` untuk memakai endpoint bawaan provider.',
                    { reply_markup: aiConfigControls },
                );
            }

            if (session.step === 'ai_config_base_url') {
                const enteredBaseURL = userInput.trim();
                const baseURL = enteredBaseURL.toLowerCase() === 'default' ? '' : enteredBaseURL;
                if ((session.provider === 'custom' && !baseURL)
                    || (baseURL && (!/^https?:\/\/[^ ]+$/i.test(baseURL) || baseURL.length > 500))) {
                    return ctx.reply('Base URL tidak valid. Gunakan alamat HTTP/HTTPS, atau pilih Kembali/Batal.', {
                        reply_markup: aiConfigControls,
                    });
                }
                try {
                    await saveAIProviderConfig({
                        provider: session.provider,
                        apiKey: session.apiKey,
                        model: session.model,
                        baseURL,
                    });
                } catch (error) {
                    console.error('Gagal menyimpan konfigurasi AI:', error);
                    remoteSessions.delete(userId);
                    return ctx.reply('❌ Gagal menyimpan konfigurasi AI ke database. Periksa koneksi database dan coba lagi.');
                }
                remoteSessions.delete(userId);
                return ctx.reply(
                    `✅ Provider AI ${session.provider} tersimpan di database.\nModel: ${session.model}\nAPI key tidak ditampilkan.\n\nKetik /start lalu buka 🤖 Provider AI untuk mengubahnya.`,
                );
            }
        }

        if (session?.step === 'confirm_clear') {
            remoteSessions.delete(userId);
            if (userInput === process.env.DB_PASSWORD) {
                await clearChatHistory(userId);
                return ctx.reply(TEKS.clearBerhasil(), { parse_mode: 'Markdown' });
            }
            return ctx.reply(TEKS.salahPassword(), {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Kembali ke Maintenance', callback_data: 'menu_maintenance' }]] },
            });
        }

        if (session && (session.step.startsWith('alias_'))) {
            if (session.editing && ctx.chat.type !== 'private') {
                return ctx.reply('Lanjutkan edit alias lewat chat pribadi bot.');
            }
            if (/^\/cancel(?:@\w+)?$/i.test(userInput.trim())) {
                remoteSessions.delete(userId);
                return ctx.reply('Edit/tambah alias dibatalkan.', {
                    reply_markup: { inline_keyboard: [[{ text: '📋 Kembali ke Alias', callback_data: 'list_aliases' }]] },
                });
            }
            resetSessionTimeout(userId, remoteSessions, ctx);

            // Langkah 1: Simpan Nama Alias
            if (session.step === 'alias_name') {
                remoteSessions.set(userId, { ...session, step: 'alias_host', alias: userInput });
                return ctx.reply(`✅ Nama: \`${userInput}\`\n\n**Langkah 2:**\nMasukkan **IP Address / Host** server:`, { parse_mode: 'Markdown', reply_markup: inputControls('menu_ssh') });
            }

            // Langkah 2: Simpan Host & Minta User
            if (session.step === 'alias_host') {
                remoteSessions.set(userId, { ...session, step: 'alias_user', host: userInput });
                return ctx.reply(`✅ Host: \`${userInput}\`\n\n**Langkah 3:**\nMasukkan **Username** SSH (misal: \`root\`):`, { parse_mode: 'Markdown', reply_markup: inputControls('menu_ssh') });
            }

            // Langkah 3: Simpan User & Minta Port
            if (session.step === 'alias_user') {
                remoteSessions.set(userId, { ...session, step: 'alias_port', user: userInput });
                return ctx.reply(`✅ User: \`${userInput}\`\n\n**Langkah 4:**\nMasukkan **Port** SSH (default: \`22\`):`, { parse_mode: 'Markdown', reply_markup: inputControls('menu_ssh') });
            }

            // Langkah 4: Validasi Port & Minta Password
            if (session.step === 'alias_port') {
                const port = parseInt(userInput);
                if (isNaN(port)) return ctx.reply("❌ Port harus berupa angka! Masukkan kembali port:", {
                    reply_markup: inputControls('menu_ssh'),
                });
                
                remoteSessions.set(userId, { ...session, step: 'alias_pass', port: port });
                return ctx.reply(`✅ Port: \`${port}\`\n\n**Langkah 5 (Terakhir):**\nMasukkan **Password** SSH:`, { parse_mode: 'Markdown', reply_markup: inputControls('menu_ssh') });
            }

            // Langkah 5: Eksekusi Simpan
            if (session.step === 'alias_pass') {
                const pass = userInput; // Kita ambil mentah agar tidak ada karakter hilang
                const ok = session.editing
                    ? await updateAliasInDB(session.originalAlias, session.alias, session.host, session.port, session.user, pass)
                    : await addAliasToDB(session.alias, session.host, session.port, session.user, pass);
                
                remoteSessions.delete(userId);
                return ctx.reply(ok ? TEKS.aliasSimpan(session.alias) : TEKS.aliasFail(), { 
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '⬅️ Kembali ke Menu', callback_data: 'menu_ssh' }]] }
                });
            }
        }
        if (session?.step === 'mt_edit' || session?.step === 'pve_edit') {
            if (ctx.chat.type !== 'private') return ctx.reply('Lanjutkan edit konfigurasi lewat chat pribadi bot.');
            if (/^\/cancel(?:@\w+)?$/i.test(userInput.trim())) {
                remoteSessions.delete(userId);
                return ctx.reply('Edit konfigurasi dibatalkan.');
            }
            const values = userInput.split('|').map(value => value.trim());
            if (values.length !== 5 || values.some(value => !value)) {
                return ctx.reply(
                    session.step === 'mt_edit'
                        ? 'Format: `alias | host | port | username | password`'
                        : 'Format: `nama | host | port | user@realm | token_secret`',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: inputControls(session.step === 'mt_edit' ? 'menu_mikrotik' : 'menu_proxmox'),
                    },
                );
            }
            const port = Number(values[2]);
            if (!Number.isInteger(port) || port < 1 || port > 65535) {
                return ctx.reply('Port harus berupa angka antara 1 dan 65535.', {
                    reply_markup: inputControls(session.step === 'mt_edit' ? 'menu_mikrotik' : 'menu_proxmox'),
                });
            }
            if (session.step === 'mt_edit') {
                const ok = await updateMikrotikDevice(
                    session.deviceId, values[0], values[1], port, values[3], values[4],
                );
                remoteSessions.delete(userId);
                await ctx.reply(ok ? '✅ Konfigurasi MikroTik diperbarui.' : '❌ Perangkat tidak ditemukan atau gagal diperbarui.');
                return;
            }
            const [name, host, , user, secret] = values;
            const loading = await ctx.reply('🔍 Menguji koneksi cluster...');
            const test = await testClusterConnection({
                name, host, port, user, token_id: 'shorekeeper', secret, token_secret: secret,
            });
            await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id).catch(() => {});
            if (!test.ok) return ctx.reply(`❌ Koneksi gagal: ${test.msg}. Konfigurasi belum diubah.`);
            const ok = await updateCluster(session.clusterId, name, host, port, user, secret);
            if (!ok) return ctx.reply('❌ Gagal memperbarui cluster.');
            remoteSessions.delete(userId);
            await ctx.reply('✅ Konfigurasi cluster diperbarui.');
            return handleProxmoxMenu(ctx);
        }
        if (session?.step === 'ping_add_http' || session?.step === 'ping_add_ip') {
            const parts = userInput.split('|').map(value => value.trim());
            if (parts.length < 2 || !parts[0] || !parts[1]) {
                return handleAddPingTarget(ctx, session.step === 'ping_add_http' ? 'http' : 'ip', userInput);
            }
            remoteSessions.delete(userId);
            return handleAddPingTarget(ctx, session.step === 'ping_add_http' ? 'http' : 'ip', userInput);
        }
        if (session?.step === 'ping_edit') {
            if (/^\/cancel(?:@\w+)?$/i.test(userInput.trim())) {
                remoteSessions.delete(userId);
                return ctx.reply('Edit target dibatalkan.', { reply_markup: inputControls('menu_ping') });
            }
            if (await handleEditPingTarget(ctx, session.targetId, userInput)) {
                remoteSessions.delete(userId);
            }
            return;
        }
        if (session?.step === 'rem_edit_message') {
            if (/^\/cancel(?:@\w+)?$/i.test(userInput.trim())) {
                remoteSessions.delete(userId);
                return ctx.reply('Edit reminder dibatalkan.', { reply_markup: inputControls('menu_reminder') });
            }
            const ok = await updateReminderMessage(session.reminderId, userId, userInput.trim());
            if (!ok) {
                remoteSessions.delete(userId);
                return ctx.reply('❌ Reminder tidak ditemukan atau gagal diperbarui.');
            }
            remoteSessions.delete(userId);
            await ctx.reply('✅ Isi reminder diperbarui.');
            return showReminderMenu(ctx, userId);
        }
        if (session?.step === 'note_edit') {
            if (/^\/cancel(?:@\w+)?$/i.test(userInput.trim())) {
                remoteSessions.delete(userId);
                return ctx.reply('Edit catatan dibatalkan.', { reply_markup: inputControls('menu_notes') });
            }
            if (await handleEditNote(ctx, userId, session.noteId, userInput)) {
                remoteSessions.delete(userId);
            }
            return;
        }
        if (session?.pve_step) { return handlePveWizardStep(ctx, userId, userInput, session, remoteSessions); }
        if (session?.step === 'rem_add_msg') { remoteSessions.set(userId, { ...session, message: userInput }); return showReminderAddStep2(ctx); }

        if (session?.step === 'rem_add_time_custom') {
            const { parseReminderText } = await import('../jobs/reminder.job');
            const result = parseReminderText(userInput);
            if (!result.valid)             return ctx.reply(`❌ Format tidak dikenali.`, {
                parse_mode: 'Markdown',
                reply_markup: inputControls('menu_reminder'),
            });
            remoteSessions.set(userId, { ...session, step: 'rem_add_repeat', remindAt: result.remindAt });
            return showReminderAddStep3(ctx);
        }

        if (session?.step === 'note_add') {
            if (!/^(?:#(\w+)\s+)?(.+?)\s*\|\s*([\s\S]+)$/i.test(userInput)) {
                return handleAddNote(ctx, userId, userInput);
            }
            remoteSessions.delete(userId);
            return handleAddNote(ctx, userId, userInput);
        }
        if (session?.step === 'note_search') { remoteSessions.delete(userId); return handleSearchNotes(ctx, userId, userInput); }
        if (session && (session.step === 'cmd' || session.step === 'host' || session.step === 'user' || session.step === 'pass')) {
            resetSessionTimeout(userId, remoteSessions, ctx);
            return handleSSHWizard(ctx, userId, userInput, remoteSessions);
        }

        if (/^(help|list|menu)$/i.test(lowerInput)) return sendHelp(ctx);
        if (userInput.startsWith('$ ')) return handleLocalTerminal(ctx, userInput.slice(2));

        const addAliasMatch = userInput.match(/^add_alias\s+([\w.-]+)\s+([\w-]+)@([\d.]+)(?::(\d+))?\s+(.+)$/i);
        if (addAliasMatch) {
            const [, alias, user, host, port, pass] = addAliasMatch;
            const ok = await addAliasToDB(alias, host, port ? parseInt(port) : 22, user, pass);
            return ctx.reply(ok ? TEKS.aliasSimpan(alias) : TEKS.aliasFail(), { parse_mode: 'Markdown' });
        }

        const removeMatch = userInput.match(/^remove_alias\s+([\w.-]+)$/i);
        if (removeMatch) {
            const ok = await removeAliasFromDB(removeMatch[1]);
            return ctx.reply(ok ? TEKS.aliasHapus(removeMatch[1]) : TEKS.aliasTidakAda(), { parse_mode: 'Markdown' });
        }

        const aliasMatch = userInput.match(/^ssh\s+([\w.-]+)$/i);
        if (aliasMatch && !userInput.includes('@')) {
            const server = await getAliasFromDB(aliasMatch[1]);
            if (server) {
                remoteSessions.set(userId, { host: server.host, user: server.username, port: server.port, pass: server.password, step: 'cmd' });
                resetSessionTimeout(userId, remoteSessions, ctx);
                return ctx.reply(TEKS.sshConnect(aliasMatch[1]), {
                    parse_mode: 'Markdown',
                    reply_markup: inputControls('menu_ssh'),
                });
            }
        }

        const addMtMatch = userInput.match(/^add_mt\s+([\w.-]+)\s+([\d.]+)\s+(\d+)\s+([\w-]+)\s+(.+)$/i);
        if (addMtMatch) {
            const [, alias, host, port, user, pass] = addMtMatch;
            const ok = await saveMikrotikDevice(alias, host, parseInt(port), user, pass);
            return ctx.reply(ok ? `✅ MikroTik *${alias}* berhasil ditambahkan!` : `❌ Gagal menambahkan.`, { parse_mode: 'Markdown' });
        }

        if (/^(ping|monitor|pantau)\s/i.test(userInput)) {
            const cleaned = userInput.replace(/^(ping|monitor|pantau)\s+/i, '').trim();
            const type = (cleaned.startsWith('http') || cleaned.includes('| http')) ? 'http' : 'ip';
            return handleAddPingTarget(ctx, type, cleaned.includes('|') ? cleaned : `Target | ${cleaned}`);
        }

        if (/^(ingatkan|remind|ingat)\s/i.test(userInput)) return handleAddReminder(ctx, userId, userInput);
        if (/^catat\s/i.test(userInput)) return handleAddNote(ctx, userId, userInput);

        return handleAIChat(ctx, userId, userInput);
    });

    bot.on('document', async (ctx) => {
        const userId = ctx.from.id;
        const doc    = ctx.message.document;
        if (doc?.mime_type === 'application/json' || doc?.file_name?.endsWith('.json')) {
            try {
                const fileLink = await ctx.telegram.getFileLink(doc.file_id);
                const response = await fetch(fileLink.toString());
                const data: any = await response.json();
                let chatOk = Array.isArray(data.chats) ? await importChatHistory(userId, data.chats) : false;
                let aliasOk = Array.isArray(data.aliases) ? await importAliases(data.aliases) : false;
                return ctx.reply(TEKS.importBerhasil(chatOk, aliasOk), { parse_mode: 'Markdown' });
            } catch { return ctx.reply(TEKS.importGagal(), { parse_mode: 'Markdown' }); }
        }
        return ctx.reply(TEKS.fileBukanJSON(), { parse_mode: 'Markdown' });
    });
};