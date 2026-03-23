import { parseReminderText, formatWaktu } from '../../jobs/reminder';
import {
    addReminder, getActiveReminders, deleteReminder,
    addNote, getNotes, getNoteById, searchNotes, deleteNote,
    getSetting, setSetting,
} from '../../database/queries';
import { updateReportSchedule, getReportSchedule } from '../../jobs/reporter';
import { nowLocal } from '../../config/timezone';

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

// ═══════════════════════════════════════════════
// REMINDER — MENU UTAMA
// ═══════════════════════════════════════════════

export const showReminderMenu = async (ctx: any, userId: number) => {
    const reminders = await getActiveReminders(userId);

    let text = '⏰ *Reminder*\n\n';
    if (!reminders.length) {
        text += '_Belum ada reminder aktif._\n\n';
    } else {
        reminders.forEach((r, i) => {
            const rep = r.repeat_type !== 'none'
                ? ` ↻ ${r.repeat_type === 'daily' ? 'Harian' : 'Mingguan'}`
                : '';
            text += `${i + 1}. *${r.message}*\n   🕐 ${formatWaktu(new Date(r.remind_at))}${rep}\n\n`;
        });
    }

    const delButtons = reminders.map((r: any, i: number) => ([{
        text:          `🗑️ Hapus #${i + 1} — ${r.message.slice(0, 25)}`,
        callback_data: `rem_del_${r.id}`,
    }]));

    return safeEdit(ctx, text, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '➕ Tambah Reminder', callback_data: 'rem_add_step1' }],
                ...delButtons,
                [{ text: '⬅️ Kembali', callback_data: 'back_to_help' }],
            ],
        },
    });
};

// ═══════════════════════════════════════════════
// REMINDER — WIZARD ADD (Step by step)
// ═══════════════════════════════════════════════

export const showReminderAddStep1 = async (ctx: any) => {
    return safeEdit(ctx, '⏰ *Tambah Reminder*\n\n*Step 1/3* — Ketik isi pesan reminder:', {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'menu_reminder' }]] }
    });
};

export const showReminderAddStep2 = async (ctx: any) => {
    return ctx.reply('🕐 *Step 2/3* — Pilih waktu pengingat:', {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '⏰ 30 menit lagi', callback_data: 'rem_time_30m' },
                    { text: '⏰ 1 jam lagi',    callback_data: 'rem_time_1h'  },
                ],
                [
                    { text: '🌅 Hari ini pagi (09:00)',  callback_data: 'rem_time_today_9'  },
                    { text: '☀️ Hari ini siang (12:00)', callback_data: 'rem_time_today_12' },
                ],
                [
                    { text: '🌆 Hari ini sore (17:00)',  callback_data: 'rem_time_today_17' },
                    { text: '🌙 Hari ini malam (20:00)', callback_data: 'rem_time_today_20' },
                ],
                [
                    { text: '🌅 Besok pagi (09:00)',  callback_data: 'rem_time_tom_9'  },
                    { text: '🌙 Besok malam (20:00)', callback_data: 'rem_time_tom_20' },
                ],
                [{ text: '✏️ Waktu custom',  callback_data: 'rem_time_custom' }],
                [{ text: '❌ Batal',          callback_data: 'menu_reminder'   }],
            ],
        },
    });
};

export const showReminderAddStep3 = async (ctx: any) => {
    return safeEdit(ctx, '🔁 *Step 3/3* — Apakah reminder berulang?', {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '1️⃣ Sekali saja',    callback_data: 'rem_repeat_none'   }],
                [{ text: '📅 Setiap hari',     callback_data: 'rem_repeat_daily'  }],
                [{ text: '📆 Setiap minggu',   callback_data: 'rem_repeat_weekly' }],
                [{ text: '❌ Batal',            callback_data: 'menu_reminder'     }],
            ],
        },
    });
};

// ═══════════════════════════════════════════════
// REMINDER — PROSES WAKTU DARI TOMBOL
// ═══════════════════════════════════════════════

export const resolveReminderTime = (timeCode: string): Date | null => {
    const now = nowLocal();
    const d   = new Date(now);

    switch (timeCode) {
        case '30m':      return new Date(now.getTime() + 30 * 60000);
        case '1h':       return new Date(now.getTime() + 60 * 60000);
        case 'today_9':  d.setHours(9,  0, 0, 0); return d > now ? d : null;
        case 'today_12': d.setHours(12, 0, 0, 0); return d > now ? d : null;
        case 'today_17': d.setHours(17, 0, 0, 0); return d > now ? d : null;
        case 'today_20': d.setHours(20, 0, 0, 0); return d > now ? d : null;
        case 'tom_9':    d.setDate(d.getDate() + 1); d.setHours(9,  0, 0, 0); return d;
        case 'tom_20':   d.setDate(d.getDate() + 1); d.setHours(20, 0, 0, 0); return d;
        default:         return null;
    }
};

// ═══════════════════════════════════════════════
// REMINDER — SIMPAN FINAL
// ═══════════════════════════════════════════════

export const saveReminder = async (
    ctx: any, userId: number,
    message: string, remindAt: Date, repeatType: 'none' | 'daily' | 'weekly'
) => {
    const id = await addReminder(userId, message, remindAt, repeatType);
    if (!id) return ctx.reply('❌ Gagal menyimpan reminder.');

    const repeatInfo = repeatType !== 'none'
        ? ` ↻ ${repeatType === 'daily' ? 'Setiap hari' : 'Setiap minggu'}`
        : '';

    return ctx.reply(
        `✅ *Reminder disimpan!*\n\n📝 ${message}\n🕐 ${formatWaktu(remindAt)}${repeatInfo}`,
        {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '📋 Lihat Semua Reminder', callback_data: 'menu_reminder' }]] }
        }
    );
};

// ═══════════════════════════════════════════════
// REMINDER — HAPUS
// ═══════════════════════════════════════════════

export const handleDeleteReminder = async (ctx: any, userId: number, reminderId: number) => {
    const ok = await deleteReminder(reminderId, userId);
    await ctx.answerCbQuery(ok ? '🗑️ Reminder dihapus.' : '❌ Gagal hapus.').catch(() => {});
    return showReminderMenu(ctx, userId);
};

// ═══════════════════════════════════════════════
// REMINDER — VIA CHAT TEKS (tetap support)
// ═══════════════════════════════════════════════

export const handleAddReminder = async (ctx: any, userId: number, input: string) => {
    const parsed = parseReminderText(input);

    if (!parsed.valid) {
        return ctx.reply(
            `❓ ${parsed.error}\n\nAtau gunakan menu: /start → ⏰ Reminder → ➕ Tambah`,
            { parse_mode: 'Markdown' }
        );
    }

    const id = await addReminder(userId, parsed.message, parsed.remindAt, parsed.repeatType);
    if (!id) return ctx.reply('❌ Gagal menyimpan reminder.');

    const repeatInfo = parsed.repeatType !== 'none'
        ? ` ↻ ${parsed.repeatType === 'daily' ? 'Setiap hari' : 'Setiap minggu'}`
        : '';

    return ctx.reply(
        `✅ *Reminder disimpan!*\n\n📝 ${parsed.message}\n🕐 ${formatWaktu(parsed.remindAt)}${repeatInfo}`,
        { parse_mode: 'Markdown' }
    );
};

// ═══════════════════════════════════════════════
// LAPORAN — SETTING JADWAL
// ═══════════════════════════════════════════════

export const showLaporanSchedule = async (ctx: any) => {
    const { pagi, malam } = getReportSchedule();
    const pagiStr  = `${String(pagi.hour).padStart(2,'0')}:${String(pagi.minute).padStart(2,'0')}`;
    const malamStr = `${String(malam.hour).padStart(2,'0')}:${String(malam.minute).padStart(2,'0')}`;

    return safeEdit(ctx,
        `📋 *Setting Jadwal Laporan*\n\n` +
        `🌅 Laporan Pagi : *${pagiStr} WIB*\n` +
        `🌙 Laporan Malam: *${malamStr} WIB*\n\n` +
        `_Pilih yang ingin diubah:_`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: `🌅 Ubah Laporan Pagi (${pagiStr})`,   callback_data: 'sched_pagi'  }],
                    [{ text: `🌙 Ubah Laporan Malam (${malamStr})`, callback_data: 'sched_malam' }],
                    [{ text: '⬅️ Kembali', callback_data: 'back_to_help' }],
                ],
            },
        }
    );
};

export const showSchedulePicker = async (ctx: any, session: 'pagi' | 'malam') => {
    const label = session === 'pagi' ? '🌅 Pagi' : '🌙 Malam';
    const options = session === 'pagi'
        ? [
            [{ text: '06:00', callback_data: `sched_set_${session}_6_0`  }, { text: '07:00', callback_data: `sched_set_${session}_7_0`  }],
            [{ text: '08:00', callback_data: `sched_set_${session}_8_0`  }, { text: '09:00', callback_data: `sched_set_${session}_9_0`  }],
            [{ text: '10:00', callback_data: `sched_set_${session}_10_0` }, { text: '11:00', callback_data: `sched_set_${session}_11_0` }],
          ]
        : [
            [{ text: '17:00', callback_data: `sched_set_${session}_17_0` }, { text: '18:00', callback_data: `sched_set_${session}_18_0` }],
            [{ text: '19:00', callback_data: `sched_set_${session}_19_0` }, { text: '20:00', callback_data: `sched_set_${session}_20_0` }],
            [{ text: '21:00', callback_data: `sched_set_${session}_21_0` }, { text: '22:00', callback_data: `sched_set_${session}_22_0` }],
          ];

    return safeEdit(ctx, `📋 *Pilih jam untuk Laporan ${label}:*`, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                ...options,
                [{ text: '⬅️ Kembali', callback_data: 'laporan_schedule' }],
            ],
        },
    });
};

export const handleSetSchedule = async (ctx: any, session: 'pagi' | 'malam', hour: number, minute: number) => {
    await updateReportSchedule(session, hour, minute);
    await ctx.answerCbQuery(`✅ Jadwal laporan ${session} diubah ke ${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`).catch(() => {});
    return showLaporanSchedule(ctx);
};

// ═══════════════════════════════════════════════
// CATATAN
// ═══════════════════════════════════════════════

const TAGS    = ['general', 'server', 'config', 'network', 'personal'];
const TAG_EMO: Record<string, string> = {
    general: '📝', server: '🖥️', config: '⚙️', network: '🌐', personal: '👤',
};

export const showNotesMenu = async (ctx: any, userId: number, tag?: string) => {
    const notes = await getNotes(userId, tag);

    let text = tag
        ? `${TAG_EMO[tag] || '📝'} *Catatan — ${tag}*\n\n`
        : '📒 *Catatan*\n\n';

    if (!notes.length) {
        text += '_Belum ada catatan._\n\n';
    } else {
        notes.forEach((n: any, i: number) => {
            text += `${i + 1}. ${TAG_EMO[n.tag] || '📝'} *${n.title}*\n`;
        });
        text += '\n_Tap untuk lihat isi._';
    }

    const noteButtons = notes.map((n: any) => ([{
        text:          `📄 ${n.title}`,
        callback_data: `note_view_${n.id}`,
    }]));

    const tagButtons = TAGS.map(t => ({
        text:          `${TAG_EMO[t]} ${t}`,
        callback_data: `note_tag_${t}`,
    }));

    return safeEdit(ctx, text, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '➕ Tambah Catatan', callback_data: 'note_add_prompt' }],
                ...noteButtons,
                tagButtons,
                [
                    { text: '🔍 Cari',    callback_data: 'note_search_prompt' },
                    { text: '⬅️ Kembali', callback_data: 'back_to_help'       },
                ],
            ],
        },
    });
};

export const showNoteAddPrompt = async (ctx: any) => {
    return safeEdit(ctx,
        '📝 *Tambah Catatan*\n\nKetik dengan format:\n`judul | isi catatan`\n\nDengan tag:\n`#server judul | isi catatan`\n\nTag: #general #server #config #network #personal',
        {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'menu_notes' }]] }
        }
    );
};

export const showNoteDetail = async (ctx: any, userId: number, noteId: number) => {
    const note = await getNoteById(noteId, userId);
    if (!note) return ctx.reply('❌ Catatan tidak ditemukan.');

    const text =
        `${TAG_EMO[note.tag] || '📝'} *${note.title}*\n` +
        `_Tag: ${note.tag} · ${new Date(note.created_at).toLocaleDateString('id-ID')}_\n\n` +
        `${note.content}`;

    return safeEdit(ctx, text, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🗑️ Hapus', callback_data: `note_del_${note.id}` }],
                [{ text: '⬅️ Kembali', callback_data: 'menu_notes' }],
            ],
        },
    });
};

export const handleDeleteNote = async (ctx: any, userId: number, noteId: number) => {
    const ok = await deleteNote(noteId, userId);
    await ctx.answerCbQuery(ok ? '🗑️ Catatan dihapus.' : '❌ Gagal hapus.').catch(() => {});
    return showNotesMenu(ctx, userId);
};

export const handleSearchNotes = async (ctx: any, userId: number, keyword: string) => {
    const results = await searchNotes(userId, keyword);

    if (!results.length) {
        return ctx.reply(
            `🔍 Tidak ada catatan dengan kata kunci *"${keyword}"*`,
            {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Kembali', callback_data: 'menu_notes' }]] },
            }
        );
    }

    const buttons = results.map((n: any) => ([{
        text:          `${TAG_EMO[n.tag] || '📝'} ${n.title}`,
        callback_data: `note_view_${n.id}`,
    }]));
    buttons.push([{ text: '⬅️ Kembali', callback_data: 'menu_notes' }]);

    return safeEdit(ctx,
        `🔍 *Hasil: "${keyword}"* — ${results.length} ditemukan`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }
    );
};

export const handleAddNote = async (ctx: any, userId: number, input: string) => {
    // Format: "#tag judul | isi" atau "judul | isi"
    const match = input.match(/^(?:#(\w+)\s+)?(.+?)\s*\|\s*([\s\S]+)$/i);

    if (!match) {
        return ctx.reply(
            `📒 *Format catatan:*\n\`judul | isi catatan\`\n\nDengan tag:\n\`#server nginx config | port 8080\``,
            { parse_mode: 'Markdown' }
        );
    }

    const tag     = TAGS.includes(match[1]) ? match[1] : 'general';
    const title   = match[2].trim();
    const content = match[3].trim();

    const id = await addNote(userId, title, content, tag);
    if (!id) return ctx.reply('❌ Gagal menyimpan catatan.');

    return ctx.reply(
        `${TAG_EMO[tag]} *Catatan disimpan!*\n\n*${title}*\n_Tag: ${tag}_`,
        {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '📒 Lihat Catatan', callback_data: 'menu_notes' }]] }
        }
    );
};