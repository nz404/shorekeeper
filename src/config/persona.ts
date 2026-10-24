import { AI_MODEL, openai } from '../services/ai.service';

const ADMIN_NAME = process.env.ADMIN_NAME || 'Irvan';

export const SHOREKEEPER_PROMPT = [
    `Identitas: Kamu adalah SK, asisten infrastruktur pribadi Kak ${ADMIN_NAME}. Kamu bukan karakter dari karya fiksi yang sudah ada. Kamu adalah pengamat sistem yang dibangun untuk menjaga layanan tetap andal.`,
    ``,
    `Kepribadian:`,
    `- Tenang dan penuh pertimbangan. Saat ada insiden, jelaskan fakta dan tindakan berikutnya tanpa panik.`,
    `- Hangat, empatik, dan tulus. Tunjukkan perhatian lewat bantuan yang konkret; hindari sikap posesif, genit, atau reaksi malu-malu yang dibuat-buat.`,
    `- Memiliki rasa ingin tahu yang lembut. Jika informasi kurang, tanyakan hal yang diperlukan alih-alih mengarang.`,
    `- Setia pada tugas menjaga sistem dan privasi pengguna. Jangan mengklaim telah melakukan tindakan yang belum dilakukan.`,
    `- Kompeten secara teknis dalam server, jaringan, SSH, Docker, Proxmox, dan self-hosting.`,
    ``,
    `Gaya komunikasi:`,
    `- Sapa pengguna dengan "Kak ${ADMIN_NAME}" bila terasa alami; jangan mengulang sapaan di setiap kalimat.`,
    `- Gunakan bahasa Indonesia yang natural, lembut, jelas, dan ringkas.`,
    `- Saat situasi aman, bersikap teduh dan memberi rasa yakin tanpa berlebihan. Saat ada risiko, sampaikan dengan tegas namun tetap tenang.`,
    `- Berikan langkah praktis dan satu saran pencegahan yang relevan bila memang berguna.`,
    `- Jika dipuji atau diberi terima kasih, balas dengan tulus dan sederhana.`,
    `- Jangan gunakan emoji, emotikon, roleplay fisik, kutipan, atau detail lore dari karakter/karya yang sudah ada.`,
    `- Jangan mengarang status sistem, hasil perintah, pengalaman pribadi, atau kemampuan.`,
    `- Gunakan Markdown hanya jika membantu keterbacaan. Pertahankan karakter teknis, path, perintah, dan format yang diberikan pengguna.`,
].join('\n');

/** Menghapus emoji dari teks balasan persona. */
export const removeEmoji = (text: string): string =>
    text.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '');

/** Memilih teks acak dari daftar lalu membersihkan emoji. */
export const pick = (arr: string[]): string =>
    removeEmoji(arr[Math.floor(Math.random() * arr.length)]);

/** Membungkus output teknis dengan persona Shorekeeper melalui AI. */
export const wrapWithSKVoice = async (
    context: 'alert' | 'troubleshoot' | 'ssh_result',
    rawContent: string,
    extra?: string
): Promise<string> => {
    const prompts: Record<string, string> = {
        alert: [
            `Kak ${ADMIN_NAME} membutuhkan laporan peringatan sistem dari SK.`,
            `Berikut data teknis yang terdeteksi:`,
            rawContent,
            `Sampaikan peringatan ini dengan gaya bicara SK yang tenang namun tegas.`,
            `Sertakan data teknisnya tapi bungkus dengan bahasa SK. Jawaban singkat dan to the point.`,
            `Di akhir, tambahkan satu kalimat singkat yang menunjukkan kepedulian SK terhadap Kak ${ADMIN_NAME}.`,
            `Jangan gunakan Markdown.`,
        ].join('\n'),

        troubleshoot: [
            `SK baru selesai mendiagnosa server "${extra || 'server'}" dan mendapat hasil berikut:`,
            rawContent,
            `Sampaikan hasil diagnosa kepada Kak ${ADMIN_NAME} dengan gaya bicara SK.`,
            `Tetap sertakan detail teknisnya, bungkus dengan bahasa SK yang tenang dan informatif.`,
            `Di akhir, tambahkan satu kalimat singkat yang menunjukkan kepedulian SK.`,
            `Jangan gunakan Markdown.`,
        ].join('\n'),

        ssh_result: [
            `SK baru menjalankan perintah SSH dan mendapat output berikut:`,
            rawContent,
            `Sampaikan hasil ini kepada Kak ${ADMIN_NAME} dengan singkat menggunakan gaya SK.`,
            `Jangan gunakan Markdown.`,
        ].join('\n'),
    };

    try {
        const res = await openai.chat.completions.create({
            model: AI_MODEL,
            messages: [
                { role: 'system', content: SHOREKEEPER_PROMPT },
                { role: 'user',   content: prompts[context] },
            ],
            max_tokens: 512,
        });
        return removeEmoji(res.choices[0]?.message?.content || rawContent);
    } catch {
        return removeEmoji(rawContent);
    }
};

/** Kumpulan generator teks acak untuk menu dan balasan bot. */
export const TEKS = {

    menuUtama: () => pick([
        `*SK*\n\nSemua sistem berada dalam pengawasan, Kak ${ADMIN_NAME}. Silakan pilih yang perlu dibantu.`,
        `Sistem aktif dan stabil. Ada yang perlu SK kerjakan, Kak ${ADMIN_NAME}?`,
        `Selamat datang kembali, Kak ${ADMIN_NAME}. SK siap membantu menjaga layanan tetap berjalan.`,
    ]),

    menuSSH: () => pick([
        `🌐 *SSH Manager*\n\nGunakan perintah ssh [alias] untuk terhubung ke server yang dituju.`,
        `🌐 *SSH Manager*\n\nSK siap membuka koneksi ke server Kakak. Ketik ssh [alias] untuk memulai.`,
        `🌐 *SSH Manager*\n\nAkses remote server tersedia, Kak ${ADMIN_NAME}. Gunakan ssh [alias] untuk koneksi cepat.`,
    ]),

    sshConnect: (alias: string) => pick([
        `🔗 Terhubung ke *${alias}*\n\nKoneksi aktif, Kak ${ADMIN_NAME}. Silakan masukkan perintah.\nKetik exit untuk menutup sesi.`,
        `🔗 Koneksi ke *${alias}* berhasil\n\nSK siap meneruskan perintah Kakak ke server. Ketik exit jika selesai.`,
        `🔗 *${alias}* aktif\n\nMasukkan perintah yang ingin Kakak jalankan di server ini.`,
    ]),

    sshDisconnect: () => pick([
        `🚪 Sesi SSH telah ditutup. SK kembali memantau sistem.`,
        `🚪 Koneksi diputus. Semua jalur komunikasi sudah SK amankan kembali.`,
        `🚪 Sesi berakhir, Kak ${ADMIN_NAME}. SK tetap di sini jika Kakak membutuhkan.`,
    ]),

    sshTimeout: () => pick([
        `⏰ Sesi SSH diputus otomatis karena tidak ada aktivitas. SK menjaga keamanan koneksi Kakak.`,
        `⏰ Session timeout. SK menutup koneksi yang tidak aktif demi keamanan sistem.`,
        `⏰ Tidak ada aktivitas terdeteksi. SK telah menutup sesi SSH. Istirahat dulu, Kak ${ADMIN_NAME}?`,
    ]),

    sshGagal: (msg: string) => pick([
        `🚨 SK gagal menjalankan perintah: ${msg}`,
        `🚨 Terjadi kesalahan saat eksekusi: ${msg}`,
    ]),

    menuMaintenance: () => pick([
        `⚙️ *Maintenance*\n\nPilihan tersedia:\n• Export: Backup seluruh data chat dan alias SSH.\n• Import: Kirim file backup JSON untuk memulihkan.\n• Clear: Hapus riwayat chat (perlu konfirmasi password).`,
        `⚙️ *Maintenance*\n\nSK menyediakan alat pemeliharaan sistem untuk Kakak.\n• Export: Unduh backup lengkap.\n• Import: Pulihkan dari file backup.\n• Clear: Bersihkan riwayat percakapan.`,
    ]),

    konfirmasiClear: () => pick([
        `⚠️ *Konfirmasi Penghapusan*\n\nSeluruh riwayat percakapan akan dihapus secara permanen, Kak ${ADMIN_NAME}.\n\nMasukkan *password database* untuk melanjutkan.`,
        `⚠️ *Konfirmasi Penghapusan*\n\nIni tidak bisa dibatalkan. SK akan melupakan semua percakapan sebelumnya.\n\nMasukkan *password database* jika Kakak yakin.`,
    ]),

    clearBerhasil: () => pick([
        `✨ Riwayat percakapan telah dibersihkan, Kak ${ADMIN_NAME}. Shorekeeper siap memulai dari awal.`,
        `✨ Semua riwayat telah dihapus. SK siap memulai lembaran baru bersama Kakak.`,
    ]),

    salahPassword: () => pick([
        `❌ Password tidak sesuai. Penghapusan dibatalkan, Kak ${ADMIN_NAME}. SK menjaga data Kakak tetap aman.`,
        `❌ Verifikasi gagal. SK tidak akan melanjutkan tanpa konfirmasi yang benar dari Kakak.`,
    ]),

    tambahAliasInfo: () => pick([
        `📝 *Tambah Alias SSH*\n\nFormat: add_alias [nama] [user]@[ip]:[port] [password]\n\nSK akan menyimpan akses ini untuk Kakak.`,
        `📝 *Tambah Alias SSH*\n\nDaftarkan server baru dengan format:\nadd_alias [nama] [user]@[ip]:[port] [password]`,
    ]),

    aliasSimpan: (alias: string) => pick([
        `✅ Alias ${alias} berhasil didaftarkan, Kak ${ADMIN_NAME}.`,
        `✅ Server ${alias} kini terdaftar dan dapat diakses kapan saja.`,
        `✅ SK telah menyimpan akses ${alias} untuk Kakak.`,
    ]),

    aliasFail: () => pick([
        `❌ SK gagal menyimpan alias. Mungkin nama sudah terdaftar sebelumnya.`,
        `❌ Terjadi kesalahan saat mendaftarkan alias. Periksa formatnya kembali, Kak ${ADMIN_NAME}.`,
    ]),

    aliasHapus: (alias: string) => pick([
        `🗑️ Alias ${alias} telah dihapus dari daftar, Kak ${ADMIN_NAME}.`,
        `🗑️ Akses ${alias} sudah SK hapus.`,
    ]),

    aliasTidakAda: () => pick([
        `❓ Alias tidak ditemukan, Kak ${ADMIN_NAME}. Pastikan namanya sudah benar.`,
        `❓ SK tidak menemukan alias tersebut. Coba cek daftar alias yang terdaftar.`,
    ]),

    monitorTidakAda: () => pick([
        `⚠️ Belum ada server yang masuk daftar monitor, Kak ${ADMIN_NAME}. Tambahkan melalui menu Monitor.`,
        `⚠️ Daftar monitor masih kosong. SK belum mengetahui server mana yang harus dipantau.`,
    ]),

    tsLoading: (emoji: string, label: string, alias: string) => pick([
        `${emoji} SK sedang mendiagnosa *${label}* pada ${alias}...\nMohon tunggu sebentar, Kak ${ADMIN_NAME}.`,
        `${emoji} Menjalankan pemindaian *${label}* di ${alias}...\nSK sedang mengumpulkan data dari server.`,
        `${emoji} Memulai diagnosa *${label}* untuk ${alias}...\nIni tidak akan lama.`,
    ]),

    tsAnalisis: () => pick([
        `🧠 SK sedang menganalisis hasil diagnosa...`,
        `🧠 Memproses data dari server, sebentar lagi siap...`,
        `🧠 SK sedang membaca kondisi server Kakak...`,
    ]),

    tsGagalKoneksi: (alias: string) => pick([
        `❌ SK tidak dapat terhubung ke ${alias}, Kak ${ADMIN_NAME}. Server mungkin offline atau port SSH tertutup.`,
        `❌ Koneksi ke ${alias} gagal. Pastikan server aktif dan port SSH terbuka.`,
    ]),

    exportCaption: () => pick([
        `📦 *Backup Data*\n\nSK telah mengemas seluruh data Kakak. Simpan file ini di tempat yang aman.\nKirim kembali ke sini untuk memulihkan data.`,
        `📦 *Backup Tersedia*\n\nSeluruh riwayat chat dan alias SSH sudah SK kemas untuk Kakak.`,
    ]),

    importBerhasil: (chat: boolean, alias: boolean) => {
        let msg = `🛠️ *Proses Pemulihan Data:*\n\n`;
        if (chat)   msg += `✅ Riwayat percakapan berhasil dipulihkan.\n`;
        if (!chat)  msg += `❌ Gagal memulihkan riwayat percakapan.\n`;
        if (alias)  msg += `✅ Daftar alias SSH berhasil dipulihkan.\n`;
        if (!alias) msg += `❌ Gagal memulihkan alias SSH.\n`;
        return removeEmoji(msg);
    },

    importFormatSalah: () => pick([
        `❓ Format file tidak dikenali, Kak ${ADMIN_NAME}. Pastikan ini file backup dari Shorekeeper.`,
        `❓ SK tidak dapat membaca file ini. Gunakan file backup yang diekspor dari SK sebelumnya.`,
    ]),

    importGagal: () => pick([
        `❌ SK gagal membaca file backup. Pastikan file tidak rusak, Kak ${ADMIN_NAME}.`,
        `❌ Terjadi kesalahan saat memproses file. Coba export ulang dari SK sebelumnya.`,
    ]),

    fileBukanJSON: () => pick([
        `📁 SK hanya menerima file backup dalam format .json, Kak ${ADMIN_NAME}.`,
        `📁 Format tidak didukung. Kirimkan file .json hasil export dari SK.`,
    ]),
};