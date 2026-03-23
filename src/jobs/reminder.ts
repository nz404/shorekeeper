import { Telegraf } from 'telegraf';
import { getDueReminders, updateReminderTime, deactivateReminder } from '../database/queries';
import { TZ, nowLocal, formatLocal } from '../config/timezone';

// ─────────────────────────────────────────────
// INTERFACE
// ─────────────────────────────────────────────

export interface ParsedReminder {
    remindAt:   Date;
    repeatType: 'none' | 'daily' | 'weekly';
    message:    string;
    valid:      boolean;
    error?:     string;
}

// ─────────────────────────────────────────────
// PARSE WAKTU NATURAL (Bahasa Indonesia)
// ─────────────────────────────────────────────

const BULAN: Record<string, number> = {
    januari: 0, februari: 1, maret: 2, april: 3, mei: 4, juni: 5,
    juli: 6, agustus: 7, september: 8, oktober: 9, november: 10, desember: 11,
    jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, agu: 7, sep: 8, okt: 9, nov: 10, des: 11,
};

export const parseReminderText = (input: string): ParsedReminder => {
    const now   = nowLocal();
    const lower = input.toLowerCase().trim();

    let remindAt:   Date = new Date(now);
    let repeatType: 'none' | 'daily' | 'weekly' = 'none';
    let message:    string = input.replace(/^(ingatkan|remind|ingat)\s+(saya\s+)?/i, '').trim();
    let timeSet = false;
    let dateSet = false;

    // ── Tanggal + bulan: "15 april", "5 januari" ──
    const tglBulanMatch = lower.match(/(\d{1,2})\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|jan|feb|mar|apr|jun|jul|agu|sep|okt|nov|des)/);
    if (tglBulanMatch) {
        const tgl = parseInt(tglBulanMatch[1]);
        const bln = BULAN[tglBulanMatch[2]];
        remindAt.setMonth(bln, tgl);
        if (remindAt <= now) remindAt.setFullYear(remindAt.getFullYear() + 1);
        dateSet = true;
        message = message.replace(tglBulanMatch[0], '').trim();
    }

    // ── Format: "15/04" atau "15/04/2025" ──
    const tglSlashMatch = lower.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
    if (tglSlashMatch && !dateSet) {
        const tgl = parseInt(tglSlashMatch[1]);
        const bln = parseInt(tglSlashMatch[2]) - 1;
        const thn = tglSlashMatch[3] ? parseInt(tglSlashMatch[3]) : now.getFullYear();
        remindAt.setFullYear(thn, bln, tgl);
        if (remindAt <= now && !tglSlashMatch[3]) remindAt.setFullYear(remindAt.getFullYear() + 1);
        dateSet = true;
        message = message.replace(tglSlashMatch[0], '').trim();
    }

    // ── Relative: "30 menit lagi", "2 jam lagi" ──
    const relMatch = lower.match(/(\d+)\s*(menit|jam)\s*lagi/);
    if (relMatch) {
        const val  = parseInt(relMatch[1]);
        const unit = relMatch[2];
        remindAt   = new Date(now.getTime() + (unit === 'jam' ? val * 3_600_000 : val * 60_000));
        timeSet    = true;
        dateSet    = true;
        message    = message.replace(relMatch[0], '').trim();
    }

    // ── Jam: "jam 10", "jam 10:30", "jam 10.30", "jam 10 pagi/siang/sore/malam" ──
    const jamMatch = lower.match(/jam\s+(\d{1,2})(?:[.:](\d{2}))?\s*(pagi|siang|sore|malam)?/);
    if (jamMatch && !timeSet) {
        let hour   = parseInt(jamMatch[1]);
        const min  = parseInt(jamMatch[2] || '0');
        const sesi = jamMatch[3];
        if (sesi === 'sore'  && hour < 12) hour += 12;
        if (sesi === 'malam' && hour < 12) hour += 12;
        if (!sesi && hour <= 6)            hour += 12;
        remindAt.setHours(hour, min, 0, 0);
        if (!dateSet && remindAt <= now) remindAt.setDate(remindAt.getDate() + 1);
        timeSet = true;
        message = message.replace(jamMatch[0], '').trim();
    }

    // ── Pukul: "pukul 09.00", "09:00", "16.50" ──
    const pukMatch = lower.match(/(?:pukul\s+)?(\d{1,2})[.:](\d{2})(?!\d)/);
    if (pukMatch && !timeSet) {
        const hour = parseInt(pukMatch[1]);
        const min  = parseInt(pukMatch[2]);
        remindAt.setHours(hour, min, 0, 0);
        if (!dateSet && remindAt <= now) remindAt.setDate(remindAt.getDate() + 1);
        timeSet = true;
        message = message.replace(pukMatch[0], '').trim();
    }

    // ── Besok ──
    if (lower.includes('besok') && !dateSet) {
        remindAt.setDate(remindAt.getDate() + 1);
        if (!timeSet) remindAt.setHours(9, 0, 0, 0);
        dateSet = true;
        message = message.replace(/besok/i, '').trim();
    }

    // ── Lusa ──
    if (lower.includes('lusa') && !dateSet) {
        remindAt.setDate(remindAt.getDate() + 2);
        if (!timeSet) remindAt.setHours(9, 0, 0, 0);
        dateSet = true;
        message = message.replace(/lusa/i, '').trim();
    }

    // ── Repeat ──
    if (lower.includes('setiap hari') || lower.includes('tiap hari')) {
        repeatType = 'daily';
        message    = message.replace(/setiap\s+hari|tiap\s+hari/i, '').trim();
    }
    if (lower.includes('setiap minggu') || lower.includes('tiap minggu')) {
        repeatType = 'weekly';
        message    = message.replace(/setiap\s+minggu|tiap\s+minggu/i, '').trim();
    }

    if (!timeSet && !dateSet) {
        return {
            remindAt, repeatType, message, valid: false,
            error: 'SK tidak bisa parse waktu. Coba:\n• `ingatkan jam 10 malam restart nginx`\n• `ingatkan 15 april jam 9 pagi meeting`\n• `ingatkan 30 menit lagi cek backup`\n• `ingatkan setiap hari jam 8 pagi cek server`',
        };
    }

    // Bersihkan sisa keyword
    message = message
        .replace(/^(ingatkan|remind|ingat)\s+(saya\s+)?/i, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!message) message = 'Pengingat dari SK';

    return { remindAt, repeatType, message, valid: true };
};

// ─────────────────────────────────────────────
// FORMAT WAKTU (tampilan user)
// ─────────────────────────────────────────────

export const formatWaktu = (date: Date): string =>
    formatLocal(date, { dateStyle: 'medium', timeStyle: 'short' });

// ─────────────────────────────────────────────
// REMINDER JOB — cek setiap menit
// ─────────────────────────────────────────────

export const initReminderJob = (bot: Telegraf, chatId: string) => {
    console.log('⏰ Reminder job aktif');

    setInterval(async () => {
        try {
            const due = await getDueReminders();

            for (const r of due) {
                await bot.telegram.sendMessage(
                    chatId,
                    `⏰ *Pengingat SK!*\n\n${r.message}\n\n_Dijadwalkan: ${formatWaktu(new Date(r.remind_at))}_`,
                    { parse_mode: 'Markdown' }
                );

                if (r.repeat_type === 'daily') {
                    const next = new Date(r.remind_at);
                    next.setDate(next.getDate() + 1);
                    await updateReminderTime(r.id, next);
                } else if (r.repeat_type === 'weekly') {
                    const next = new Date(r.remind_at);
                    next.setDate(next.getDate() + 7);
                    await updateReminderTime(r.id, next);
                } else {
                    await deactivateReminder(r.id);
                }
            }
        } catch (err: any) {
            console.error('Reminder job error:', err.message);
        }
    }, 60_000);
};