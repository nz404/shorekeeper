import { Telegraf } from 'telegraf';
import * as net from 'net';
import * as dns from 'dns';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fetch = require('node-fetch') as typeof import('node-fetch').default;
import { db } from '../database/connection';
import { wrapWithSKVoice } from '../config/persona';

// ═══════════════════════════════════════════════
// PING MONITOR — HTTP/IP/Port check
// SQL:
// CREATE TABLE IF NOT EXISTS ping_targets (
//   id          INT AUTO_INCREMENT PRIMARY KEY,
//   name        VARCHAR(100) NOT NULL,
//   type        ENUM('http','ip') NOT NULL,
//   target      VARCHAR(255) NOT NULL,

//   active      TINYINT DEFAULT 1,
//   created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
// );
// CREATE TABLE IF NOT EXISTS ping_status (
//   id          INT AUTO_INCREMENT PRIMARY KEY,
//   target_id   INT NOT NULL,
//   is_up       TINYINT NOT NULL,
//   latency_ms  INT DEFAULT NULL,
//   checked_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//   INDEX idx_target (target_id),
//   INDEX idx_checked (checked_at)
// );
// ═══════════════════════════════════════════════

// ─────────────────────────────────────────────
// DB QUERIES
// ─────────────────────────────────────────────

export const getPingTargets = async () => {
    try {
        const [rows]: any = await db.execute(
            'SELECT * FROM ping_targets WHERE active = 1'
        );
        return rows as any[];
    } catch { return []; }
};

export const addPingTarget = async (name: string, type: 'http' | 'ip', target: string) => {
    try {
        const [result]: any = await db.execute(
            'INSERT INTO ping_targets (name, type, target) VALUES (?, ?, ?)',
            [name, type, target]
        );
        return result.insertId;
    } catch (e) { console.error('addPingTarget error:', e); return null; }
};

export const removePingTarget = async (id: number) => {
    try {
        await db.execute('UPDATE ping_targets SET active = 0 WHERE id = ?', [id]);
        return true;
    } catch { return false; }
};

export const savePingStatus = async (targetId: number, isUp: boolean, latencyMs?: number) => {
    try {
        await db.execute(
            'INSERT INTO ping_status (target_id, is_up, latency_ms) VALUES (?, ?, ?)',
            [targetId, isUp ? 1 : 0, latencyMs || null]
        );
    } catch {}
};

export const getPingHistory = async (targetId: number, limit = 20) => {
    try {
        const [rows]: any = await db.execute(
            'SELECT * FROM ping_status WHERE target_id = ? ORDER BY checked_at DESC LIMIT ?',
            [targetId, limit]
        );
        return rows as any[];
    } catch { return []; }
};

// ─────────────────────────────────────────────
// CHECK FUNCTIONS
// ─────────────────────────────────────────────

const checkHTTP = async (url: string): Promise<{ up: boolean; latency: number; status?: number }> => {
    const start = Date.now();
    try {
        const res = await fetch(url, {
            method:  'HEAD',
            timeout: 10000,
            headers: { 'User-Agent': 'Shorekeeper-Monitor/1.0' },
            redirect: 'follow',
        } as any);

        const latency = Date.now() - start;
        const up      = res.status < 500;
        return { up, latency, status: res.status };

    } catch (err: any) {
        return { up: false, latency: Date.now() - start };
    }
};

const checkPort = (host: string, port: number): Promise<{ up: boolean; latency: number }> => {
    return new Promise((resolve) => {
        const start  = Date.now();
        const socket = new net.Socket();
        const timeout = setTimeout(() => {
            socket.destroy();
            resolve({ up: false, latency: 10000 });
        }, 10000);

        socket.connect(port, host, () => {
            clearTimeout(timeout);
            socket.destroy();
            resolve({ up: true, latency: Date.now() - start });
        });
        socket.on('error', () => {
            clearTimeout(timeout);
            resolve({ up: false, latency: Date.now() - start });
        });
    });
};

const checkIP = (host: string): Promise<{ up: boolean; latency: number }> => {
    return new Promise((resolve) => {
        const start = Date.now();
        // Coba resolve DNS dulu
        dns.lookup(host, (err) => {
            if (err) { resolve({ up: false, latency: 0 }); return; }
            // Coba TCP connect ke port 80 atau 443
            const tryPort = (port: number, fallback?: number) => {
                const socket  = new net.Socket();
                const timeout = setTimeout(() => {
                    socket.destroy();
                    if (fallback) tryPort(fallback);
                    else resolve({ up: false, latency: Date.now() - start });
                }, 5000);
                socket.connect(port, host, () => {
                    clearTimeout(timeout);
                    socket.destroy();
                    resolve({ up: true, latency: Date.now() - start });
                });
                socket.on('error', () => {
                    clearTimeout(timeout);
                    if (fallback) tryPort(fallback);
                    else resolve({ up: false, latency: Date.now() - start });
                });
            };
            tryPort(80, 443);
        });
    });
};

// ─────────────────────────────────────────────
// TRACK STATUS SEBELUMNYA
// ─────────────────────────────────────────────

const lastStatus = new Map<number, boolean>();

// Init status target baru tanpa trigger alert
export const initTargetStatus = async (targetId: number, type: string, target: string): Promise<boolean> => {
    try {
        const result = type === 'http'
            ? await checkHTTP(target)
            : await checkIP(target);
        lastStatus.set(targetId, result.up);
        await savePingStatus(targetId, result.up, result.latency);
        return result.up;
    } catch {
        return false;
    }
};

// ─────────────────────────────────────────────
// CHECK SEMUA TARGET
// ─────────────────────────────────────────────

export const checkTarget = async (target: any): Promise<{ up: boolean; latency: number }> => {
    try {
        if (target.type === 'http') {
            return await checkHTTP(target.target);
        } else {
            return await checkIP(target.target);
        }
    } catch {
        return { up: false, latency: 0 };
    }
};

// ─────────────────────────────────────────────
// FORMAT ALERT
// ─────────────────────────────────────────────

const formatAlert = async (target: any, isUp: boolean, latency: number): Promise<string> => {
    const icon     = isUp ? '🟢' : '🔴';
    const status   = isUp ? 'PULIH' : 'DOWN';
    const typeIcon = target.type === 'http' ? '🌐' : target.type === 'port' ? '🔌' : '📡';
    const detail   = target.type === 'port' ? `:${target.port}` : '';

    const raw = `${icon} ${status}: ${typeIcon} ${target.name} (${target.target}${detail})` +
        (isUp ? `\n⚡ Latensi: ${latency}ms` : '\n⏱️ Tidak merespons dalam 10 detik');

    try {
        return await wrapWithSKVoice(isUp ? 'troubleshoot' : 'alert', raw);
    } catch {
        return raw;
    }
};

// ─────────────────────────────────────────────
// INIT PING MONITOR JOB
// ─────────────────────────────────────────────

export const initPingMonitorJob = (bot: Telegraf, chatId: string) => {
    console.log('📡 Ping Monitor aktif | Interval: 60s');

    setInterval(async () => {
        try {
            const targets = await getPingTargets();
            if (!targets.length) return;

            for (const target of targets) {
                const { up, latency } = await checkTarget(target);
                await savePingStatus(target.id, up, latency);

                const prev = lastStatus.get(target.id);

                // Alert kalau status berubah
                if (prev !== undefined && prev !== up) {
                    const alert = await formatAlert(target, up, latency);
                    await bot.telegram.sendMessage(chatId, alert);
                }

                lastStatus.set(target.id, up);
            }
        } catch (err: any) {
            console.error('Ping monitor error:', err.message);
        }
    }, 60_000);
};

// ─────────────────────────────────────────────
// GET CURRENT STATUS SEMUA TARGET
// ─────────────────────────────────────────────

export const getPingStatus = async () => {
    const targets = await getPingTargets();
    return targets.map(t => ({
        ...t,
        isUp: lastStatus.get(t.id) ?? null,
    }));
};