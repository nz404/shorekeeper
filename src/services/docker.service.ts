import { Client } from 'ssh2';

// SSH HELPER

const sshExec = (
    config: { host: string; port: number; username: string; password: string },
    cmd: string,
    timeout = 30_000
): Promise<string> => {
    return new Promise((resolve, reject) => {
        const conn  = new Client();
        const timer = setTimeout(() => { conn.end(); reject(new Error('SSH timeout')); }, timeout);
        conn.on('ready', () => {
            conn.exec(cmd, (err, stream) => {
                if (err) { clearTimeout(timer); conn.end(); return reject(err); }
                let data = '';
                stream.on('data', (c: any) => { data += c; });
                stream.stderr.on('data', (c: any) => { data += c; });
                stream.on('close', () => { clearTimeout(timer); conn.end(); resolve(data.trim()); });
            });
        })
        .on('error', (e) => { clearTimeout(timer); reject(e); })
        .connect({ ...config, readyTimeout: 10_000 });
    });
};

// INTERFACE

export interface DockerContainer {
    id:      string;
    name:    string;
    image:   string;
    status:  string;
    running: boolean;
    ports:   string;
}

export interface DockerServer {
    alias:      string;
    containers: DockerContainer[];
    error?:     string;
}

// LIST CONTAINERS

export const listContainers = async (server: any): Promise<DockerServer> => {
    try {
        const out = await sshExec(
            { host: server.host, port: server.port, username: server.username, password: server.password },
            'docker ps -a --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}" 2>/dev/null'
        );

        if (!out || out.includes('command not found')) {
            return { alias: server.alias, containers: [], error: 'Docker tidak tersedia di server ini' };
        }

        const containers: DockerContainer[] = out.split('\n')
            .filter(Boolean)
            .map(line => {
                const [id, name, image, status, ports] = line.split('|');
                return {
                    id:      id?.slice(0, 12) || '',
                    name:    name?.replace(/^\//, '') || '',
                    image:   image || '',
                    status:  status || '',
                    running: status?.toLowerCase().startsWith('up') || false,
                    ports:   ports || '',
                };
            });

        return { alias: server.alias, containers };
    } catch (err: any) {
        return { alias: server.alias, containers: [], error: err.message };
    }
};

// KONTROL CONTAINER

export const controlContainer = async (
    server: any,
    containerId: string,
    action: 'start' | 'stop' | 'restart' | 'pause' | 'unpause'
): Promise<string> => {
    try {
        const out = await sshExec(
            { host: server.host, port: server.port, username: server.username, password: server.password },
            `docker ${action} ${containerId} 2>&1`,
            60_000
        );
        return out;
    } catch (err: any) {
        throw new Error(`Gagal ${action} container: ${err.message}`);
    }
};

// LOGS CONTAINER

export const getContainerLogs = async (server: any, containerId: string, lines = 50): Promise<string> => {
    try {
        const out = await sshExec(
            { host: server.host, port: server.port, username: server.username, password: server.password },
            `docker logs --tail ${lines} ${containerId} 2>&1`,
            20_000
        );
        return out || '(tidak ada log)';
    } catch (err: any) {
        throw new Error(`Gagal ambil log: ${err.message}`);
    }
};

// STATS CONTAINER

export const getContainerStats = async (server: any, containerId: string): Promise<string> => {
    try {
        const out = await sshExec(
            { host: server.host, port: server.port, username: server.username, password: server.password },
            `docker stats --no-stream --format "CPU: {{.CPUPerc}} | RAM: {{.MemUsage}} | Net: {{.NetIO}}" ${containerId} 2>&1`,
            15_000
        );
        return out || '(tidak ada stats)';
    } catch (err: any) {
        throw new Error(`Gagal ambil stats: ${err.message}`);
    }
};

export const DockerService = {
    listContainers,
    controlContainer,
    getContainerLogs,
    getContainerStats,
};