import { Telegraf } from 'telegraf';
import { getMikrotikDevices, updateMikrotikStatus, saveMikrotikHistory } from '../database/queries';
import { sendAlertToSubscribers } from '../services/alert.service';
import * as dotenv from 'dotenv';
dotenv.config();

const cron = require('node-cron');
// Ganti baris import { RouterOSAPI } ...
const RouterOSAPI = require('mikrotik-node').RouterOSAPI;

export const initMikrotikJob = (bot: Telegraf, chatId: string) => {
    // Jalankan setiap 2 menit agar balance antara update & beban CPU
    cron.schedule('*/2 * * * *', async () => {
        try {
            const devices = await getMikrotikDevices();
            if (!devices || devices.length === 0) return;

            for (const dev of devices) {
                // @ts-ignore
                const mikrotik = require('mikrotik-node');
                const conn = new mikrotik.RouterOSAPI({
                    host: dev.host,
                    user: dev.username,
                    password: dev.password,
                    port: parseInt(process.env.MT_API_PORT || '8728'),
                    timeout: parseInt(process.env.MT_API_TIMEOUT || '10000')
                });

                try {
                    await conn.connect();

                    // 1. Ambil Resource (CPU & Uptime)
                    const resource: any = await conn.write('/system/resource/print');
                    const cpu = parseInt(resource[0]['cpu-load']) || 0;
                    const uptime = resource[0]['uptime'] || '-';

                    // 2. Ambil Traffic (Otomatis cari interface 'ether1' atau 'bridge')
                    const traffic: any = await conn.write('/interface/monitor-traffic', [
                        '=interface=all', 
                        '=once='
                    ]);
                    
                    // Ambil data pertama yang ditemukan
                    const stats = traffic[0] || {};
                    const rxBits = parseInt(stats['rx-bits-per-second']) || 0;
                    const txBits = parseInt(stats['tx-bits-per-second']) || 0;

                    // Konversi ke Mbps untuk Grafik (Angka murni)
                    const rxMbps = parseFloat((rxBits / 1000000).toFixed(2));
                    const txMbps = parseFloat((txBits / 1000000).toFixed(2));

                    // 3. Update Status Utama & Simpan History Grafik
                    await updateMikrotikStatus(dev.id, cpu, uptime, 'up', `${rxMbps}Mbps`, `${txMbps}Mbps`);
                    await saveMikrotikHistory(dev.id, rxMbps, txMbps, cpu);

                    // 4. Alert jika CPU bahaya
                    if (cpu > 90) {
                        await sendAlertToSubscribers(bot, `⚠️ High CPU Alert: ${dev.alias}\nLoad: ${cpu}% | Up: ${uptime}`);
                    }

                    await conn.close();
                } catch (err) {
                    console.error(`[API Error ${dev.alias}]`, err);
                    await updateMikrotikStatus(dev.id, 0, '-', 'down', '0bps', '0bps');
                }
            }
        } catch (e) {
            console.error('[Cron Job Error]', e);
        }
    });
};