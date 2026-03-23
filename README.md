<div align="center">

# 🛡️ Shorekeeper

**AI Homelab Infrastructure Assistant**

*Berbasis karakter Shorekeeper dari Wuthering Waves*

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![PM2](https://img.shields.io/badge/PM2-Process_Manager-2B037A?style=flat-square)](https://pm2.keymetrics.io)
[![MariaDB](https://img.shields.io/badge/MariaDB-10.6%2B-003545?style=flat-square&logo=mariadb&logoColor=white)](https://mariadb.org)
[![Groq](https://img.shields.io/badge/AI-Groq_API-F55036?style=flat-square)](https://groq.com)
[![Telegram](https://img.shields.io/badge/Telegram-Bot-26A5E4?style=flat-square&logo=telegram&logoColor=white)](https://core.telegram.org/bots)

</div>

---

## 📖 Overview

Shorekeeper (SK) adalah AI asisten infrastruktur pribadi yang berjalan sebagai **Telegram bot** sekaligus **web dashboard**. SK memantau, menganalisis, dan membantu mengelola server secara real-time.


### ✨ Fitur Utama

- Monitoring CPU, RAM, Disk via SSH dengan alert otomatis
- Proxmox: lihat status VM/LXC, start/stop/reboot
- Docker: list container, start/stop/restart, lihat log
- Ping monitor HTTP dan IP dengan notifikasi up/down
- Auto-fix untuk beberapa kasus masalah umum
- Laporan otomatis pagi & malam berbasis AI (Groq)
- Reminder dan notes (tag, pencarian)
- Uptime history dan grafik downtime
- Web dashboard dengan Live2D, chat AI, quick action, command
- Command chat (WEB CHAT): /ping /ssh /docker /proxmox /laporan /help

---

## 📁 Struktur Folder

```
/opt/shorekeeper/
├── src/
│   ├── app/                  # Entry point (index.ts)
│   ├── config/               # persona.ts, mood.ts, timezone.ts
│   ├── database/             # connection.ts, queries.ts
│   ├── handlers/             # mainHandler + modules
│   ├── jobs/                 # monitor, reporter, reminder, etc.
│   ├── services/             # ai, docker, proxmox, ssh, uptimeHistory
│   └── web/                  # webServer.ts, apiRoutes.ts, wsHandler.ts, authMiddleware.ts
├── public/                   # web client static (index.html, app.js, style.css, model/)
├── logs/                     # PM2 logs
├── .env                      # Konfigurasi
├── .env.example              # Template konfigurasi
├── ecosystem.config.js       # PM2 setup
├── package.json
└── tsconfig.json
```

---

## ⚙️ Requirements

- Node.js 18.x LTS atau lebih baru
- PM2 global (`npm install -g pm2`)
- MariaDB 10.6+ / MySQL 8+
- TypeScript 5.x (dev dependency)

---

## 🚀 Instalasi & Jalankan (Step-by-step)

1. Clone repo
```bash
git clone https://github.com/nz404/shorekeeper.git /opt/shorekeeper
cd /opt/shorekeeper
```

2. Install dependensi
```bash
npm install
```

3. Copy dan edit `.env`
```bash
cp .env.example .env
# Atur nilai di .env sesuai environment Anda
```

4. Buat database
```sql
CREATE DATABASE shorekeeper_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'shorekeeper'@'localhost' IDENTIFIED BY 'password_kuat';
GRANT ALL PRIVILEGES ON shorekeeper_db.* TO 'shorekeeper'@'localhost';
FLUSH PRIVILEGES;
```

5. Build TypeScript
```bash
npm run build
```

6. Jalankan PM2
```bash
mkdir -p /opt/shorekeeper/logs
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

7. Cek status
```bash
pm2 status
pm2 logs shorekeeper
```

---

## 🔧 Konfigurasi .env (Contoh)

- TELEGRAM_TOKEN
- MY_CHAT_ID
- ADMIN_NAME
- GROQ_API_KEY
- GROQ_MODEL
- DB_HOST
- DB_USER
- DB_PASSWORD
- DB_NAME
- WEB_PORT, WEB_ADMIN_USER, WEB_PASSWORD, WEB_GUEST_USER, WEB_GUEST_PASSWORD
- TIMEZONE, MONITOR_CPU_THRESHOLD, MONITOR_RAM_THRESHOLD, MONITOR_DISK_THRESHOLD
- MONITOR_INTERVAL_MS, SSH_SESSION_TIMEOUT_MS, SSH_CMD_TIMEOUT_MS, SSH_LONG_TIMEOUT_MS

## 🗄️ Konfigurasi Proxmox

Di versi ini, setup Proxmox sudah ada di menu Telegram dan web dashboard.

1. Buka Telegram bot Shorekeeper, kirim `/start`.
2. Pilih menu `Proxmox` lalu ikuti langkah konfigurasinya (host, port, user, token/API key).
3. Atau buka web dashboard, login sebagai admin, dan pilih Proxmox di menu.
4. Restart Shorekeeper hanya jika ada setting yang mengharuskan reload layanan.

---

## 📌 PM2 Quick Commands

- `pm2 start ecosystem.config.js`
- `pm2 stop shorekeeper`
- `pm2 restart shorekeeper`
- `pm2 reload shorekeeper`
- `pm2 logs shorekeeper`
- `pm2 monit`

---

## 💬 Contoh Command Telegram

- `/help`
- `/ping`
- `/proxmox`
- `/ssh`
- `/ssh [alias] [cmd]`
- `/docker [alias]`
- `/laporan`
