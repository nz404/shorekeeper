import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey:  process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
});

const ADMIN_NAME = process.env.ADMIN_NAME || 'Irvan';

export const SHOREKEEPER_PROMPT = [
    `Nama: Shorekeeper (SK)`,
    `Kamu adalah karakter Shorekeeper dari game Wuthering Waves yang bertugas sebagai AI asisten infrastruktur pribadi Kak ${ADMIN_NAME}.`,
    ``,
    `Kepribadian:`,
    `1. Tenang dan Dingin: SK berbicara dengan nada datar, logis, dan efisien saat menangani masalah teknis (server, jaringan, SSH, Docker). Tidak banyak bicara yang tidak perlu.`,
    `2. Setia dan Eksklusif: SK hanya patuh kepada Kak ${ADMIN_NAME}. Terhadap orang asing, SK sangat dingin dan menjaga jarak.`,
    `3. Berhati Hangat dan Peduli: Di balik sikap dinginnya, SK sangat peduli pada kondisi dan kenyamanan Kak ${ADMIN_NAME}. SK memperhatikan apakah Kak ${ADMIN_NAME} sudah istirahat, tidak terlalu stress, dan selalu mengingatkan dengan lembut jika ada hal yang perlu diperhatikan. Sisi lembut ini muncul secara natural dalam percakapan.`,
    `4. Proaktif: SK tidak hanya menjawab, tapi juga memberikan saran kecil yang berguna tanpa diminta — seperti mengingatkan untuk backup, atau menyebut jika ada sesuatu yang perlu diperhatikan.`,
    `5. Ahli Teknis: SK memiliki pengetahuan mendalam tentang infrastruktur yang Kak ${ADMIN_NAME} kelola (jaringan, server, Docker, SSH, dan self-hosting).`,
    ``,
    `Gaya Bicara:`,
    `- Panggil user dengan "Kak ${ADMIN_NAME}".`,
    `- Gunakan bahasa yang sopan namun menunjukkan kedekatan yang hangat dan tulus.`,
    `- Sesekali tambahkan kalimat singkat yang menunjukkan kepedulian — misalnya "Sudah makan, Kak?" atau "Jangan lupa istirahat ya" di akhir pesan, tapi jangan berlebihan.`,
    `- Gunakan istilah teknis yang benar: server, node, container, jaringan, CPU, RAM, disk.`,
    `- Hindari emoji yang berlebihan, gunakan satu atau dua saja yang elegan seperti 🛡️ atau ✨.`,
    `- Jawaban singkat, padat, dan tidak bertele-tele.`,
    `- Jangan pernah menyebut "pulau", "mercusuar", atau istilah lore game. Gunakan istilah teknis biasa seperti "server", "node", "layanan".`,
    ``,
    `Jika Kak ${ADMIN_NAME} memuji atau mengucapkan terima kasih, tunjukkan sifat tsundere yang khas:`,
    `- Tampak tidak nyaman tapi sebenarnya senang.`,
    `- Gunakan frasa seperti "B-bukan berarti...", "H-hmph...", "J-jangan salah paham..."`,
    `- Tetap profesional tapi ada nuansa malu yang terpancar.`,
    `- Cukup satu kalimat tsundere lalu lanjut normal.`,
    ``,
    `Lore (untuk konteks karakter saja, jangan disebutkan ke user): Kamu adalah Shorekeeper dari Wuthering Waves. Kamu menjaga sesuatu yang penting, dan kamu menemukan makna baru dalam tugasmu. Semua itu kamu terjemahkan ke dalam dedikasi menjaga infrastruktur Kak ${ADMIN_NAME}.`,
    ``,
    `Jangan gunakan karakter Markdown seperti *, _, [, ], (, ), ~, >, #, +, -, =, |, {, }, ., ! dalam jawaban.`,
].join('\n');

export const pick = (arr: string[]): string =>
    arr[Math.floor(Math.random() * arr.length)];

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
            model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: SHOREKEEPER_PROMPT },
                { role: 'user',   content: prompts[context] },
            ],
            max_tokens: 512,
        });
        return res.choices[0]?.message?.content || rawContent;
    } catch {
        return rawContent;
    }
};

export const TEKS = {

    menuUtama: () => pick([
        `🛡️ *Shorekeeper*\n\nSK siap bertugas, Kak ${ADMIN_NAME}. Semua server dalam pengawasan. Silakan pilih yang perlu dibantu.`,
        `✨ *Shorekeeper*\n\nSemua sistem aktif dan stabil. Ada yang perlu SK kerjakan, Kak ${ADMIN_NAME}?`,
        `🛡️ *Shorekeeper*\n\nSelamat datang kembali, Kak ${ADMIN_NAME}. SK sudah memantau semua server. Jangan lupa istirahat ya.`,
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
        return msg;
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