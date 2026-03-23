import axios from 'axios';
import * as dotenv from 'dotenv';
import https from 'https';

dotenv.config();

// ─────────────────────────────────────────────
// KONFIGURASI
// ─────────────────────────────────────────────

const agent        = new https.Agent({ rejectUnauthorized: false });
const PVE_HOST     = process.env.PVE_HOST || '127.0.0.1';
const PVE_PORT     = process.env.PVE_PORT || '8006';
const PVE_BASE_URL = `https://${PVE_HOST}:${PVE_PORT}/api2/json`;
const AUTH_HEADER  = `PVEAPIToken=${process.env.PVE_USER!}!shorekeeper=${process.env.PVE_TOKEN_SECRET!}`;

const pveGet  = (path: string) => axios.get(`${PVE_BASE_URL}${path}`,    { headers: { Authorization: AUTH_HEADER }, httpsAgent: agent });
const pvePost = (path: string) => axios.post(`${PVE_BASE_URL}${path}`, {}, { headers: { Authorization: AUTH_HEADER }, httpsAgent: agent });

// ─────────────────────────────────────────────
// STATUS NODE
// ─────────────────────────────────────────────

export const getNodesStatus = async (): Promise<string> => {
    try {
        const { data: { data: nodes } } = await pveGet('/nodes');

        const ADMIN_NAME = process.env.ADMIN_NAME || 'Irvan';
        let report = `📊 Status Cluster Proxmox:\n`;

        for (const node of nodes) {
            const { data: { data: s } } = await pveGet(`/nodes/${node.node}/status`);

            const cpu         = (s.cpu * 100).toFixed(1);
            const memUsed     = (s.memory.used  / 1024 ** 3).toFixed(2);
            const memTotal    = (s.memory.total / 1024 ** 3).toFixed(2);
            const uptimeDay   = (s.uptime / 86400).toFixed(1);
            const statusLabel = node.status === 'online' ? '✅ Online' : '🔴 Offline';

            report += `\n🖥️ Node: ${node.node.toUpperCase()}\n`;
            report += `├ Status: ${statusLabel}\n`;
            report += `├ CPU: ${cpu}%\n`;
            report += `├ RAM: ${memUsed} / ${memTotal} GB\n`;
            report += `└ Uptime: ${uptimeDay} hari\n`;
        }

        report += `\nSemua node terpantau, Kak ${ADMIN_NAME}. 🛡️`;
        return report;

    } catch (err: any) {
        console.error('🚨 PROXMOX ERROR:', err.response?.data || err.message);
        return 'SK tidak dapat terhubung ke Proxmox saat ini. Cek koneksi ke host Proxmox ya.';
    }
};

// ─────────────────────────────────────────────
// LIST SEMUA VM & LXC
// ─────────────────────────────────────────────

export const getResources = async (): Promise<any[]> => {
    try {
        const { data: { data } } = await pveGet('/cluster/resources?type=vm');
        return data;
    } catch {
        return [];
    }
};

// ─────────────────────────────────────────────
// KONTROL VM / LXC
// ─────────────────────────────────────────────

export const controlResource = async (
    vmid: number,
    type: 'qemu' | 'lxc',
    action: string,
    node: string
): Promise<string> => {
    try {
        await pvePost(`/nodes/${node}/${type}/${vmid}/status/${action}`);

        const emoji: Record<string, string> = { start: '▶️', stop: '🛑', reboot: '🔄' };
        return `${emoji[action] ?? '⚡'} Perintah ${action.toUpperCase()} untuk ${type.toUpperCase()} ID ${vmid} berhasil dikirim ke node ${node}.`;

    } catch (err: any) {
        return `Gagal eksekusi: ${err.response?.data?.errors ?? err.message}`;
    }
};