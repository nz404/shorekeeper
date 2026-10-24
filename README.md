<div align="center">

# 🛡️ Shorekeeper

**Asisten AI untuk Infrastruktur Homelab**

*Terinspirasi dari karakter Shorekeeper.*

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![PM2](https://img.shields.io/badge/PM2-Process_Manager-2B037A?style=flat-square)](https://pm2.keymetrics.io)
[![MariaDB](https://img.shields.io/badge/MariaDB-10.6%2B-003545?style=flat-square&logo=mariadb&logoColor=white)](https://mariadb.org)
[![AI](https://img.shields.io/badge/AI-OpenAI--compatible-412991?style=flat-square)](https://platform.openai.com/docs/api-reference)
[![Telegram](https://img.shields.io/badge/Telegram-Bot-26A5E4?style=flat-square&logo=telegram&logoColor=white)](https://core.telegram.org/bots)

<p align="center">
  <img src="./public/model3d/preview.jpg" alt="Ilustrasi Shorekeeper" width="800">
  <br>
  <i>"The silent guardian of your infrastructure, weaving safety within the flow of data."</i>
</p>

### 🖼️ Tampilan Aplikasi

<p align="center">
  <a href="./public/model3d/preview2.png">
    <img src="./public/model3d/preview2.png" alt="Dashboard web Shorekeeper" width="800">
  </a>
</p>
<p align="center"><i>Dashboard web dengan model 3D, menu cepat, dan chat AI.</i></p>

<p align="center">
  <a href="./public/model3d/preview3.png">
    <img src="./public/model3d/preview3.png" alt="Menu utama bot Telegram Shorekeeper" width="800">
  </a>
</p>
<p align="center"><i>Menu utama untuk mengakses fitur bot Telegram.</i></p>

<p align="center">
  <a href="./public/model3d/preview4.png">
    <img src="./public/model3d/preview4.png" alt="Contoh laporan bot Telegram Shorekeeper" width="800">
  </a>
</p>
<p align="center"><i>Contoh laporan infrastruktur yang dikirim melalui bot Telegram.</i></p>

</div>

---

## 📖 Tentang Shorekeeper

Shorekeeper (SK) adalah asisten AI untuk infrastruktur pribadi yang berjalan sebagai **bot Telegram** dan **dashboard web**. SK membantu memantau, menganalisis, dan mengelola server.

Persona SK bersifat tenang dan empatik, dengan fokus pada keandalan sistem. Balasan teks tidak menggunakan emoji; model 3D pada dashboard bereaksi sesuai konteks.

Dashboard menggunakan model PMX 3D dan Three.js. Model memiliki ketentuan penggunaan dari pembuatnya; jangan menjual atau mendistribusikan ulang model maupun teksturnya.

### ✨ Fitur Utama

- Memantau CPU, RAM, disk, ping, dan uptime dengan notifikasi otomatis
- Mengelola server SSH, VM/LXC Proxmox, dan container Docker
- Menjalankan auto-fix untuk beberapa masalah umum
- Membuat laporan infrastruktur dengan AI
- Menyediakan reminder, catatan bertag, dan pencarian
- Menyediakan dashboard web dengan model 3D, chat AI, dan aksi cepat
- Mendukung command chat seperti `/ping`, `/ssh`, `/docker`, `/proxmox`, dan `/laporan`

---

## ⚙️ Persyaratan

- Node.js 18.x LTS atau lebih baru
- MariaDB 10.6+ / MySQL 8+
- Git
- Debian 12 (panduan ini ditujukan untuk instalasi baru)

> Perintah di bawah mengasumsikan akses root. Jika menggunakan akun biasa, tambahkan `sudo` pada perintah administrasi sistem.

---

## 🚀 Instalasi di Debian 12

### 1. Perbarui sistem dan pasang dependensi

Jalankan sebagai root:

```bash
# Keterangan: Perbarui daftar paket dan pasang pembaruan Debian.
apt update
apt upgrade -y

# Keterangan: Pasang Node.js, npm, Git, MariaDB, dan library build canvas.
apt install -y nodejs npm git mariadb-server build-essential python3 pkg-config \
  libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev

# Keterangan: Pasang PM2 secara global agar dapat digunakan oleh akun aplikasi.
npm install -g pm2

# Keterangan: Pastikan Node.js memenuhi persyaratan minimal versi 18.
node --version
npm --version
```

### 2. Buat database

Pastikan MariaDB aktif, lalu buka konsolnya sebagai root:

```bash
# Keterangan: Aktifkan MariaDB saat boot dan jalankan sekarang.
systemctl enable --now mariadb
# Keterangan: Buka konsol MariaDB sebagai administrator lokal.
mariadb
```

Jalankan SQL berikut di konsol MariaDB. Ganti password contoh dengan password kuat dan catat nilainya untuk konfigurasi `.env`:

```sql
-- Keterangan: Buat database dengan encoding Unicode.
CREATE DATABASE shorekeeper_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- Keterangan: Buat user database khusus aplikasi.
CREATE USER 'shorekeeper'@'localhost' IDENTIFIED BY 'GANTI_DENGAN_PASSWORD_KUAT';
-- Keterangan: Berikan akses user aplikasi ke database.
GRANT ALL PRIVILEGES ON shorekeeper_db.* TO 'shorekeeper'@'localhost';
-- Keterangan: Terapkan hak akses dan keluar dari konsol.
FLUSH PRIVILEGES;
EXIT;
```

Konfigurasi ini memakai database di mesin yang sama. Jika database berada di server terpisah, sesuaikan `DB_HOST`, `DB_PORT`, hak akses user, dan aturan firewall MariaDB.

### 3. Buat akun aplikasi dan unduh source

Jalankan sebagai root untuk membuat akun Linux khusus dan direktori aplikasi:

```bash
# Keterangan: Buat akun sistem untuk menjalankan Shorekeeper.
useradd --create-home --home-dir /home/shorekeeper --shell /bin/bash shorekeeper
# Keterangan: Buat direktori aplikasi dan serahkan kepemilikannya ke akun tersebut.
install -d -o shorekeeper -g shorekeeper /opt/shorekeeper
```

Beralih ke akun `shorekeeper`, lalu unduh source dan pasang dependensi:

```bash
# Keterangan: Beralih ke akun aplikasi.
su - shorekeeper
# Keterangan: Unduh repository ke direktori instalasi.
git clone https://github.com/nz404/shorekeeper.git /opt/shorekeeper
# Keterangan: Masuk ke direktori aplikasi.
cd /opt/shorekeeper
# Keterangan: Instal dependensi sesuai package-lock.json.
npm ci
```

Jalankan `npm ci` langsung di server Debian. Jangan menyalin `node_modules` atau `dist` dari sistem operasi lain karena paket native seperti `canvas` harus sesuai dengan sistem operasi, arsitektur, dan versi Node.js server.

### 4. Buat dan isi file `.env`

Tetap sebagai akun `shorekeeper`:

```bash
# Keterangan: Salin template konfigurasi.
cp .env.example .env
# Keterangan: Edit konfigurasi aplikasi.
nano .env
```

Isi setidaknya nilai berikut. Gunakan token Telegram dari BotFather, ID pengguna Telegram admin, password database yang dibuat pada langkah 2, dan password dashboard unik minimal 8 karakter:

```env
TELEGRAM_TOKEN=token_dari_botfather
MY_CHAT_ID=telegram_user_id_admin
DB_HOST=localhost
DB_PORT=3306
DB_USER=shorekeeper
DB_PASSWORD=password_database
DB_NAME=shorekeeper_db
WEB_ADMIN_USER=nama_login_admin
WEB_PASSWORD=password_dashboard_minimal_8_karakter
TIMEZONE=Asia/Jakarta
```

Simpan file, lalu batasi aksesnya:

```bash
# Keterangan: Batasi akses file konfigurasi ke akun pemilik.
chmod 600 .env
```

Provider AI dapat dikonfigurasi setelah bot berjalan melalui `/start` → **🤖 Provider AI**. Jika ingin mengaturnya lewat file, isi `AI_PROVIDER`, `AI_API_KEY`, dan `AI_MODEL` di `.env`. Tambahkan `TELEGRAM_ADMIN_USER_IDS` jika ada admin Telegram tambahan.

### 5. Build dan jalankan dengan PM2

Jalankan sebagai akun `shorekeeper` dari `/opt/shorekeeper`:

```bash
# Keterangan: Siapkan direktori log PM2.
mkdir -p logs
# Keterangan: Kompilasi TypeScript ke direktori dist.
npm run build
# Keterangan: Jalankan Shorekeeper menggunakan konfigurasi repository.
pm2 start ecosystem.config.js
# Keterangan: Simpan daftar proses untuk pemulihan setelah server restart.
pm2 save
```

### 6. Aktifkan startup PM2

Masih sebagai akun `shorekeeper`, jalankan:

```bash
# Keterangan: Buat instruksi startup systemd untuk PM2.
pm2 startup
```

Jalankan perintah `sudo ...` yang ditampilkan PM2 sebagai root. Setelah selesai, kembali ke akun `shorekeeper` dan simpan daftar proses:

```bash
# Keterangan: Simpan daftar proses PM2 milik akun aplikasi.
pm2 save
```

### 7. Verifikasi instalasi

Jalankan sebagai akun `shorekeeper`:

```bash
# Keterangan: Pastikan proses Shorekeeper berjalan.
pm2 status
# Keterangan: Periksa log startup dan error terbaru.
pm2 logs shorekeeper --lines 100
```

Dashboard memakai port `3000` secara default. Untuk akses dari internet, gunakan HTTPS melalui reverse proxy dan batasi akses langsung ke port aplikasi. Atur `WEB_TRUST_PROXY` hanya ke IP atau CIDR proxy tepercaya.

Jika `npm ci` gagal membangun `canvas`, pastikan library pada langkah pertama sudah terpasang, lalu ulangi `npm ci`. Jika muncul `canvas.node: invalid ELF header`, instal ulang dependensi dan build langsung di server Debian; jangan gunakan binary dari sistem operasi lain.

---

## Konfigurasi AI

Semua fitur AI menggunakan satu provider yang kompatibel dengan API OpenAI Chat Completions. Admin dapat mengaturnya melalui Telegram: kirim `/start`, pilih **🤖 Provider AI**, lalu masukkan provider, API key, model, dan endpoint. Pilih `default` untuk memakai endpoint bawaan. Konfigurasi tersimpan di database dan langsung digunakan oleh bot serta dashboard.

API key tidak ditampilkan kembali setelah disimpan. Shorekeeper mencoba menghapus pesan berisi key; hapus secara manual jika pesan masih terlihat. Batasi akses ke database karena konfigurasi AI disimpan di sana.

Sebagai alternatif, konfigurasi dapat diisi melalui `.env`:

```env
AI_PROVIDER=groq
AI_API_KEY=api-key-anda
AI_MODEL=model-id
```

Provider dan endpoint bawaan:

| `AI_PROVIDER` | Endpoint bawaan (`AI_BASE_URL` opsional) | API key dan model |
|---|---|---|
| `groq` | `https://api.groq.com/openai/v1` | API key dan model ID dari Groq |
| `openai` | `https://api.openai.com/v1` | API key dan model ID dari OpenAI |
| `openrouter` | `https://openrouter.ai/api/v1` | API key dan model ID dari OpenRouter |
| `gemini` | `https://generativelanguage.googleapis.com/v1beta/openai/` | API key Google AI Studio dan model Gemini |
| `9router` | `http://127.0.0.1:20128/v1` | API key dan model ID dari 9Router |
| `custom` | Isi `AI_BASE_URL` | API key dan model dari endpoint OpenAI-compatible |

Untuk provider custom, isi `AI_BASE_URL` dengan endpoint yang mendukung Chat Completions. Jika 9Router berjalan di mesin lain, ganti alamat `127.0.0.1` dengan alamat yang dapat dijangkau server Shorekeeper. [Dokumentasi kompatibilitas Gemini](https://ai.google.dev/gemini-api/docs/openai).

Nilai konfigurasi AI yang tersimpan di database diprioritaskan daripada nilai yang sama di `.env`. Jangan publikasikan API key atau commit file `.env`.

Atur admin bot di `.env` menggunakan Telegram **user ID**, bukan ID grup:
```env
TELEGRAM_ADMIN_USER_IDS=123456789,987654321
```
`MY_CHAT_ID` juga dianggap sebagai admin. Admin dapat mengelola pengguna melalui menu **👥 Kelola User** di chat pribadi, atau menggunakan `/users add <id>` (tambahkan pengguna), `/users` (lihat daftar), dan `/users remove <id>` (cabut akses). Daftar pengguna disimpan di database. Nilai lama `TELEGRAM_ALLOWED_USER_IDS` akan diimpor saat aplikasi pertama kali dijalankan.

Jadwal laporan pagi dan malam dapat diatur dari menu **📈 Laporan**. Waktu mengikuti `TIMEZONE` di `.env`. Tujuan laporan terjadwal dapat diatur melalui submenu **📬 Atur Tujuan Laporan** dan tidak bergantung pada tujuan alert.

Pengguna yang diizinkan dapat memakai bot di chat pribadi maupun grup. Tambahkan bot ke grup untuk menggunakannya di sana. Agar bot dapat membaca pesan teks biasa di grup, nonaktifkan Privacy Mode melalui BotFather. Pengelolaan pengguna hanya tersedia bagi admin melalui chat pribadi.

Tujuan alert dapat ditentukan di `.env` sebagai daftar ID chat yang dipisahkan koma. Gunakan ID pengguna untuk chat pribadi dan ID negatif untuk grup:
```env
TELEGRAM_ALERT_CHAT_IDS=123456789,-1001234567890
```
`MY_CHAT_ID` menjadi tujuan alert secara default. Tujuan dan status alert dapat diubah melalui menu admin **📣 Kelola Alert** atau perintah `/alerts on` (aktifkan), `/alerts off` (nonaktifkan), dan `/alerts status` (lihat status). Pengaturan database mengesampingkan nilai `.env`. Tambahkan bot ke grup penerima; grup baru akan muncul di menu setelah bot menerima pembaruan dari grup tersebut.

---

## 🗄️ Menambahkan Proxmox

Tambahkan cluster Proxmox dari bot Telegram atau dashboard web:

1. Di bot, kirim `/start` untuk membuka menu utama.
2. Pilih **Proxmox**, lalu masukkan host, port, user, dan token/API key.
3. Atau buka dashboard web dan pilih menu Proxmox.

---

## 📌 Perintah PM2

- `pm2 start ecosystem.config.js` — Keterangan: Jalankan Shorekeeper sesuai konfigurasi PM2.
- `pm2 stop shorekeeper` — Keterangan: Hentikan proses Shorekeeper.
- `pm2 restart shorekeeper` — Keterangan: Mulai ulang Shorekeeper.
- `pm2 reload shorekeeper` — Keterangan: Muat ulang proses melalui PM2.
- `pm2 logs shorekeeper` — Keterangan: Tampilkan log Shorekeeper.
- `pm2 monit` — Keterangan: Pantau penggunaan resource proses PM2.

---

## 💬 Contoh Command Web Chat

- `/help` — Keterangan: Tampilkan daftar perintah.
- `/ping` — Keterangan: Periksa status target ping.
- `/proxmox` — Keterangan: Lihat VM dan container Proxmox.
- `/ssh` — Keterangan: Lihat daftar alias SSH.
- `/ssh [alias] [cmd]` — Keterangan: Jalankan perintah pada host SSH terdaftar.
- `/docker [alias]` — Keterangan: Lihat container Docker pada alias tersebut.
- `/laporan` — Keterangan: Buat laporan infrastruktur.

---

<div align="center">
Proyek Shorekeeper — dikembangkan oleh <a href="https://nz404.my.id">Nz404</a>
</div>
