import { createHash, randomBytes, timingSafeEqual } from 'crypto';

// ─────────────────────────────────────────────
// TIPE SESSION
// ─────────────────────────────────────────────

export interface Session {
    role:      'admin';
    username:  string;
    createdAt: number;
    expiresAt: number;
}

// ─────────────────────────────────────────────
// STORE (in-memory)
// ─────────────────────────────────────────────

export const sessions     = new Map<string, Session>();

const SESSION_TTL_MS      = 24 * 60 * 60 * 1000;

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
    if (loginAttempts.size >= 10_000 && !loginAttempts.has(ip)) {
        for (const [key, attempt] of loginAttempts) {
            if (now - attempt.lastAt > LOCKOUT_MS) loginAttempts.delete(key);
        }
        if (loginAttempts.size >= 10_000) {
            const oldest = [...loginAttempts.entries()].sort((a, b) => a[1].lastAt - b[1].lastAt)[0];
            if (oldest) loginAttempts.delete(oldest[0]);
        }
    }
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

export const generateToken = (): string => randomBytes(32).toString('hex');

export const createSession = (username: string): string => {
    const token = generateToken();
    const createdAt = Date.now();
    sessions.set(token, { role: 'admin', username, createdAt, expiresAt: createdAt + SESSION_TTL_MS });
    const expiry = setTimeout(() => sessions.delete(token), SESSION_TTL_MS);
    expiry.unref();
    return token;
};

export const getSession = (authHeader?: string): Session | null => {
    const match = authHeader?.match(/^Bearer ([a-f0-9]{64})$/i);
    if (!match) return null;
    const session = sessions.get(match[1]);
    if (!session) return null;
    if (Date.now() >= session.expiresAt) {
        sessions.delete(match[1]);
        return null;
    }
    return session;
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

export const matchesCredential = (provided: string, configured: string): boolean => {
    const providedHash = createHash('sha256').update(provided, 'utf8').digest();
    const configuredHash = createHash('sha256').update(configured, 'utf8').digest();
    return timingSafeEqual(providedHash, configuredHash);
};