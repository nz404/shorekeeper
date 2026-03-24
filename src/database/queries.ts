import { db } from './connection';

// CHAT HISTORY

/** Menyimpan pesan chat (user/assistant) ke database */
export const saveChat = async (userId: number, role: 'user' | 'assistant', message: string) => {
    try {
        await db.execute('INSERT INTO chat_history (user_id, role, message) VALUES (?, ?, ?)', [userId, role, message]);
    } catch (e) { console.error('Gagal simpan chat:', e); }
};

/** Mengambil konteks chat terbaru (10 pesan) untuk user */
export const getChatContext = async (userId: number) => {
    try {
        const [rows] = await db.execute(
            'SELECT role, message FROM chat_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 10',
            [userId]
        );
        return (rows as any[]).reverse();
    } catch (e) { console.error('Gagal ambil context:', e); return []; }
};

/** Mengambil chat berdasarkan tanggal tertentu untuk user */
export const getChatByDate = async (userId: number, date: string) => {
    try {
        const [rows] = await db.execute(
            'SELECT role, message, created_at FROM chat_history WHERE user_id = ? AND DATE(created_at) = ? ORDER BY created_at ASC',
            [userId, date]
        );
        return rows as any[];
    } catch (e) { console.error('Gagal ambil chat tanggal:', e); return []; }
};

/** Menghapus semua chat history untuk user tertentu */
export const clearChatHistory = async (userId: number): Promise<boolean> => {
    try {
        const [result]: any = await db.execute('DELETE FROM chat_history WHERE user_id = ?', [userId]);
        return result.affectedRows > 0;
    } catch (e) { console.error('Gagal clear chat:', e); return false; }
};

/** Mengambil semua chat history untuk user (untuk export) */
export const getAllChatHistory = async (userId: number) => {
    try {
        const [rows] = await db.execute(
            'SELECT role, message, created_at FROM chat_history WHERE user_id = ? ORDER BY created_at ASC',
            [userId]
        );
        return rows as any[];
    } catch (e) { console.error('Gagal export chat:', e); return []; }
};

/** Mengimpor chat history dari array data */
export const importChatHistory = async (userId: number, chats: any[]) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        for (const chat of chats) {
            await conn.execute(
                'INSERT INTO chat_history (user_id, role, message, created_at) VALUES (?, ?, ?, ?)',
                [userId, chat.role, chat.message, chat.created_at]
            );
        }
        await conn.commit();
        return true;
    } catch (e) { await conn.rollback(); console.error('Gagal import chat:', e); return false; }
    finally { conn.release(); }
};

// ALIAS SSH

/** Menambahkan alias SSH baru ke database */
export const addAliasToDB = async (alias: string, host: string, port: number, user: string, pass: string) => {
    try {
        await db.execute(
            'INSERT INTO server_aliases (alias, host, port, username, password) VALUES (?, ?, ?, ?, ?)',
            [alias.toLowerCase().trim(), host, port, user, pass]
        );
        return true;
    } catch (e) { console.error('Gagal tambah alias:', e); return false; }
};

/** Mengambil detail alias SSH berdasarkan nama */
export const getAliasFromDB = async (aliasName: string) => {
    try {
        const [rows]: any = await db.execute(
            'SELECT * FROM server_aliases WHERE alias = ?',
            [aliasName.toLowerCase().trim()]
        );
        return rows.length > 0 ? rows[0] : null;
    } catch (e) { console.error('Gagal ambil alias:', e); return null; }
};

/** Menghapus alias SSH dari database */
export const removeAliasFromDB = async (alias: string): Promise<boolean> => {
    try {
        const [result]: any = await db.execute(
            'DELETE FROM server_aliases WHERE alias = ?',
            [alias.toLowerCase().trim()]
        );
        return result.affectedRows > 0;
    } catch (e) { console.error('Gagal hapus alias:', e); return false; }
};

/** Mengambil semua alias SSH (hanya alias dan host) */
export const getAllAliases = async () => {
    try {
        const [rows]: any = await db.execute('SELECT alias, host FROM server_aliases');
        return rows;
    } catch (e) { console.error('Gagal ambil aliases:', e); return []; }
};

/** Mengambil semua alias SSH lengkap (untuk backup) */
export const getAllAliasesForBackup = async () => {
    try {
        const [rows] = await db.execute('SELECT alias, host, port, username, password FROM server_aliases');
        return rows as any[];
    } catch (e) { console.error('Gagal backup alias:', e); return []; }
};

/** Mengimpor alias SSH dari array data */
export const importAliases = async (aliases: any[]) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        for (const a of aliases) {
            await conn.execute(
                'INSERT INTO server_aliases (alias, host, port, username, password) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE host=VALUES(host), port=VALUES(port), username=VALUES(username), password=VALUES(password)',
                [a.alias, a.host, a.port, a.username, a.password]
            );
        }
        await conn.commit();
        return true;
    } catch (e) { await conn.rollback(); console.error('Gagal import alias:', e); return false; }
    finally { conn.release(); }
};

// MONITOR SERVERS

/** Mengambil daftar alias server yang dimonitor */
export const getMonitorServers = async (): Promise<string[]> => {
    try {
        const [rows]: any = await db.execute('SELECT alias FROM monitor_servers');
        return rows.map((r: any) => r.alias);
    } catch (e) { console.error('Gagal ambil monitor servers:', e); return []; }
};

/** Menambahkan server ke daftar monitor */
export const addMonitorServer = async (alias: string): Promise<boolean> => {
    try {
        await db.execute('INSERT IGNORE INTO monitor_servers (alias) VALUES (?)', [alias]);
        return true;
    } catch (e) { console.error('Gagal tambah monitor server:', e); return false; }
};

/** Menghapus server dari daftar monitor */
export const removeMonitorServer = async (alias: string): Promise<boolean> => {
    try {
        const [result]: any = await db.execute('DELETE FROM monitor_servers WHERE alias = ?', [alias]);
        return result.affectedRows > 0;
    } catch (e) { console.error('Gagal hapus monitor server:', e); return false; }
};

// ── REMINDER ──

/** Menambahkan reminder baru */
export const addReminder = async (
    userId: number, message: string, remindAt: Date,
    repeatType: 'none' | 'daily' | 'weekly' = 'none'
) => {
    try {
        const [result]: any = await db.execute(
            'INSERT INTO reminders (user_id, message, remind_at, repeat_type) VALUES (?, ?, ?, ?)',
            [userId, message, remindAt, repeatType]
        );
        return result.insertId;
    } catch (e) { console.error('addReminder error:', e); return null; }
};

/** Mengambil reminder yang sudah jatuh tempo */
export const getDueReminders = async () => {
    try {
        const [rows]: any = await db.execute(
            'SELECT * FROM reminders WHERE active = 1 AND remind_at <= NOW()'
        );
        return rows as any[];
    } catch { return []; }
};

/** Memperbarui waktu reminder berikutnya */
export const updateReminderTime = async (id: number, nextAt: Date) => {
    try {
        await db.execute('UPDATE reminders SET remind_at = ? WHERE id = ?', [nextAt, id]);
    } catch (e) { console.error('updateReminderTime error:', e); }
};

/** Menonaktifkan reminder */
export const deactivateReminder = async (id: number) => {
    try {
        await db.execute('UPDATE reminders SET active = 0 WHERE id = ?', [id]);
    } catch (e) { console.error('deactivateReminder error:', e); }
};

/** Mengambil semua reminder aktif untuk user */
export const getActiveReminders = async (userId: number) => {
    try {
        const [rows]: any = await db.execute(
            'SELECT * FROM reminders WHERE user_id = ? AND active = 1 ORDER BY remind_at ASC',
            [userId]
        );
        return rows as any[];
    } catch { return []; }
};

/** Menghapus reminder berdasarkan ID dan user */
export const deleteReminder = async (id: number, userId: number) => {
    try {
        const [result]: any = await db.execute(
            'DELETE FROM reminders WHERE id = ? AND user_id = ?',
            [id, userId]
        );
        return result.affectedRows > 0;
    } catch { return false; }
};

// ── CATATAN ──

/** Menambahkan catatan baru */
export const addNote = async (
    userId: number, title: string, content: string, tag: string = 'general'
) => {
    try {
        const [result]: any = await db.execute(
            'INSERT INTO notes (user_id, title, content, tag) VALUES (?, ?, ?, ?)',
            [userId, title, content, tag]
        );
        return result.insertId;
    } catch (e) { console.error('addNote error:', e); return null; }
};

/** Mengambil catatan untuk user, opsional berdasarkan tag */
export const getNotes = async (userId: number, tag?: string) => {
    try {
        const query = tag
            ? 'SELECT id, title, tag, content, created_at FROM notes WHERE user_id = ? AND tag = ? ORDER BY updated_at DESC LIMIT 20'
            : 'SELECT id, title, tag, content, created_at FROM notes WHERE user_id = ? ORDER BY updated_at DESC LIMIT 20';
        const [rows]: any = await db.execute(query, tag ? [userId, tag] : [userId]);
        return rows as any[];
    } catch { return []; }
};

/** Mengambil catatan berdasarkan ID dan user */
export const getNoteById = async (id: number, userId: number) => {
    try {
        const [rows]: any = await db.execute(
            'SELECT * FROM notes WHERE id = ? AND user_id = ?',
            [id, userId]
        );
        return rows[0] || null;
    } catch { return null; }
};

/** Mencari catatan berdasarkan keyword di title atau content */
export const searchNotes = async (userId: number, keyword: string) => {
    try {
        const [rows]: any = await db.execute(
            'SELECT id, title, tag, content, created_at FROM notes WHERE user_id = ? AND (title LIKE ? OR content LIKE ?) ORDER BY updated_at DESC LIMIT 10',
            [userId, `%${keyword}%`, `%${keyword}%`]
        );
        return rows as any[];
    } catch { return []; }
};

/** Menghapus catatan berdasarkan ID dan user */
export const deleteNote = async (id: number, userId: number) => {
    try {
        const [result]: any = await db.execute(
            'DELETE FROM notes WHERE id = ? AND user_id = ?',
            [id, userId]
        );
        return result.affectedRows > 0;
    } catch { return false; }
};

// SETTINGS — simpan konfigurasi dinamis

/** Mengambil nilai setting berdasarkan key */
export const getSetting = async (key: string): Promise<string | null> => {
    try {
        const [rows]: any = await db.execute(
            'SELECT value FROM settings WHERE \`key\` = ?', [key]
        );
        return rows[0]?.value || null;
    } catch { return null; }
};

/** Menyimpan atau memperbarui nilai setting */
export const setSetting = async (key: string, value: string): Promise<boolean> => {
    try {
        await db.execute(
            'INSERT INTO settings (\`key\`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?',
            [key, value, value]
        );
        return true;
    } catch { return false; }
};