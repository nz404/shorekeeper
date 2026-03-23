import { Client } from 'ssh2';

// ─────────────────────────────────────────────
// INTERFACE
// ─────────────────────────────────────────────

export interface SSHConfig {
    host:          string;
    port:          number;
    username:      string;
    password:      string;
    readyTimeout?: number;
}

// ─────────────────────────────────────────────
// runRemoteSSH — throws on error (untuk handler interaktif)
// ─────────────────────────────────────────────

export const runRemoteSSH = (
    config: SSHConfig,
    command: string,
    execTimeout = 30_000
): Promise<string> => {
    return new Promise((resolve, reject) => {
        const conn  = new Client();
        const timer = setTimeout(() => {
            conn.end();
            reject(new Error(`Command timeout setelah ${execTimeout / 1000}s`));
        }, execTimeout);

        conn.on('ready', () => {
            conn.exec(command, (err, stream) => {
                if (err) { clearTimeout(timer); conn.end(); return reject(err); }
                let data = '';
                stream.on('data', (chunk: any) => { data += chunk; });
                stream.stderr.on('data', (chunk: any) => { data += chunk; });
                stream.on('close', () => { clearTimeout(timer); conn.end(); resolve(data.trim()); });
            });
        })
        .on('error', (err) => { clearTimeout(timer); reject(err); })
        .connect({
            host:         config.host,
            port:         config.port,
            username:     config.username,
            password:     config.password,
            readyTimeout: config.readyTimeout || 10_000,
        });
    });
};

// ─────────────────────────────────────────────
// sshExecMulti — jalankan beberapa command berurutan (untuk autoFix)
// Selalu resolve, output dikumpulkan dari semua command.
// ─────────────────────────────────────────────

export const sshExecMulti = (
    config: SSHConfig,
    commands: string[],
    totalTimeout = 60_000
): Promise<string> => {
    return new Promise((resolve) => {
        const conn   = new Client();
        const output: string[] = [];
        const timer  = setTimeout(() => {
            conn.end();
            resolve(output.join('\n') || '(timeout)');
        }, totalTimeout);

        conn.on('ready', async () => {
            for (const cmd of commands) {
                await new Promise<void>((res) => {
                    conn.exec(cmd, (err, stream) => {
                        if (err) { output.push(`[ERROR] ${cmd}: ${err.message}`); return res(); }
                        stream.on('data', (d: any) => output.push(d.toString()));
                        stream.stderr.on('data', (d: any) => output.push(d.toString()));
                        stream.on('close', () => res());
                    });
                });
            }
            clearTimeout(timer);
            conn.end();
            resolve(output.join('\n').trim());
        })
        .on('error', (err) => {
            clearTimeout(timer);
            resolve(`Gagal terhubung ke server: ${err.message}`);
        })
        .connect({
            host:         config.host,
            port:         config.port,
            username:     config.username,
            password:     config.password,
            readyTimeout: config.readyTimeout || 10_000,
        });
    });
};

export const sshExecSafe = (
    config: SSHConfig,
    command: string,
    timeoutMs = 10_000
): Promise<string> => {
    return new Promise((resolve) => {
        const conn  = new Client();
        const timer = setTimeout(() => { conn.end(); resolve('(timeout)'); }, timeoutMs);

        conn.on('ready', () => {
            conn.exec(command, (err, stream) => {
                if (err) { clearTimeout(timer); conn.end(); return resolve('(error)'); }
                let data = '';
                stream.on('data', (c: any) => { data += c; });
                stream.stderr.on('data', (c: any) => { data += c; });
                stream.on('close', () => { clearTimeout(timer); conn.end(); resolve(data.trim()); });
            });
        })
        .on('error', () => { clearTimeout(timer); resolve('(tidak dapat dihubungi)'); })
        .connect({
            host:         config.host,
            port:         config.port,
            username:     config.username,
            password:     config.password,
            readyTimeout: Math.min(timeoutMs - 1_000, 8_000),
        });
    });
};