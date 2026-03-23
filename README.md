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

Shorekeeper (SK) adalah AI asisten infrastruktur pribadi yang berjalan sebagai **Telegram bot** sekaligus **web dashboard**. SK memantau, menganalisis, dan membantu mengelola server secara real-time — semuanya dengan kepribadian karakter Shorekeeper dari game Wuthering Waves tetapi dapat di custom juga.

### ✨ Fitur Utama

| Kategori | Fitur |
|---|---|
| 🖥️ **Monitoring** | CPU, RAM, Disk via SSH dengan alert otomatis |
| 🏝️ **Proxmox** | Monitor VM/LXC — status, start, stop, reboot |
| 🐳 **Docker** | List, start, stop, restart container, lihat log |
| 📡 **Ping Monitor** | HTTP & IP/port dengan notifikasi down/up |
| 🔧 **Auto-Fix** | Deteksi masalah dan tawarkan perbaikan otomatis |
| 📋 **Laporan** | Laporan harian pagi & malam via AI (Groq) |
| ⏰ **Reminder** | Pengingat dengan pengulangan harian/mingguan |
| 📒 **Catatan** | Notes dengan tag dan pencarian |
| 📊 **Uptime History** | Tracking dan visualisasi riwayat downtime |
| 🌐 **Web Dashboard** | Live2D SK, chat AI, quick action, command |
| 💬 **Command Chat** | `/ping` `/ssh` `/docker` `/proxmox` `/laporan` |
| 🔒 **Keamanan** | Brute force protection, rate limiting per IP |

---

## 📁 Struktur Folder

```
/opt/shorekeeper/
├── src/
│   ├── app/                  # Entry point (index.ts)
│   ├── config/               # persona.ts, mood.ts, timezone.ts
│   ├── database/             # connection.ts, queries.ts
│   ├── handlers/
│   │   ├── mainHandler.ts    # Router semua command Telegram
│   │   └── modules/          # ai, ssh, proxmox, docker, ping, reminder, dll
│   ├── jobs/                 # monitor, reporter, reminder, pingMonitor, logAggregator
│   ├── services/             # ssh.service, proxmox.service, docker, autoFix, uptimeHistory
│   └── web/                  # webServer.ts, apiRoutes.ts, wsHandler.ts, authMiddleware.ts
├── public/                   # index.html, app.js, style.css, model/
├── logs/                     # PM2 log output (auto-created)
├── .env                      # Konfigurasi
├── .env.example              # Template konfigurasi
├── ecosystem.config.js       # Konfigurasi PM2
├── package.json
└── tsconfig.json
```

---

## ⚙️ Requirements

- **Node.js** 18.x LTS atau lebih baru
- **PM2** (global) — `npm install -g pm2`
- **MariaDB** 10.6+ / MySQL 8+
- **TypeScript** 5.x (dev dependency)

---

## 🚀 Deploy

### 1. Clone & Install

```bash
git clone <repo_url> /opt/shorekeeper
cd /opt/shorekeeper
npm install
```

### 2. Konfigurasi .env

```bash
cp .env.example .env
nano .env
```

### 3. Setup Database

```sql
-- Login ke MariaDB sebagai root
mysql -u root -p

CREATE DATABASE shorekeeper_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'shorekeeper'@'localhost' IDENTIFIED BY 'password_kuat';
GRANT ALL PRIVILEGES ON shorekeeper_db.* TO 'shorekeeper'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

> Tabel dibuat **otomatis** saat pertama kali SK dijalankan.

### 4. Build TypeScript

```bash
npm run build
# Output di folder dist/
```

### 5. Jalankan dengan PM2

```bash
# Buat folder logs
mkdir -p /opt/shorekeeper/logs

# Start menggunakan ecosystem.config.js
pm2 start ecosystem.config.js

# Simpan config & enable auto-start saat reboot
pm2 save
pm2 startup
```

### 6. Verifikasi

```bash
pm2 status
pm2 logs shorekeeper
```

---

## 🔧 Konfigurasi .env

### Telegram

```env
TELEGRAM_TOKEN=token_dari_botfather
MY_CHAT_ID=id_chat_kamu
ADMIN_NAME=Irvan
```

### AI — Groq

```env
GROQ_API_KEY=gsk_...
GROQ_MODEL=llama-3.3-70b-versatile
```

### Database

```env
DB_HOST=localhost
DB_USER=shorekeeper
DB_PASSWORD=password_kuat
DB_NAME=shorekeeper_db
```

### Proxmox

```env
PVE_HOST=192.168.1.100
PVE_PORT=8006
PVE_USER=root@pam
PVE_TOKEN_SECRET=token_secret_proxmox
```

### Web Dashboard

```env
WEB_PORT=3000
WEB_ADMIN_USER=admin
WEB_PASSWORD=password_kuat_admin

# Akun demo/guest (opsional)
WEB_GUEST_USER=demo
WEB_GUEST_PASSWORD=demo
WEB_GUEST_LIMIT=5
```

### Monitor & SSH

```env
TIMEZONE=Asia/Jakarta
MONITOR_CPU_THRESHOLD=80
MONITOR_RAM_THRESHOLD=85
MONITOR_DISK_THRESHOLD=90
MONITOR_INTERVAL_MS=300000
SSH_SESSION_TIMEOUT_MS=300000
SSH_CMD_TIMEOUT_MS=30000
SSH_LONG_TIMEOUT_MS=600000
```

---

## 🔄 PM2 — ecosystem.config.js

```js
module.exports = {
  apps: [{
    name:          'shorekeeper',
    script:        'npm',
    args:          'run dev',       // Production: ganti ke 'start'
    cwd:           '/opt/shorekeeper',
    watch:         false,
    autorestart:   true,
    max_restarts:  10,
    restart_delay: 3000,
    error_file:    'logs/error.log',
    out_file:      'logs/output.log',
  }]
};
```

> Untuk **production**, tambahkan script di `package.json`:
> ```json
> "build": "tsc",
> "start": "node dist/app/index.js",
> "dev":   "ts-node src/app/index.ts"
> ```
> Lalu ganti `args` menjadi `'start'`.

### Perintah PM2 Umum

```bash
pm2 start ecosystem.config.js   # Start SK
pm2 stop shorekeeper            # Hentikan
pm2 restart shorekeeper         # Restart
pm2 reload shorekeeper          # Reload tanpa downtime
pm2 logs shorekeeper            # Lihat log realtime
pm2 logs shorekeeper --err      # Log error saja
pm2 monit                       # Dashboard CPU/RAM
pm2 install pm2-logrotate       # Cegah log membesar
```

---

## 💬 Command Web Chat

Ketik `/` di input chat saat login sebagai admin untuk menggunakan command langsung:

| Command | Fungsi |
|---|---|
| `/help` | Tampilkan daftar semua command |
| `/ping` | Cek status semua server monitor |
| `/proxmox` | List VM & Container Proxmox |
| `/ssh` | List semua alias SSH |
| `/ssh [alias] [cmd]` | Jalankan command SSH di server |
| `/docker [alias]` | List container Docker di server |
| `/laporan` | Generate laporan infrastruktur sekarang |

**Contoh:**
```
/ssh vps1 df -h
/ssh vps1 systemctl status nginx
/docker vps1
/ping
```

---

## 🔒 Keamanan

### Brute Force Protection
- Maksimal **5 percobaan gagal** dalam 10 menit
- IP dikunci **15 menit** setelah 5 kali gagal
- Pesan error menampilkan sisa percobaan

### Rekomendasi Tambahan

- [ ] Ganti `WEB_PASSWORD` dengan password minimal 8 karakter
- [ ] Pasang Nginx reverse proxy dengan HTTPS
- [ ] Batasi port 3000 hanya dari localhost
- [ ] Aktifkan firewall — buka hanya port yang dibutuhkan
- [ ] Pastikan `.env` tidak bisa diakses dari web

### Contoh Nginx + HTTPS

```nginx
server {
    listen 443 ssl;
    server_name sk.domainmu.com;

    ssl_certificate     /etc/letsencrypt/live/sk.domainmu.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sk.domainmu.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

---

## 🆙 Cara Update

```bash
cd /opt/shorekeeper
git pull
npm install
npm run build
pm2 reload shorekeeper
pm2 logs shorekeeper --lines 30
```

---

## 🛠️ Troubleshooting

| Masalah | Solusi |
|---|---|
| Bot Telegram tidak merespons | Cek `TELEGRAM_TOKEN`. Jalankan `pm2 logs shorekeeper` |
| Error koneksi database | Cek `systemctl status mariadb` dan variabel `DB_*` di `.env` |
| Proxmox tidak terhubung | Cek `PVE_HOST`, `PVE_PORT`, `PVE_TOKEN_SECRET`, dan permission API token |
| Web tidak bisa diakses | Cek `WEB_PORT` dan firewall: `ufw allow 3000` |
| SSH ke server gagal | Verifikasi alias dengan `/ssh` di bot. Cek port dan password |
| PM2 tidak auto-start | Jalankan `pm2 save && pm2 startup`, ikuti instruksi |
| Build TypeScript error | Jalankan `npm run build`, perhatikan pesan error |
| Log terus membesar | Install logrotate: `pm2 install pm2-logrotate` |

---

## 📄 Lisensi

Proyek ini bersifat **Open Source**.

---

<div align="center">

*Shorekeeper — siap bertugas, Kak. 🛡️*

</div>