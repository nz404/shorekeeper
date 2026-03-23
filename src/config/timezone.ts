// ─────────────────────────────────────────────
// TIMEZONE HELPER
// Satu sumber untuk timezone — diambil dari .env
// ─────────────────────────────────────────────

export const TZ = process.env.TIMEZONE || 'Asia/Jakarta';

/** Waktu sekarang dalam timezone lokal */
export const nowLocal = (): Date =>
    new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));

/** Format tanggal ke string lokal (untuk tampilan) */
export const formatLocal = (date: Date, options?: Intl.DateTimeFormatOptions): string =>
    new Date(date).toLocaleString('id-ID', { timeZone: TZ, ...options });

/** Jam sekarang (0–23) dalam timezone lokal */
export const localHour = (): number => nowLocal().getHours();

/** Cek apakah sekarang tepat pada jam:menit tertentu (timezone lokal) */
export const isTime = (hour: number, minute: number = 0): boolean => {
    const now = nowLocal();
    return now.getHours() === hour && now.getMinutes() === minute;
};