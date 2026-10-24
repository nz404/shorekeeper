import { Telegraf } from 'telegraf';
import type { ResultSetHeader } from 'mysql2/promise';
import { db } from '../database/connection';

/** Mengambil ID Telegram admin dari environment dan ID admin utama. */
export const getTelegramAdminIds = (primaryChatId: string): Set<string> => {
    const configuredIds = (process.env.TELEGRAM_ADMIN_USER_IDS || '')
        .split(',')
        .map(id => id.trim())
        .filter(id => /^\d+$/.test(id));

    return new Set([primaryChatId, ...configuredIds].filter(id => /^\d+$/.test(id)));
};

/** Membaca daftar user yang diizinkan dari konfigurasi environment lama. */
export const getLegacyAllowedTelegramUserIds = (): string[] =>
    (process.env.TELEGRAM_ALLOWED_USER_IDS || '')
        .split(',')
        .map(id => id.trim())
        .filter(id => /^\d+$/.test(id));

/** Memeriksa apakah user Telegram merupakan admin atau user terdaftar. */
export const isTelegramUserAuthorized = async (userId: string, primaryChatId: string): Promise<boolean> => {
    if (getTelegramAdminIds(primaryChatId).has(userId)) return true;

    const [rows] = await db.execute(
        'SELECT 1 FROM telegram_authorized_users WHERE user_id = ? LIMIT 1',
        [userId],
    );
    return (rows as unknown[]).length > 0;
};

/** Memeriksa apakah user termasuk admin Telegram. */
export const isTelegramAdmin = (userId: string, primaryChatId: string): boolean =>
    getTelegramAdminIds(primaryChatId).has(userId);

/** Menambahkan atau memperbarui user Telegram yang diizinkan. */
export const addAuthorizedTelegramUser = async (userId: string, addedBy: string): Promise<void> => {
    await db.execute(
        `INSERT INTO telegram_authorized_users (user_id, added_by) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE added_by = VALUES(added_by)`,
        [userId, addedBy],
    );
};

/** Mengganti ID user Telegram yang diizinkan. */
export const updateAuthorizedTelegramUser = async (
    currentUserId: string,
    nextUserId: string,
    updatedBy: string,
): Promise<boolean> => {
    const [result] = await db.execute<ResultSetHeader>(
        'UPDATE telegram_authorized_users SET user_id = ?, added_by = ? WHERE user_id = ?',
        [nextUserId, updatedBy, currentUserId],
    );
    return result.affectedRows > 0;
};

/** Menghapus akses user Telegram. */
export const removeAuthorizedTelegramUser = async (userId: string): Promise<void> => {
    await db.execute('DELETE FROM telegram_authorized_users WHERE user_id = ?', [userId]);
};

/** Mengambil semua ID user Telegram yang diizinkan. */
export const getAuthorizedTelegramUsers = async (): Promise<string[]> => {
    const [rows] = await db.execute(
        'SELECT user_id FROM telegram_authorized_users ORDER BY created_at ASC',
    );
    return (rows as Array<{ user_id: string | number }>).map(row => String(row.user_id));
};

/** Mengimpor user dari konfigurasi lama satu kali saat inisialisasi. */
export const importLegacyAuthorizedTelegramUsers = async (userIds: string[]): Promise<void> => {
    const migrationKey = 'telegram_allowed_users_imported';
    const [existing] = await db.execute(
        'SELECT value FROM settings WHERE `key` = ? LIMIT 1',
        [migrationKey],
    );
    if ((existing as unknown[]).length > 0) return;

    for (const userId of userIds) {
        await db.execute(
            'INSERT IGNORE INTO telegram_authorized_users (user_id, added_by) VALUES (?, ?)',
            [userId, 'env-migration'],
        );
    }
    await db.execute(
        'INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        [migrationKey, '1'],
    );
};

export interface TelegramGroup {
    chatId: string;
    title: string;
    chatType: 'group' | 'supergroup';
    active: boolean;
}

/** Menyimpan status dan informasi grup Telegram ke database. */
const saveTelegramGroup = async (
    chatId: string,
    title: string,
    chatType: 'group' | 'supergroup',
    active: boolean,
): Promise<void> => {
    await db.execute(
        `INSERT INTO telegram_groups (chat_id, title, chat_type, active) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE title = VALUES(title), chat_type = VALUES(chat_type), active = VALUES(active)`,
        [chatId, title || chatId, chatType, active ? 1 : 0],
    );
};

/** Mengambil daftar grup Telegram beserta status aktifnya. */
export const getTelegramGroups = async (): Promise<TelegramGroup[]> => {
    const [rows] = await db.execute(
        'SELECT chat_id, title, chat_type, active FROM telegram_groups ORDER BY title ASC',
    );
    return (rows as Array<{
        chat_id: string | number;
        title: string;
        chat_type: 'group' | 'supergroup';
        active: number | boolean | string;
    }>).map(row => ({
        chatId: String(row.chat_id),
        title: row.title,
        chatType: row.chat_type,
        active: row.active === true || row.active === 1 || row.active === '1',
    }));
};

/** Mendaftarkan middleware untuk melacak grup tempat bot berada. */
export const registerTelegramGroupTracking = (bot: Telegraf): void => {
    bot.use(async (ctx, next) => {
        try {
            const update = ctx.myChatMember;
            const chat = update?.chat || ctx.chat;
            if (chat && (chat.type === 'group' || chat.type === 'supergroup')) {
                const member = update?.new_chat_member;
                const active = member
                    ? member.status === 'member'
                        || member.status === 'administrator'
                        || (member.status === 'restricted' && member.is_member)
                    : true;
                await saveTelegramGroup(String(chat.id), chat.title || '', chat.type, active);
            }
        } catch (error) {
            console.error('Gagal menyimpan informasi grup Telegram:', error);
        }
        return next();
    });
};

/** Mengatur status langganan alert untuk chat Telegram. */
export const setAlertSubscription = async (chatId: string, enabled: boolean): Promise<void> => {
    await db.execute(
        `INSERT INTO alert_subscribers (chat_id, enabled) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)`,
        [chatId, enabled ? 1 : 0],
    );
};

/** Membuat langganan alert default jika chat belum memiliki pengaturan. */
export const ensureAlertSubscription = async (chatId: string): Promise<void> => {
    await db.execute(
        'INSERT IGNORE INTO alert_subscribers (chat_id, enabled) VALUES (?, 1)',
        [chatId],
    );
};

/** Mengambil ID chat yang berlangganan alert. */
export const getAlertSubscribers = async (): Promise<string[]> => {
    const destinations = await getAlertDestinationSettings();
    return destinations.filter(destination => destination.enabled).map(destination => destination.chatId);
};

export interface AlertDestination {
    chatId: string;
    enabled: boolean;
    configuredInEnv: boolean;
    title?: string;
}

/** Menggabungkan tujuan alert dari environment, database, dan grup aktif. */
export const getAlertDestinationSettings = async (): Promise<AlertDestination[]> => {
    const [[rows], groups] = await Promise.all([
        db.execute(
            'SELECT chat_id, enabled FROM alert_subscribers',
        ),
        getTelegramGroups(),
    ]);
    const configuredIds = (process.env.TELEGRAM_ALERT_CHAT_IDS || '')
        .split(',')
        .map(id => id.trim())
        .filter(id => /^-?\d+$/.test(id));
    const configured = new Set(configuredIds);
    const overrides = new Map(
        (rows as Array<{ chat_id: string | number; enabled: number | boolean | string }>).map(row => [
            String(row.chat_id),
            row.enabled === true || row.enabled === 1 || row.enabled === '1',
        ]),
    );
    const activeGroups = new Map(groups.filter(group => group.active).map(group => [group.chatId, group]));
    const inactiveGroupIds = new Set(groups.filter(group => !group.active).map(group => group.chatId));
    const allIds = new Set([...configured, ...overrides.keys(), ...activeGroups.keys()]);

    return [...allIds]
        .filter(chatId => !inactiveGroupIds.has(chatId))
        .map(chatId => ({
            chatId,
            enabled: overrides.get(chatId) ?? configured.has(chatId),
            configuredInEnv: configured.has(chatId),
            title: activeGroups.get(chatId)?.title,
        }));
};

/** Mengirim alert ke seluruh chat yang berlangganan. */
export const sendAlertToSubscribers = async (
    bot: Telegraf,
    message: string,
    parseMode?: 'Markdown',
): Promise<void> => {
    const subscribers = await getAlertSubscribers();
    const options = parseMode ? { parse_mode: parseMode } : {};

    for (const chatId of subscribers) {
        try {
            await bot.telegram.sendMessage(chatId, message, options);
        } catch (error) {
            console.error(`Gagal mengirim alert ke Telegram chat ${chatId}:`, error);
        }
    }
};
