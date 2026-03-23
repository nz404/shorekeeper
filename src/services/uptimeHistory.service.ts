import { db } from '../database/connection';

// ═══════════════════════════════════════════════
// UPTIME HISTORY
// SQL:
// CREATE TABLE IF NOT EXISTS uptime_events (
//   id         INT AUTO_INCREMENT PRIMARY KEY,
//   alias      VARCHAR(100) NOT NULL,
//   status     ENUM('up','down') NOT NULL,
//   occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
//   INDEX idx_alias (alias),
//   INDEX idx_occurred (occurred_at)
// );
// ═══════════════════════════════════════════════

// Track status sebelumnya untuk deteksi perubahan
const lastStatus = new Map<string, boolean>();

// ─────────────────────────────────────────────
// CATAT EVENT
// ─────────────────────────────────────────────

export const recordUptimeEvent = async (alias: string, isOnline: boolean): Promise<void> => {
    const prev = lastStatus.get(alias);

    // Hanya catat kalau ada perubahan status
    if (prev === isOnline) return;

    lastStatus.set(alias, isOnline);

    // Skip kalau ini pertama kali (tidak ada history sebelumnya)
    if (prev === undefined) return;

    try {
        await db.execute(
            'INSERT INTO uptime_events (alias, status) VALUES (?, ?)',
            [alias, isOnline ? 'up' : 'down']
        );
        console.log(`📊 Uptime event: ${alias} → ${isOnline ? '🟢 UP' : '🔴 DOWN'}`);
    } catch (e) {
        console.error('recordUptimeEvent error:', e);
    }
};

// ─────────────────────────────────────────────
// INISIALISASI STATUS AWAL
// ─────────────────────────────────────────────

export const initServerStatus = (alias: string, isOnline: boolean): void => {
    lastStatus.set(alias, isOnline);
};

// ─────────────────────────────────────────────
// AMBIL HISTORY
// ─────────────────────────────────────────────

export const getUptimeHistory = async (alias: string, days: number = 7) => {
    try {
        const [rows]: any = await db.execute(
            `SELECT status, occurred_at
             FROM uptime_events
             WHERE alias = ?
               AND occurred_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
             ORDER BY occurred_at DESC
             LIMIT 100`,
            [alias, days]
        );
        return rows as any[];
    } catch { return []; }
};

// ─────────────────────────────────────────────
// KALKULASI UPTIME PERCENTAGE
// ─────────────────────────────────────────────

export const calculateUptimePct = async (alias: string, days: number = 7): Promise<number> => {
    try {
        const events = await getUptimeHistory(alias, days);
        if (!events.length) {
            // Tidak ada event = server selalu up sejak dipantau
            const isUp = lastStatus.get(alias);
            return isUp ? 100 : 0;
        }

        const periodMs  = days * 24 * 60 * 60 * 1000;
        const startTime = Date.now() - periodMs;

        let downMs    = 0;
        let prevTime  = Date.now();
        let prevStatus = lastStatus.get(alias) ?? true;

        for (const event of events) {
            const eventTime = new Date(event.occurred_at).getTime();
            if (eventTime < startTime) break;

            if (!prevStatus) {
                downMs += prevTime - eventTime;
            }

            prevStatus = event.status === 'up';
            prevTime   = eventTime;
        }

        // Hitung dari event terakhir ke startTime
        if (!prevStatus && prevTime > startTime) {
            downMs += prevTime - startTime;
        }

        const uptimePct = Math.max(0, Math.min(100, ((periodMs - downMs) / periodMs) * 100));
        return Math.round(uptimePct * 100) / 100;

    } catch { return 0; }
};

// ─────────────────────────────────────────────
// SUMMARY SEMUA SERVER
// ─────────────────────────────────────────────

export const getUptimeSummary = async (aliases: string[], days: number = 7) => {
    const results = await Promise.all(aliases.map(async alias => {
        const pct    = await calculateUptimePct(alias, days);
        const events = await getUptimeHistory(alias, days);
        const lastDown = events.find(e => e.status === 'down');
        return {
            alias,
            uptimePct: pct,
            lastDown:  lastDown ? new Date(lastDown.occurred_at) : null,
            isOnline:  lastStatus.get(alias) ?? false,
            events:    events.length,
        };
    }));
    return results;
};

export const UptimeHistoryService = {
    recordUptimeEvent,
    initServerStatus,
    getUptimeHistory,
    calculateUptimePct,
    getUptimeSummary,
};