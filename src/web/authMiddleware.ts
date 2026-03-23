import { createHash } from 'crypto';

// ─────────────────────────────────────────────
// TIPE SESSION
// ─────────────────────────────────────────────

export interface Session {
    role:      'admin' | 'guest';
    username:  string;
    createdAt: number;
}

// ─────────────────────────────────────────────
// STORE (in-memory)
// ─────────────────────────────────────────────

export const sessions     = new Map<string, Session>();
export const guestCounter = new Map<string, { count: number; date: string }>();

const SESSION_TTL_MS      = 24 * 60 * 60 * 1000;
export const GUEST_LIMIT  = parseInt(process.env.WEB_GUEST_LIMIT || '5');

// ─────────────────────────────────────────────
// BRUTE FORCE PROTECTION
// ─────────────────────────────────────────────

const MAX_ATTEMPTS   = 5;                    // max gagal sebelum lockout
const LOCKOUT_MS     = 15 * 60 * 1000;      // lockout 15 menit
const ATTEMPT_TTL_MS = 10 * 60 * 1000;      // reset counter setelah 10 menit tidak ada upaya

interface LoginAttempt {
    count:     number;
    lockedUntil: number | null;
    lastAt:    number;
}

const loginAttempts = new Map<string, LoginAttempt>();

export const checkLoginAttempt = (ip: string): { allowed: boolean; remaining: number; retryAfter?: number } => {
    const now   = Date.now();
    const entry = loginAttempts.get(ip);

    if (!entry) return { allowed: true, remaining: MAX_ATTEMPTS };

    // Reset kalau sudah lama tidak ada upaya
    if (now - entry.lastAt > ATTEMPT_TTL_MS && !entry.lockedUntil) {
        loginAttempts.delete(ip);
        return { allowed: true, remaining: MAX_ATTEMPTS };
    }

    // Cek lockout
    if (entry.lockedUntil && now < entry.lockedUntil) {
        const retryAfter = Math.ceil((entry.lockedUntil - now) / 1000);
        return { allowed: false, remaining: 0, retryAfter };
    }

    // Lockout expired — reset
    if (entry.lockedUntil && now >= entry.lockedUntil) {
        loginAttempts.delete(ip);
        return { allowed: true, remaining: MAX_ATTEMPTS };
    }

    const remaining = Math.max(0, MAX_ATTEMPTS - entry.count);
    return { allowed: remaining > 0, remaining };
};

export const recordFailedLogin = (ip: string): void => {
    const now   = Date.now();
    const entry = loginAttempts.get(ip) || { count: 0, lockedUntil: null, lastAt: now };
    entry.count   += 1;
    entry.lastAt   = now;
    entry.lockedUntil = entry.count >= MAX_ATTEMPTS ? now + LOCKOUT_MS : null;
    loginAttempts.set(ip, entry);
    if (entry.lockedUntil) {
        console.warn(`⚠️  Login lockout: ${ip} (${entry.count} percobaan gagal)`);
    }
};

export const resetLoginAttempt = (ip: string): void => {
    loginAttempts.delete(ip);
};

// ─────────────────────────────────────────────
// SESSION HELPERS
// ─────────────────────────────────────────────

export const generateToken = (): string =>
    createHash('sha256')
        .update(Date.now().toString() + Math.random().toString())
        .digest('hex');

export const createSession = (role: 'admin' | 'guest', username: string): string => {
    const token = generateToken();
    sessions.set(token, { role, username, createdAt: Date.now() });
    setTimeout(() => sessions.delete(token), SESSION_TTL_MS);
    return token;
};

export const getSession = (authHeader?: string): Session | null => {
    const token = authHeader?.replace('Bearer ', '');
    return (token && sessions.get(token)) || null;
};

/** Middleware helper — returns session or sends 401 */
export const requireAuth = (req: any, res: any): Session | null => {
    const session = getSession(req.headers.authorization);
    if (!session) { res.status(401).json({ ok: false, message: 'Tidak terautentikasi.' }); return null; }
    return session;
};

/** Middleware helper — returns session or sends 403 */
export const requireAdmin = (req: any, res: any): Session | null => {
    const session = requireAuth(req, res);
    if (!session) return null;
    if (session.role !== 'admin') { res.status(403).json({ ok: false, message: 'Akses ditolak.' }); return null; }
    return session;
};

// ─────────────────────────────────────────────
// GUEST RATE LIMIT
// ─────────────────────────────────────────────

export const checkGuestLimit = (key: string): { allowed: boolean; remaining: number } => {
    const today = new Date().toISOString().slice(0, 10);
    const entry = guestCounter.get(key);
    if (!entry || entry.date !== today) {
        guestCounter.set(key, { count: 0, date: today });
        return { allowed: true, remaining: GUEST_LIMIT };
    }
    const remaining = GUEST_LIMIT - entry.count;
    return { allowed: remaining > 0, remaining };
};

export const incrementGuestCount = (key: string): void => {
    const today = new Date().toISOString().slice(0, 10);
    const entry = guestCounter.get(key) || { count: 0, date: today };
    guestCounter.set(key, { count: entry.count + 1, date: today });
};