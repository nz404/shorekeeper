import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import { Telegraf } from 'telegraf';
import { databaseEndpoint, db, verifyDatabaseConnection } from '../database/connection';
import { initMonitorJob } from '../jobs/monitor.job';
import { initReporterJob } from '../jobs/reporter.job';
import { initReminderJob } from '../jobs/reminder.job';
import { initPingMonitorJob } from '../jobs/pingMonitor.job';
import { initWebServer } from '../web/webServer';
import { registerHandlers } from '../handlers/mainHandler';
import { initMikrotikJob } from '../jobs/mikrotikMonitor.job';
import {
    ensureAlertSubscription,
    getLegacyAllowedTelegramUserIds,
    importLegacyAuthorizedTelegramUsers,
    registerTelegramGroupTracking,
} from '../services/alert.service';

const bot        = new Telegraf(process.env.TELEGRAM_TOKEN!, { handlerTimeout: 600_000 });
const MY_CHAT_ID = process.env.MY_CHAT_ID!;

// ─────────────────────────────────────────────
// AUTO INIT TABEL & MIGRATION
// ─────────────────────────────────────────────

/** Membuat tabel aplikasi, menjalankan migrasi, dan menyiapkan folder backup. */
const initDatabase = async (): Promise<void> => {
    const tables = [
        {
            name: 'telegram_authorized_users',
            sql: `CREATE TABLE IF NOT EXISTS telegram_authorized_users (
                user_id VARCHAR(32) PRIMARY KEY,
                added_by VARCHAR(32) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        },
        {
            name: 'alert_subscribers',
            sql: `CREATE TABLE IF NOT EXISTS alert_subscribers (
                chat_id VARCHAR(32) PRIMARY KEY,
                enabled TINYINT(1) NOT NULL DEFAULT 1,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        },
        {
            name: 'report_subscribers',
            sql: `CREATE TABLE IF NOT EXISTS report_subscribers (
                chat_id VARCHAR(32) PRIMARY KEY,
                enabled TINYINT(1) NOT NULL DEFAULT 1,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        },
        {
            name: 'telegram_groups',
            sql: `CREATE TABLE IF NOT EXISTS telegram_groups (
                chat_id VARCHAR(32) PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                chat_type ENUM('group','supergroup') NOT NULL,
                active TINYINT(1) NOT NULL DEFAULT 1,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        },
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
        {
            name: 'mikrotik_devices',
            sql: `CREATE TABLE IF NOT EXISTS mikrotik_devices (
                id INT AUTO_INCREMENT PRIMARY KEY,
                alias VARCHAR(100) UNIQUE NOT NULL,
                host VARCHAR(255) NOT NULL,
                port INT NOT NULL DEFAULT 22,
                username VARCHAR(100) NOT NULL,
                password VARCHAR(255) NOT NULL,
                last_cpu INT DEFAULT 0,
                last_uptime VARCHAR(100) DEFAULT '-',
                status ENUM('up', 'down', 'unknown') DEFAULT 'unknown',
                last_check TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        },
        {
            name: 'mikrotik_stats',
            sql: `CREATE TABLE IF NOT EXISTS mikrotik_stats (
                id INT AUTO_INCREMENT PRIMARY KEY,
                device_id INT NOT NULL,
                rx_val FLOAT DEFAULT 0,
                tx_val FLOAT DEFAULT 0,
                cpu_val INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_device (device_id),
                INDEX idx_date (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        }
    ];

    for (const table of tables) {
        await db.execute(table.sql);
        console.log(`✅ Tabel '${table.name}' siap.`);
    }

    /** Helper untuk tambah kolom jika belum ada */
    /** Menjalankan migrasi penambahan kolom dan mencatat hasilnya. */
    const ensureColumn = async (sql: string, successMsg: string) => {
        try {
            await db.execute(sql);
            console.log(successMsg);
        } catch (e: any) {
            // Error 1060 artinya kolom sudah ada, kita abaikan saja
            if (e.errno !== 1060) {
                console.log(`ℹ️ Info Kolom: ${e.message}`);
            }
        }
    };

    // --- MIGRATION: Tambah kolom RX/TX ke tabel MikroTik ---
    await ensureColumn(
        `ALTER TABLE mikrotik_devices ADD COLUMN IF NOT EXISTS rx_rate VARCHAR(50) DEFAULT '0bps' AFTER status`,
        '✅ Kolom rx_rate di mikrotik_devices siap.'
    );

    await ensureColumn(
        `ALTER TABLE mikrotik_devices ADD COLUMN IF NOT EXISTS tx_rate VARCHAR(50) DEFAULT '0bps' AFTER rx_rate`,
        '✅ Kolom tx_rate di mikrotik_devices siap.'
    );

    // --- MIGRATION: Proxmox ---
    await ensureColumn(
        `ALTER TABLE proxmox_clusters ADD COLUMN IF NOT EXISTS secret VARCHAR(500) NOT NULL`,
        '✅ Kolom secret di proxmox_clusters siap.'
    );

    await ensureColumn(
        `ALTER TABLE proxmox_clusters ADD COLUMN IF NOT EXISTS token_id VARCHAR(100) NOT NULL DEFAULT 'shorekeeper'`,
        '✅ Kolom token_id di proxmox_clusters siap.'
    );

    await ensureColumn(
        `ALTER TABLE proxmox_clusters ADD COLUMN IF NOT EXISTS token_secret VARCHAR(500) NOT NULL DEFAULT ''`,
        '✅ Kolom token_secret di proxmox_clusters siap.'
    );

    // Sync data Proxmox
    try {
        await db.execute(`UPDATE proxmox_clusters SET token_secret = secret WHERE token_secret = '' OR token_secret IS NULL`);
        await db.execute(`UPDATE proxmox_clusters SET secret = token_secret WHERE secret = '' OR secret IS NULL`);
        console.log('✅ Sync token_secret/secret selesai.');
    } catch (e) {
        // Abaikan jika tidak ada data
    }

    // --- AUTO CREATE FOLDER BACKUP ---
    const backupDir = path.join(__dirname, '../../backups');
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
        console.log('✅ Folder backups dibuat.');
    }

    console.log('🛡️ Database Shorekeeper siap!');
};

// ─────────────────────────────────────────────
// MAIN EXECUTION
// ─────────────────────────────────────────────

/** Menginisialisasi database, job, bot Telegram, dan web server. */
const main = async () => {
    try {
        await verifyDatabaseConnection();
        console.log(`✅ Koneksi database ${databaseEndpoint} berhasil.`);
        await initDatabase();
        await ensureAlertSubscription(MY_CHAT_ID);
        await importLegacyAuthorizedTelegramUsers(getLegacyAllowedTelegramUserIds());
        
        // Start Jobs
        initMonitorJob(bot, MY_CHAT_ID);
//        initMikrotikJob(bot, MY_CHAT_ID); 
        await initReporterJob(bot, MY_CHAT_ID);
        initPingMonitorJob(bot, MY_CHAT_ID);
        initReminderJob(bot, MY_CHAT_ID);
        
        // Register Telegram Handlers
        registerTelegramGroupTracking(bot);
        registerHandlers(bot, MY_CHAT_ID);
        
        // Launch Bot
        bot.launch().then(() => {
            console.log('✨ Bot Shorekeeper aktif!');
        }).catch((err) => { 
            console.error('🚨 Bot error:', err.message); 
        });

        // Start Web Interface
        initWebServer();
        
        console.log('SK Aktif & Modular! 🚀');
    } catch (err: any) {
        const code = err?.code ? ` (${err.code})` : '';
        const endpoint = err?.code ? ` ke ${databaseEndpoint}` : '';
        console.error(`🚨 Gagal start SK${code}${endpoint}:`, err.message);
        process.exit(1);
    }
};

main();
