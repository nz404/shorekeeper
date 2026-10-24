import { Client } from 'ssh2';
import * as fs from 'fs';
import * as path from 'path';

export const handleMikrotikLogs = async (ctx: any, dev: any) => {
    if (!dev) return ctx.reply('❌ Data perangkat tidak valid.');

    const conn = new Client();
    conn.on('ready', () => {
        // Menggunakan shell agar lebih diterima oleh RouterOS
        conn.shell((err, stream) => {
            if (err) return conn.end();
            let data = '';
            stream.on('data', (chunk: any) => { data += chunk; });
            
            // Kirim command dengan enter (\n)
            stream.end('/log print count=20\n/quit\n');

            stream.on('close', () => {
                const cleanLog = data.toString()
                    .replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '') // Hapus kode warna
                    .split('\n')
                    .filter(l => !l.includes('/log print') && !l.includes('/quit'))
                    .join('\n');

                ctx.reply(`📜 *Logs: ${dev.alias}*\n\n\`\`\`\n${cleanLog.trim() || 'Tidak ada log.'}\n\`\`\``, { 
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '⬅️ Kembali', callback_data: `stat_mt_${dev.id}` }]] }
                });
                conn.end();
            });
        });
    }).on('error', (err) => {
        ctx.reply(`❌ Koneksi Gagal: ${err.message}`);
    }).connect({ host: dev.host, port: dev.port, username: dev.username, password: dev.password });
};

export const handleMikrotikBackup = async (ctx: any, dev: any) => {
    const conn = new Client();
    const fileName = `backup_shorekeeper.rsc`;
    const localPath = path.join(__dirname, '../../../temp', `backup_${dev.id}.rsc`);

    if (!fs.existsSync(path.join(__dirname, '../../../temp'))) {
        fs.mkdirSync(path.join(__dirname, '../../../temp'), { recursive: true });
    }

    conn.on('ready', () => {
        conn.shell((err, stream) => {
            if (err) return conn.end();

            // Jalankan perintah export dan langsung quit
            // Pakai delay di dalam MikroTik agar file benar-benar tertulis
            stream.end(`/export file=${fileName}; :delay 2s; /quit\n`);

            stream.on('close', () => {
                // Tunggu 5 detik di sisi Node.js sebelum ambil via SFTP
                setTimeout(() => {
                    conn.sftp((err, sftp) => {
                        if (err) {
                            console.error("SFTP Error:", err);
                            return conn.end();
                        }
                        
                        sftp.fastGet(fileName, localPath, {}, async (errGet) => {
                            if (!errGet) {
                                await ctx.replyWithDocument({ source: localPath, filename: `${dev.alias}_config.rsc` }, {
                                    caption: `✅ **Backup Berhasil: ${dev.alias}**`
                                });
                                if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
                            } else {
                                console.error("SFTP Get Error:", errGet);
                                ctx.reply(`❌ File tidak ditemukan di Router. Pastikan user punya akses 'ftp'.`);
                            }
                            
                            // Hapus file di router agar tidak menumpuk
                            conn.exec(`/file remove ${fileName}\n`, () => conn.end());
                        });
                    });
                }, 5000);
            });
        });
    }).on('error', (err) => {
        ctx.reply(`❌ Koneksi SSH Gagal: ${err.message}`);
    }).connect({ 
        host: dev.host, 
        port: dev.port || 22, 
        username: dev.username, 
        password: dev.password,
        readyTimeout: 15000 
    });
};