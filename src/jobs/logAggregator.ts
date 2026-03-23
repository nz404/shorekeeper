import OpenAI from 'openai';
import { SHOREKEEPER_PROMPT } from '../config/persona';
import { sshExecSafe } from '../services/ssh.service';

// ─────────────────────────────────────────────
// GROQ CLIENT
// ─────────────────────────────────────────────

const openai = new OpenAI({
    apiKey:  process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
});

// ─────────────────────────────────────────────
// SUMBER LOG PER SERVER
// ─────────────────────────────────────────────

const LOG_SOURCES = [
    {
        name:    'Syslog',
        command: 'tail -n 50 /var/log/syslog 2>/dev/null | grep -iE "error|warn|fail|crit" | tail -20',
    },
    {
        name:    'Nginx Error',
        command: 'tail -n 30 /var/log/nginx/error.log 2>/dev/null | tail -20',
    },
    {
        name:    'MySQL Error',
        command: 'tail -n 30 /var/log/mysql/error.log 2>/dev/null || tail -n 30 /var/log/mariadb/mariadb.log 2>/dev/null | grep -iE "error|warn" | tail -20',
    },
    {
        name:    'Systemd Journal',
        command: 'journalctl -p err..crit --since "24 hours ago" --no-pager -n 20 2>/dev/null',
    },
    {
        name:    'Docker Logs',
        command: 'docker ps -q 2>/dev/null | head -5 | xargs -I{} docker logs --tail 10 --since 24h {} 2>/dev/null | grep -iE "error|warn|fail" | tail -20',
    },
];

// ─────────────────────────────────────────────
// KUMPULKAN LOG DARI SATU SERVER
// ─────────────────────────────────────────────

export interface ServerLog {
    alias:   string;
    logs:    { name: string; content: string }[];
    error?:  string;
}

export const collectServerLogs = async (server: any): Promise<ServerLog> => {
    const cfg = {
        host:     server.host,
        port:     server.port,
        username: server.username,
        password: server.password,
    };

    const logs: { name: string; content: string }[] = [];

    for (const source of LOG_SOURCES) {
        const content = await sshExecSafe(cfg, source.command, 15_000);
        // Hanya simpan kalau ada isinya
        if (content && content !== '(timeout)' && content !== '(error)' && content.length > 10) {
            logs.push({ name: source.name, content: content.slice(0, 1000) });
        }
    }

    return { alias: server.alias, logs };
};

// ─────────────────────────────────────────────
// ANALISIS LOG DENGAN GROQ
// ─────────────────────────────────────────────

export const analyzeLogsWithAI = async (serverLogs: ServerLog[]): Promise<string> => {
    // Susun raw log dari semua server
    const rawContent = serverLogs.map(s => {
        if (s.error) return `Server ${s.alias}: Tidak dapat dihubungi`;
        if (!s.logs.length) return `Server ${s.alias}: Tidak ada log error/warning ditemukan`;

        const logContent = s.logs
            .map(l => `[${l.name}]\n${l.content}`)
            .join('\n\n');
        return `=== Server: ${s.alias} ===\n${logContent}`;
    }).join('\n\n');

    try {
        const res = await openai.chat.completions.create({
            model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: SHOREKEEPER_PROMPT },
                {
                    role: 'user',
                    content:
`SK telah mengumpulkan log dari semua server yang dimonitor dalam 24 jam terakhir.

Log yang terkumpul:
${rawContent.slice(0, 8000)}

Analisis log di atas dan buat ringkasan untuk Kak Irvan:
1. Server mana yang memiliki masalah serius?
2. Warning yang perlu diperhatikan?
3. Apakah ada pola error yang berulang?
4. Server mana yang bersih tanpa masalah?

Sampaikan dengan gaya SK yang tenang dan informatif.
Gunakan format yang mudah dibaca.
Jangan gunakan karakter Markdown seperti *, _, [, ], (, ).`,
                },
            ],
            max_tokens: 1024,
        });

        return res.choices[0]?.message?.content || 'SK tidak dapat menganalisis log saat ini.';
    } catch {
        return 'SK gagal menghubungi AI untuk analisis log.';
    }
};