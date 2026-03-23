import * as dotenv from 'dotenv';
dotenv.config();

import { Telegraf } from 'telegraf';
import { db } from '../database/connection';
import { initMonitorJob } from '../jobs/monitor';
import { initReporterJob } from '../jobs/reporter';
import { initReminderJob } from '../jobs/reminder';
import { initPingMonitorJob } from '../jobs/pingMonitor';
import { initWebServer } from '../web/webServer';
import { registerHandlers } from '../handlers/mainHandler';

const bot        = new Telegraf(process.env.TELEGRAM_TOKEN!, { handlerTimeout: 600_000 });
const MY_CHAT_ID = process.env.MY_CHAT_ID!;

// ─────────────────────────────────────────────
// AUTO INIT TABEL
// ─────────────────────────────────────────────

const initDatabase = async (): Promise<void> => {
    const tables = [
        {
            name: 'chat_history',
            sql: `CREATE TABLE IF NOT EXISTS chat_history (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id BIGINT NOT NULL,
                role ENUM('user','assistant') NOT NULL,
                message TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_user_id (user_id),
                INDEX idx_created_at (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
        },
        {
            name: 'server_aliases',
            sql: `CREATE TABLE IF NOT EXISTS server_aliases (
                alias VARCHAR(100) PRIMARY KEY,
                host VARCHAR(255) NOT NULL,
                port INT NOT NULL DEFAULT 22,
                username VARCHAR(100) NOT NULL,
                password VARCHAR(255) NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
        },
        {
            name: 'monitor_servers',
            sql: `CREATE TABLE IF NOT EXISTS monitor_servers (
                alias VARCHAR(100) PRIMARY KEY
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
        },
        {
            name: 'reminders',
            sql: `CREATE TABLE IF NOT EXISTS reminders (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id BIGINT NOT NULL,
                message TEXT NOT NULL,
                remind_at DATETIME NOT NULL,
                repeat_type ENUM('none','daily','weekly') DEFAULT 'none',
                active TINYINT DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
        },
        {
            name: 'ping_targets',
            sql: `CREATE TABLE IF NOT EXISTS ping_targets (
                id         INT AUTO_INCREMENT PRIMARY KEY,
                name       VARCHAR(100) NOT NULL,
                type       ENUM('http','ip') NOT NULL,
                target     VARCHAR(255) NOT NULL,
                active     TINYINT DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        },
        {
            name: 'ping_status',
            sql: `CREATE TABLE IF NOT EXISTS ping_status (
                id         INT AUTO_INCREMENT PRIMARY KEY,
                target_id  INT NOT NULL,
                is_up      TINYINT NOT NULL,
                latency_ms INT DEFAULT NULL,
                checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_target (target_id),
                INDEX idx_checked (checked_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        },
        {
            name: 'uptime_events',
            sql: `CREATE TABLE IF NOT EXISTS uptime_events (
                id          INT AUTO_INCREMENT PRIMARY KEY,
                alias       VARCHAR(100) NOT NULL,
                status      ENUM('up','down') NOT NULL,
                occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_alias (alias),
                INDEX idx_occurred (occurred_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        },
        {
            name: 'settings',
            sql: `CREATE TABLE IF NOT EXISTS settings (
                \`key\`   VARCHAR(100) PRIMARY KEY,
                value VARCHAR(500) NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
        },
        {
            name: 'proxmox_clusters',
            sql: `CREATE TABLE IF NOT EXISTS proxmox_clusters (
                id     INT AUTO_INCREMENT PRIMARY KEY,
                name   VARCHAR(100) NOT NULL UNIQUE,
                host   VARCHAR(255) NOT NULL,
                port   INT NOT NULL DEFAULT 8006,
                user   VARCHAR(100) NOT NULL DEFAULT 'root@pam',
                token_id VARCHAR(100) NOT NULL DEFAULT 'shorekeeper',
                secret VARCHAR(500) NOT NULL,
                token_secret VARCHAR(500) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
        },
        {
            name: 'notes',
            sql: `CREATE TABLE IF NOT EXISTS notes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id BIGINT NOT NULL,
                title VARCHAR(255) NOT NULL,
                content TEXT NOT NULL,
                tag VARCHAR(100) DEFAULT 'general',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_user_id (user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
        },
    ];

    for (const table of tables) {
        await db.execute(table.sql);
        console.log(`✅ Tabel '${table.name}' siap.`);
    }

    const ensureColumn = async (sql: string, successMsg: string, infoMsg: string) => {
        try {
            await db.execute(sql);
            console.log(successMsg);
        } catch (e) {
            console.log(infoMsg);
        }
    };

    await ensureColumn(
        `ALTER TABLE proxmox_clusters ADD COLUMN IF NOT EXISTS secret VARCHAR(500) NOT NULL`,
        '✅ Kolom secret di proxmox_clusters siap.',
        'ℹ️ Kolom secret sudah ada atau gagal tambah (mungkin sudah ada).'
    );

    await ensureColumn(
        `ALTER TABLE proxmox_clusters ADD COLUMN IF NOT EXISTS token_id VARCHAR(100) NOT NULL DEFAULT 'shorekeeper'`,
        '✅ Kolom token_id di proxmox_clusters siap.',
        'ℹ️ Kolom token_id sudah ada atau gagal tambah (mungkin sudah ada).'
    );

    await ensureColumn(
        `ALTER TABLE proxmox_clusters ADD COLUMN IF NOT EXISTS token_secret VARCHAR(500) NOT NULL DEFAULT ''`,
        '✅ Kolom token_secret di proxmox_clusters siap.',
        'ℹ️ Kolom token_secret sudah ada atau gagal tambah (mungkin sudah ada).'
    );

    // Sync token_secret <-> secret for compatibility
    try {
        await db.execute(`UPDATE proxmox_clusters SET token_secret = secret WHERE token_secret = '' OR token_secret IS NULL`);
        await db.execute(`UPDATE proxmox_clusters SET secret = token_secret WHERE secret = '' OR secret IS NULL`);
        console.log('✅ Sync token_secret/secret saya lakukan.');
    } catch (e) {
        console.log('ℹ️ Tidak bisa sync token_secret/secret (boleh diabaikan jika sudah benar).');
    }

    console.log('🛡️ Database Shorekeeper siap!');
};

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────

const main = async () => {
    try {
        await initDatabase();
        initMonitorJob(bot, MY_CHAT_ID);
        await initReporterJob(bot, MY_CHAT_ID);
        initPingMonitorJob(bot, MY_CHAT_ID);
        initReminderJob(bot, MY_CHAT_ID);
        registerHandlers(bot, MY_CHAT_ID);
        bot.launch().catch((err) => { console.error('🚨 Bot error:', err.message); });
        initWebServer();
        console.log('SK Aktif & Modular! ✨');
    } catch (err: any) {
        console.error('🚨 Gagal start SK:', err.message);
        console.error('Code:', err.code);
        process.exit(1);
    }
};

main();