import * as dotenv from 'dotenv';
dotenv.config();

import { Telegraf } from 'telegraf';
import { handleAIChat } from './modules/ai';
import {
    handleManagePulau, handleCheckStatus, handleProxmoxAction,
    handleProxmoxMenu, showAddClusterPrompt,
    showDeleteClusterMenu, handleDeleteCluster,
    handlePveWizardStep,
} from './modules/proxmox';
import { handleSSHWizard, resetSessionTimeout } from './modules/ssh';
import { handleLocalTerminal } from './modules/terminal';
import { showTroubleshootMenu, showKategoriMenu, handleTroubleshoot, KATEGORI_LIST } from './modules/troubleshoot';
import { showMonitorMenu, handleMonitorAction } from '../jobs/monitor';
import { showDockerMenu, showContainerList, showContainerInfo, handleContainerAction, showContainerLogs, showContainerStats } from './modules/dockerHandler';
import { showPingMenu, showPingAddPrompt, handleAddPingTarget, handleDeletePingTarget, checkPingNow } from './modules/pingHandler';
import { approveFix, rejectFix, AutoFixService } from '../services/autoFix.service';
import {
    showReminderMenu, showReminderAddStep1, showReminderAddStep2, showReminderAddStep3,
    resolveReminderTime, saveReminder, handleDeleteReminder, handleAddReminder,
    showNotesMenu, showNoteAddPrompt, showNoteDetail, handleDeleteNote, handleSearchNotes, handleAddNote,
    showLaporanSchedule, showSchedulePicker, handleSetSchedule,
} from './modules/reminderHandler';
import { buildDailyReport } from '../jobs/reporter';
import { TEKS } from '../config/persona';
import {
    getAliasFromDB, addAliasToDB, getAllAliases, removeAliasFromDB,
    clearChatHistory, getAllChatHistory, getAllAliasesForBackup,
    importChatHistory, importAliases,
} from '../database/queries';
import fetch from 'node-fetch';

// Session state per user
const remoteSessions = new Map<number, any>();

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
// ANSWER CB QUERY HELPER (prevent "query too old")
// ─────────────────────────────────────────────

const ack = async (ctx: any, text?: string) => {
    try {
        await ctx.answerCbQuery(text || '').catch(() => {});
    } catch {}
};

export const registerHandlers = (bot: Telegraf, MY_CHAT_ID: string) => {

    // ─────────────────────────────────────────────
    // FILTER KEAMANAN — hanya MY_CHAT_ID
    // ─────────────────────────────────────────────

    bot.use((ctx, next) => {
        if (ctx.from?.id.toString() !== MY_CHAT_ID) return;
        return next();
    });

    // ─────────────────────────────────────────────
    // MENU UTAMA
    // ─────────────────────────────────────────────

    const getMainMenu = () => ({
        text: TEKS.menuUtama(),
        markup: {
            inline_keyboard: [
                [{ text: '🌐 SSH Manager',  callback_data: 'menu_ssh'          }, { text: '🖥️ Proxmox',    callback_data: 'menu_proxmox'    }, { text: '📊 Status',     callback_data: 'status'          }],
                [{ text: '📋 Daftar SSH', callback_data: 'list_aliases'      }, { text: '🔍 Troubleshoot', callback_data: 'menu_troubleshoot' }, { text: '🖥️ Monitor',    callback_data: 'menu_monitor'    }],
                [{ text: '🐳 Docker',       callback_data: 'menu_docker'       }, { text: '📋 Laporan',    callback_data: 'menu_laporan'    }, { text: '📡 Ping Monitor', callback_data: 'menu_ping'         }],
                [{ text: '⏰ Reminder',      callback_data: 'menu_reminder'     }, { text: '📒 Catatan',    callback_data: 'menu_notes'      }, { text: '⚙️ Maintenance',  callback_data: 'menu_maintenance'  }],
                [{ text: '❌ Tutup Menu', callback_data: 'close_menu'      }],
            ],
        },
    });

    const sendHelp = (ctx: any) => {
        const menu = getMainMenu();
        return ctx.reply(menu.text, { parse_mode: 'Markdown', reply_markup: menu.markup });
    };

    const editToHelp = (ctx: any) => {
        const menu = getMainMenu();
        return safeEdit(ctx, menu.text, { parse_mode: 'Markdown', reply_markup: menu.markup });
    };

    bot.start((ctx) => sendHelp(ctx));

    // ─────────────────────────────────────────────
    // CALLBACK QUERY
    // ─────────────────────────────────────────────

    bot.on('callback_query', async (ctx: any) => {
        const data   = ctx.callbackQuery.data as string;
        const userId = ctx.from.id;

        // ── Navigasi Umum ──
        if (data === 'back_to_help') { await ack(ctx); return editToHelp(ctx); }
        if (data === 'close_menu')   { await ack(ctx); return ctx.deleteMessage().catch(() => {}); }

        // ── SSH Manager ──
        if (data === 'menu_ssh') {
            await ack(ctx);
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

        // ── Daftar Alias ──
        if (data === 'list_aliases') {
            await ack(ctx);
            const aliases = await getAllAliases();
            if (!aliases.length) return safeEdit(ctx, TEKS.aliasTidakAda(), {
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Kembali', callback_data: 'menu_ssh' }]] },
            });
            let msg = '📋 *Daftar Alias SSH:*\n\n';
            aliases.forEach((a: any) => { msg += `• \`ssh ${a.alias}\` → \`${a.host}\`\n`; });
            return safeEdit(ctx, msg, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Kembali', callback_data: 'menu_ssh' }]] },
            });
        }

        // ── Info Tambah Alias ──
        if (data === 'add_alias_info') {
            await ack(ctx);
            return safeEdit(ctx, TEKS.tambahAliasInfo(), {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Kembali', callback_data: 'menu_ssh' }]] },
            });
        }

        // ── Maintenance ──
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

        // ── Clear Chat ──
        if (data === 'clear_chat') {
            await ack(ctx);
            remoteSessions.set(userId, { step: 'confirm_clear' });
            return safeEdit(ctx, TEKS.konfirmasiClear(), {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '❌ Batalkan', callback_data: 'menu_maintenance' }]] },
            });
        }

        // ── Export Backup ──
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

        // ── Proxmox ──
        if (data === 'menu_proxmox')  { await ack(ctx); return handleProxmoxMenu(ctx); }
        if (data === 'pve_list')      { await ack(ctx); return handleManagePulau(ctx); }
        if (data === 'pve_status')    { await ack(ctx); return handleCheckStatus(ctx); }
        if (data === 'status')        { await ack(ctx); return handleCheckStatus(ctx); }
        if (data === 'pve_add') {
            await ack(ctx);
            remoteSessions.set(userId, { pve_step: 'pve_name' });
            return showAddClusterPrompt(ctx);
        }
        if (data === 'pve_del_menu')  { await ack(ctx); return showDeleteClusterMenu(ctx); }

        if (data.startsWith('pve_del_') && !data.startsWith('pve_del_menu')) {
            const cId = parseInt(data.replace('pve_del_', ''));
            return handleDeleteCluster(ctx, cId);
        }

        if (data.startsWith('pve_info_')) {
            await ack(ctx);
            // pve_info_{type}_{vmid}_{node}_{clusterId}
            const p = data.split('_');
            return handleProxmoxAction(ctx, 'info', p[2], p[3], p[4], parseInt(p[5]));
        }

        if (data.startsWith('pve_exec_')) {
            // pve_exec_{type}_{vmid}_{task}_{node}_{clusterId}
            const p = data.split('_');
            return handleProxmoxAction(ctx, 'exec', p[2], p[3], p[4], parseInt(p[6]));
        }

        // ── Monitor ──
        if (data === 'menu_monitor') { await ack(ctx); return showMonitorMenu(ctx); }

        if (data.startsWith('mon_')) {
            const parts  = data.split('_');
            const action = parts[1];
            const alias  = parts.slice(2).join('_');
            return handleMonitorAction(ctx, action, alias);
        }

        // ── Troubleshoot ──
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
                    host:     server.host,
                    port:     server.port,
                    username: server.username,
                    password: server.password,
                }, kategori);
            }
        }

        // ── Laporan ──
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
            const { showLaporanSchedule } = await import('./modules/reminderHandler');
            return showLaporanSchedule(ctx);
        }

        if (data.startsWith('sched_set_')) {
            // format: sched_set_pagi_9_0 atau sched_set_malam_18_0
            const parts   = data.split('_');
            const session = parts[2] as 'pagi' | 'malam';
            const hour    = parseInt(parts[3]);
            const minute  = parseInt(parts[4]);
            const { handleSetSchedule } = await import('./modules/reminderHandler');
            return handleSetSchedule(ctx, session, hour, minute);
        }

        if (data === 'sched_pagi') {
            await ack(ctx);
            const { showSchedulePicker } = await import('./modules/reminderHandler');
            return showSchedulePicker(ctx, 'pagi');
        }

        if (data === 'sched_malam') {
            await ack(ctx);
            const { showSchedulePicker } = await import('./modules/reminderHandler');
            return showSchedulePicker(ctx, 'malam');
        }

        // ── Docker ──
        if (data === 'menu_docker') { await ack(ctx); return showDockerMenu(ctx); }

        if (data.startsWith('dock_server_')) {
            return showContainerList(ctx, data.replace('dock_server_', ''));
        }
        if (data.startsWith('dock_info_')) {
            const parts = data.split('_');
            return showContainerInfo(ctx, parts[2], parts[3]);
        }
        if (data.startsWith('dock_act_')) {
            const parts = data.split('_');
            return handleContainerAction(ctx, parts[2], parts[3], parts[4]);
        }
        if (data.startsWith('dock_log_')) {
            const parts = data.split('_');
            return showContainerLogs(ctx, parts[2], parts[3]);
        }
        if (data.startsWith('dock_stat_')) {
            const parts = data.split('_');
            return showContainerStats(ctx, parts[2], parts[3]);
        }

        // ── Reminder ──
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
                    reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'menu_reminder' }]] },
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

        // ── Catatan ──
        if (data === 'menu_notes') { await ack(ctx); return showNotesMenu(ctx, userId); }

        if (data === 'note_add_prompt') {
            await ack(ctx);
            remoteSessions.set(userId, { step: 'note_add' });
            return showNoteAddPrompt(ctx);
        }

        if (data.startsWith('note_tag_')) {
            await ack(ctx);
            return showNotesMenu(ctx, userId, data.replace('note_tag_', ''));
        }

        if (data.startsWith('note_view_')) {
            await ack(ctx);
            return showNoteDetail(ctx, userId, parseInt(data.replace('note_view_', '')));
        }

        if (data.startsWith('note_del_')) {
            return handleDeleteNote(ctx, userId, parseInt(data.replace('note_del_', '')));
        }

        if (data === 'note_search_prompt') {
            await ack(ctx);
            remoteSessions.set(userId, { step: 'note_search' });
            return safeEdit(ctx, '🔍 *Cari Catatan*\n\nKetik kata kunci pencarian:', {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'menu_notes' }]] },
            });
        }

        // ── Ping Monitor ──
        if (data === 'menu_ping') { await ack(ctx); return showPingMenu(ctx); }

        if (data === 'ping_check_now') return checkPingNow(ctx);

        if (data === 'ping_add_http') {
            await ack(ctx);
            remoteSessions.set(userId, { step: 'ping_add_http' });
            return showPingAddPrompt(ctx, 'http');
        }
        if (data === 'ping_add_ip') {
            await ack(ctx);
            remoteSessions.set(userId, { step: 'ping_add_ip' });
            return showPingAddPrompt(ctx, 'ip');
        }
        if (data.startsWith('ping_del_')) {
            const targetId = parseInt(data.replace('ping_del_', ''));
            return handleDeletePingTarget(ctx, targetId);
        }

        // ── Auto Fix ──
        if (data.startsWith('autofix_approve_')) {
            return approveFix(ctx, data.replace('autofix_approve_', ''));
        }
        if (data.startsWith('autofix_reject_')) {
            return rejectFix(ctx, data.replace('autofix_reject_', ''));
        }

        // Fallback: ack agar query tidak expired
        await ack(ctx);
    });

    // ─────────────────────────────────────────────
    // PESAN TEKS
    // ─────────────────────────────────────────────

    bot.on('text', async (ctx) => {
        const userId     = ctx.from.id;
        const userInput  = ctx.message.text;
        const lowerInput = userInput.toLowerCase();
        const session    = remoteSessions.get(userId);

        // A. Konfirmasi clear
        if (session?.step === 'confirm_clear') {
            remoteSessions.delete(userId);
            if (userInput === process.env.DB_PASSWORD) {
                await clearChatHistory(userId);
                return ctx.reply(TEKS.clearBerhasil(), { parse_mode: 'Markdown' });
            }
            return ctx.reply(TEKS.salahPassword(), { parse_mode: 'Markdown' });
        }

        // B. Ping add session
        if (session?.step === 'ping_add_http') {
            remoteSessions.delete(userId);
            return handleAddPingTarget(ctx, 'http', userInput);
        }
        if (session?.step === 'ping_add_ip') {
            remoteSessions.delete(userId);
            return handleAddPingTarget(ctx, 'ip', userInput);
        }

        // B2. Wizard tambah cluster Proxmox
        if (session?.pve_step) {
            return handlePveWizardStep(ctx, userId, userInput, session, remoteSessions);
        }

        // C. Wizard reminder — input pesan
        if (session?.step === 'rem_add_msg') {
            remoteSessions.set(userId, { ...session, message: userInput });
            return showReminderAddStep2(ctx);
        }

        // D. Wizard reminder — custom time
        if (session?.step === 'rem_add_time_custom') {
            const { parseReminderText } = await import('../jobs/reminder');
            const result = parseReminderText(userInput);
            if (!result.valid) {
                return ctx.reply(
                    `❌ Format tidak dikenali.\n\nContoh:\n\`jam 10 malam\`\n\`besok jam 9 pagi\`\n\`15 april jam 8\``,
                    { parse_mode: 'Markdown' }
                );
            }
            remoteSessions.set(userId, { ...session, step: 'rem_add_repeat', remindAt: result.remindAt });
            return showReminderAddStep3(ctx);
        }

        // E. Wizard catatan
        if (session?.step === 'note_add') {
            remoteSessions.delete(userId);
            return handleAddNote(ctx, userId, userInput);
        }

        // F. Search catatan
        if (session?.step === 'note_search') {
            remoteSessions.delete(userId);
            return handleSearchNotes(ctx, userId, userInput);
        }

        // G. SSH session aktif
        if (session && (session.step === 'cmd' || session.step === 'host' || session.step === 'user' || session.step === 'pass')) {
            resetSessionTimeout(userId, remoteSessions, ctx);
            return handleSSHWizard(ctx, userId, userInput, remoteSessions);
        }

        // H. Commands umum
        if (/^(help|list|menu)$/i.test(lowerInput)) return sendHelp(ctx);
        if (userInput.startsWith('$ '))             return handleLocalTerminal(ctx, userInput.slice(2));

        // I. Tambah alias
        const addAliasMatch = userInput.match(/^add_alias\s+([\w.-]+)\s+([\w-]+)@([\d.]+)(?::(\d+))?\s+(.+)$/i);
        if (addAliasMatch) {
            const [, alias, user, host, port, pass] = addAliasMatch;
            const ok = await addAliasToDB(alias, host, port ? parseInt(port) : 22, user, pass);
            return ctx.reply(ok ? TEKS.aliasSimpan(alias) : TEKS.aliasFail(), { parse_mode: 'Markdown' });
        }

        // J. Hapus alias
        const removeMatch = userInput.match(/^remove_alias\s+([\w.-]+)$/i);
        if (removeMatch) {
            const ok = await removeAliasFromDB(removeMatch[1]);
            return ctx.reply(ok ? TEKS.aliasHapus(removeMatch[1]) : TEKS.aliasTidakAda(), { parse_mode: 'Markdown' });
        }

        // K. SSH via alias
        const aliasMatch = userInput.match(/^ssh\s+([\w.-]+)$/i);
        if (aliasMatch && !userInput.includes('@')) {
            const server = await getAliasFromDB(aliasMatch[1]);
            if (server) {
                remoteSessions.set(userId, {
                    host: server.host, user: server.username,
                    port: server.port, pass: server.password, step: 'cmd',
                });
                resetSessionTimeout(userId, remoteSessions, ctx);
                return ctx.reply(TEKS.sshConnect(aliasMatch[1]), { parse_mode: 'Markdown' });
            }
        }

        // L. Ping monitor via teks
        if (/^(ping|monitor|pantau)\s/i.test(userInput)) {
            const cleaned = userInput.replace(/^(ping|monitor|pantau)\s+/i, '').trim();
            if (cleaned.startsWith('http://') || cleaned.startsWith('https://') || cleaned.includes(' | http')) {
                return handleAddPingTarget(ctx, 'http', cleaned.includes('|') ? cleaned : `Target | ${cleaned}`);
            }
            return handleAddPingTarget(ctx, 'ip', cleaned.includes('|') ? cleaned : `Target | ${cleaned}`);
        }

        // M. Reminder via teks
        if (/^(ingatkan|remind|ingat)\s/i.test(userInput)) {
            return handleAddReminder(ctx, userId, userInput);
        }

        // N. Catatan via teks
        if (/^catat\s/i.test(userInput)) {
            return handleAddNote(ctx, userId, userInput);
        }

        // O. Default → AI Chat
        return handleAIChat(ctx, userId, userInput);
    });

    // ─────────────────────────────────────────────
    // IMPORT FILE JSON
    // ─────────────────────────────────────────────

    bot.on('document', async (ctx) => {
        const userId = ctx.from.id;
        const doc    = ctx.message.document;

        if (doc?.mime_type === 'application/json' || doc?.file_name?.endsWith('.json')) {
            try {
                const fileLink = await ctx.telegram.getFileLink(doc.file_id);
                const response = await fetch(fileLink.toString());
                const data: any = await response.json();

                if (!data.chats && !data.aliases)
                    return ctx.reply(TEKS.importFormatSalah(), { parse_mode: 'Markdown' });

                let chatOk  = false;
                let aliasOk = false;

                if (Array.isArray(data.chats))   chatOk  = await importChatHistory(userId, data.chats);
                if (Array.isArray(data.aliases))  aliasOk = await importAliases(data.aliases);

                return ctx.reply(TEKS.importBerhasil(chatOk, aliasOk), { parse_mode: 'Markdown' });

            } catch {
                return ctx.reply(TEKS.importGagal(), { parse_mode: 'Markdown' });
            }
        }

        return ctx.reply(TEKS.fileBukanJSON(), { parse_mode: 'Markdown' });
    });
};