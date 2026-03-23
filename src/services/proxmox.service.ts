import axios from 'axios';
import https from 'https';
import { db } from '../database/connection';

// ─────────────────────────────────────────────
// INTERFACE
// ─────────────────────────────────────────────

export interface PVECluster {
    id:     number;
    name:   string;
    host:   string;
    port:   number;
    user:   string;
    token_id: string;
    secret: string;
    token_secret?: string;
}

export interface PVEResource {
    vmid:        number;
    name:        string;
    type:        string;
    status:      string;
    node:        string;
    clusterId:   number;
    clusterName: string;
}

// ─────────────────────────────────────────────
// DB QUERIES — CRUD cluster
// ─────────────────────────────────────────────

export const getAllClusters = async (): Promise<PVECluster[]> => {
    try {
        const [rows]: any = await db.execute(
            'SELECT * FROM proxmox_clusters ORDER BY id ASC'
        );
        return rows as PVECluster[];
    } catch { return []; }
};

export const getClusterById = async (id: number): Promise<PVECluster | null> => {
    try {
        const [rows]: any = await db.execute(
            'SELECT * FROM proxmox_clusters WHERE id = ?', [id]
        );
        return rows[0] || null;
    } catch { return null; }
};

export const addCluster = async (
    name: string, host: string, port: number, user: string, secret: string
): Promise<number | null> => {
    try {
        const [result]: any = await db.execute(
            'INSERT INTO proxmox_clusters (name, host, port, user, token_id, secret, token_secret) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [name, host, port, user, 'shorekeeper', secret, secret]
        );
        return result.insertId;
    } catch (e: any) {
        console.error('addCluster error:', e.message);
        return null;
    }
};

export const updateCluster = async (
    id: number, name: string, host: string,
    port: number, user: string, secret: string
): Promise<boolean> => {
    try {
        await db.execute(
            'UPDATE proxmox_clusters SET name=?, host=?, port=?, user=?, token_id=?, secret=?, token_secret=? WHERE id=?',
            [name, host, port, user, 'shorekeeper', secret, secret, id]
        );
        return true;
    } catch { return false; }
};

export const removeCluster = async (id: number): Promise<boolean> => {
    try {
        const [result]: any = await db.execute(
            'DELETE FROM proxmox_clusters WHERE id = ?', [id]
        );
        return result.affectedRows > 0;
    } catch { return false; }
};

// Test koneksi sebelum simpan
export const testClusterConnection = async (
    cluster: Omit<PVECluster, 'id'>
): Promise<{ ok: boolean; msg: string }> => {
    try {
        const tokenSecret = cluster.token_secret || cluster.secret;
        const a = new https.Agent({ rejectUnauthorized: false });
        const r = await axios.get(
            `https://${cluster.host}:${cluster.port}/api2/json/version`,
            {
                headers:    { Authorization: `PVEAPIToken=${cluster.user}!${cluster.token_id}=${tokenSecret}` },
                httpsAgent: a,
                timeout:    8_000,
            }
        );
        const ver = r.data?.data?.version || 'unknown';
        return { ok: true, msg: `Proxmox VE ${ver}` };
    } catch (err: any) {
        const msg = err.code === 'ECONNREFUSED'  ? 'Koneksi ditolak — cek host/port'
                  : err.code === 'ETIMEDOUT'     ? 'Timeout — host tidak merespons'
                  : err.response?.status === 401 ? 'Token tidak valid / tidak punya akses'
                  : err.message;
        return { ok: false, msg };
    }
};

// ─────────────────────────────────────────────
// HTTP CLIENT PER CLUSTER
// ─────────────────────────────────────────────

const agent = new https.Agent({ rejectUnauthorized: false });

const pveGet = (c: PVECluster, path: string) =>
    axios.get(`https://${c.host}:${c.port}/api2/json${path}`, {
        headers:    { Authorization: `PVEAPIToken=${c.user}!shorekeeper=${c.secret}` },
        httpsAgent: agent,
        timeout:    10_000,
    });

const pvePost = (c: PVECluster, path: string) =>
    axios.post(`https://${c.host}:${c.port}/api2/json${path}`, {}, {
        headers:    { Authorization: `PVEAPIToken=${c.user}!shorekeeper=${c.secret}` },
        httpsAgent: agent,
        timeout:    10_000,
    });

// ─────────────────────────────────────────────
// STATUS SEMUA NODE — loop semua cluster di DB
// ─────────────────────────────────────────────

export const getNodesStatus = async (): Promise<string> => {
    const clusters = await getAllClusters();
    if (!clusters.length) {
        return '⚠️ Belum ada cluster Proxmox.\nTambahkan via menu *Proxmox → Kelola Cluster*.';
    }

    const ADMIN    = process.env.ADMIN_NAME || 'Irvan';
    const multi    = clusters.length > 1;
    const sections: string[] = [];

    for (const cluster of clusters) {
        try {
            const { data: { data: nodes } } = await pveGet(cluster, '/nodes');
            const label = multi
                ? `📊 Cluster: *${cluster.name}* (${cluster.host})\n`
                : `📊 Status Cluster Proxmox:\n`;

            let report = label;
            for (const node of nodes) {
                const { data: { data: s } } = await pveGet(cluster, `/nodes/${node.node}/status`);
                const cpu    = (s.cpu * 100).toFixed(1);
                const mUsed  = (s.memory.used  / 1024 ** 3).toFixed(2);
                const mTotal = (s.memory.total / 1024 ** 3).toFixed(2);
                const uptime = (s.uptime / 86400).toFixed(1);
                const status = node.status === 'online' ? '✅ Online' : '🔴 Offline';

                report += `\n🖥️ Node: ${node.node.toUpperCase()}\n`;
                report += `├ Status: ${status}\n`;
                report += `├ CPU: ${cpu}%\n`;
                report += `├ RAM: ${mUsed} / ${mTotal} GB\n`;
                report += `└ Uptime: ${uptime} hari\n`;
            }
            sections.push(report);
        } catch (err: any) {
            console.error(`PVE [${cluster.name}]:`, err.message);
            sections.push(`❌ *${cluster.name}* (${cluster.host}): Tidak dapat dihubungi`);
        }
    }

    return sections.join('\n\n') + `\n\nSemua cluster terpantau, Kak ${ADMIN}. 🛡️`;
};

// ─────────────────────────────────────────────
// LIST SEMUA VM & LXC — semua cluster
// ─────────────────────────────────────────────

export const getResources = async (): Promise<PVEResource[]> => {
    const clusters = await getAllClusters();
    const all: PVEResource[] = [];

    for (const cluster of clusters) {
        try {
            const { data: { data } } = await pveGet(cluster, '/cluster/resources?type=vm');
            data.forEach((r: any) => all.push({
                ...r,
                clusterId:   cluster.id,
                clusterName: cluster.name,
            }));
        } catch (err: any) {
            console.error(`PVE [${cluster.name}] getResources:`, err.message);
        }
    }

    return all;
};

// ─────────────────────────────────────────────
// KONTROL VM / LXC
// ─────────────────────────────────────────────

export const controlResource = async (
    vmid:      number,
    type:      'qemu' | 'lxc',
    action:    string,
    node:      string,
    clusterId: number,
): Promise<string> => {
    const cluster = await getClusterById(clusterId);
    if (!cluster) return `❌ Cluster ID ${clusterId} tidak ditemukan di database.`;

    try {
        await pvePost(cluster, `/nodes/${node}/${type}/${vmid}/status/${action}`);
        const emoji: Record<string, string> = { start: '▶️', stop: '🛑', reboot: '🔄' };
        return `${emoji[action] ?? '⚡'} ${action.toUpperCase()} untuk ${type.toUpperCase()} ID ${vmid} berhasil dikirim ke node ${node}.`;
    } catch (err: any) {
        return `❌ Gagal: ${err.response?.data?.errors ?? err.message}`;
    }
};

export const PVEClusterService = {
    getAllClusters,
    getClusterById,
    addCluster,
    updateCluster,
    removeCluster,
    testClusterConnection,
    getNodesStatus,
    getResources,
    controlResource,
};