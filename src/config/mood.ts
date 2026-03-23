// ═══════════════════════════════════════════════
// MOOD SYSTEM — Shorekeeper
// ═══════════════════════════════════════════════

import { nowLocal } from './timezone';

export type SKMood = 'tenang' | 'khawatir' | 'siaga' | 'frustrasi' | 'santai' | 'malu';

export interface MoodState {
    mood:       SKMood;
    expression: string;
    reason:     string;
    updatedAt:  Date;
}

export interface ServerStatus {
    alias:   string;
    online:  boolean;
    cpu:     number;
    ram:     number;
    disk:    number;
    errors:  number;
}

// ─────────────────────────────────────────────
// STATE GLOBAL
// ─────────────────────────────────────────────

let currentMood: MoodState = {
    mood:       'tenang',
    expression: 'heart',
    reason:     'Semua sistem berjalan normal.',
    updatedAt:  new Date(),
};

// ─────────────────────────────────────────────
// KONFIGURASI MOOD
// ─────────────────────────────────────────────

const MOOD_CONFIG: Record<SKMood, { expression: string; motions: string[] }> = {
    tenang:    { expression: 'heart',     motions: ['Idle']           },
    khawatir:  { expression: 'confused',  motions: ['Idle']           },
    siaga:     { expression: 'surprised', motions: ['Idle']           },
    frustrasi: { expression: 'angry',     motions: ['Idle']           },
    santai:    { expression: 'blush',     motions: ['Idle', 'DaiJi']  },
    malu:      { expression: 'blush',     motions: ['Wave']           },
};

export const PRAISE_KEYWORDS = [
    'bagus', 'keren', 'hebat', 'pintar', 'cantik', 'cakep', 'mantap',
    'top', 'luar biasa', 'sempurna', 'terbaik', 'amazing', 'good job',
    'terima kasih', 'makasih', 'thanks', 'thank you', 'suka', 'love',
    'sayang', 'pandai', 'jenius', 'canggih', 'wow', 'kerja bagus',
];

const ADMIN = process.env.ADMIN_NAME || 'Irvan';

const MOOD_GREETINGS: Record<SKMood, string[]> = {
    tenang: [
        `Semua sistem stabil, Kak ${ADMIN}. SK tetap memantau.`,
        `Sistem berjalan normal. Shorekeeper siap bertugas.`,
        `Semua layanan aktif dan normal. Ada yang perlu dibantu?`,
    ],
    khawatir: [
        `Kak ${ADMIN}, ada beberapa hal yang perlu diperhatikan di infrastruktur.`,
        `SK mendeteksi warning di beberapa server. Mohon segera dicek.`,
        `Ada anomali kecil yang perlu perhatian. SK terus memantau.`,
    ],
    siaga: [
        `Kak ${ADMIN}, ada server yang tidak merespons! Segera ditangani.`,
        `Perhatian — ada node dalam kondisi tidak stabil!`,
        `SK mendeteksi server down. Tindakan segera diperlukan!`,
    ],
    frustrasi: [
        `Kak ${ADMIN}, error terus berulang di beberapa server. Ini tidak normal.`,
        `Banyak anomali terdeteksi. Perlu investigasi menyeluruh.`,
        `Kondisi infrastruktur tidak stabil. SK sangat menyarankan pengecekan.`,
    ],
    santai: [
        `Malam yang tenang, Kak ${ADMIN}. Semua server berjalan normal.`,
        `Aktivitas rendah malam ini. SK tetap berjaga.`,
        `Infrastruktur aman. Istirahatlah, Kak ${ADMIN} — SK yang jaga.`,
    ],
    malu: [
        `B-bukan berarti SK senang dipuji ya! Hanya... menjalankan tugas saja.`,
        `J-jangan salah paham. Memang seharusnya bekerja dengan baik. Itu saja.`,
        `H-hmph. Pujian itu tidak akan membuat SK lengah dalam bertugas.`,
        `A-apa? Tidak perlu bilang begitu... tapi, terima kasih. Sedikit.`,
        `Bukan karena pujianmu SK bekerja keras ya! Memang sudah kewajiban.`,
    ],
};

// ─────────────────────────────────────────────
// KALKULASI MOOD
// ─────────────────────────────────────────────

export const calculateMood = (servers: ServerStatus[]): MoodState => {
    const now          = nowLocal();
    const hour         = now.getHours();
    const isSantaiTime = hour >= 22 || hour < 6;

    if (!servers.length) {
        return {
            mood:       isSantaiTime ? 'santai' : 'tenang',
            expression: isSantaiTime ? 'blush'  : 'heart',
            reason:     isSantaiTime ? 'Aktivitas rendah di jam malam.' : 'Belum ada server yang dipantau.',
            updatedAt:  now,
        };
    }

    const downServers    = servers.filter(s => !s.online);
    const warningServers = servers.filter(s => s.online && (s.cpu > 80 || s.ram > 85 || s.disk > 90));
    const errorServers   = servers.filter(s => s.errors > 5);
    const totalErrors    = servers.reduce((sum, s) => sum + s.errors, 0);

    let mood:   SKMood;
    let reason: string;

    if (downServers.length > 0) {
        mood   = 'siaga';
        reason = `${downServers.length} server down: ${downServers.map(s => s.alias).join(', ')}`;
    } else if (errorServers.length > 0 || totalErrors > 10) {
        mood   = 'frustrasi';
        reason = `Error berulang terdeteksi (${totalErrors} total error).`;
    } else if (warningServers.length > 0) {
        mood   = 'khawatir';
        reason = `${warningServers.length} server mendekati threshold: ${warningServers.map(s => s.alias).join(', ')}`;
    } else if (isSantaiTime) {
        mood   = 'santai';
        reason = 'Aktivitas rendah di jam malam.';
    } else {
        mood   = 'tenang';
        reason = 'Semua sistem berjalan normal.';
    }

    const greetings = MOOD_GREETINGS[mood];
    const greeting  = greetings[Math.floor(Math.random() * greetings.length)];

    return {
        mood,
        expression: MOOD_CONFIG[mood].expression,
        reason:     greeting,
        updatedAt:  now,
    };
};

// ─────────────────────────────────────────────
// GET / SET MOOD
// ─────────────────────────────────────────────

export const getCurrentMood  = (): MoodState  => currentMood;

export const updateMood = (servers: ServerStatus[]): MoodState => {
    const newMood = calculateMood(servers);
    if (newMood.mood !== currentMood.mood) {
        console.log(`🎭 Mood SK: ${currentMood.mood} → ${newMood.mood} (${newMood.reason})`);
        currentMood = newMood;
    } else {
        currentMood = { ...newMood, reason: currentMood.reason };
    }
    return currentMood;
};

export const getMoodEmoji = (mood: SKMood): string => ({
    tenang:    '😊',
    khawatir:  '😟',
    siaga:     '😰',
    frustrasi: '😤',
    santai:    '😴',
    malu:      '😳',
}[mood]);