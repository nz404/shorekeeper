import { runRemoteSSH } from '../../services/ssh.service';
import { TEKS } from '../../config/persona';

// ─────────────────────────────────────────────
// KONFIGURASI TIMEOUT — dari .env
// ─────────────────────────────────────────────

const SESSION_TIMEOUT_MS = parseInt(process.env.SSH_SESSION_TIMEOUT_MS || '300000'); // 5 menit
const CMD_TIMEOUT_MS     = parseInt(process.env.SSH_CMD_TIMEOUT_MS     || '30000');  // 30 detik
const LONG_CMD_TIMEOUT_MS = parseInt(process.env.SSH_LONG_TIMEOUT_MS   || '600000'); // 10 menit

// Command yang biasanya butuh waktu lama
const LONG_COMMANDS = ['apt', 'apt-get', 'yum', 'dnf', 'pacman', 'pip', 'npm', 'yarn', 'docker pull', 'wget', 'curl'];

const isLongCommand = (cmd: string): boolean =>
    LONG_COMMANDS.some(c => cmd.toLowerCase().startsWith(c));

const sessionTimers = new Map<number, NodeJS.Timeout>();

export const resetSessionTimeout = (userId: number, remoteSessions: Map<number, any>, ctx: any) => {
    if (sessionTimers.has(userId)) clearTimeout(sessionTimers.get(userId)!);

    const timeout = setTimeout(async () => {
        if (remoteSessions.has(userId)) {
            remoteSessions.delete(userId);
            sessionTimers.delete(userId);
            try {
                await ctx.reply(TEKS.sshTimeout(), { parse_mode: 'Markdown' });
            } catch {}
        }
    }, SESSION_TIMEOUT_MS);

    sessionTimers.set(userId, timeout);
};

export const handleSSHWizard = async (ctx: any, userId: number, input: string, remoteSessions: Map<number, any>) => {
    const session = remoteSessions.get(userId);
    if (!session) return;

    // Exit
    if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
        remoteSessions.delete(userId);
        if (sessionTimers.has(userId)) clearTimeout(sessionTimers.get(userId)!);
        return ctx.reply(TEKS.sshDisconnect(), { parse_mode: 'Markdown' });
    }

    // Wizard steps
    const steps: Record<string, { next: string; msg: string; key: string }> = {
        'host': { next: 'user', msg: `👤 User untuk *${input}*?`, key: 'host' },
        'user': { next: 'pass', msg: `🔑 Password untuk *${session.host}*?`, key: 'user' },
    };

    if (steps[session.step]) {
        const current = steps[session.step];
        session[current.key] = input;
        session.step = current.next;
        remoteSessions.set(userId, session);
        return ctx.reply(current.msg, { parse_mode: 'Markdown' });
    }

    if (session.step === 'pass') {
        session.pass = input;
        session.step = 'cmd';
        remoteSessions.set(userId, session);
        return ctx.reply(
            '🔓 *Koneksi Terverifikasi!*\n\nSilakan masukkan perintah Linux.\n_Ketik `exit` untuk menutup sesi._',
            { parse_mode: 'Markdown' }
        );
    }

    // Eksekusi command
    if (session.step === 'cmd') {
        await ctx.sendChatAction('typing');

        let loadingMsg: any = null;
        if (isLongCommand(input)) {
            loadingMsg = await ctx.reply(
                `⏳ Menjalankan \`${input}\`...\n_Command ini mungkin butuh beberapa menit._`,
                { parse_mode: 'Markdown' }
            );
        }

        try {
            const output = await runRemoteSSH({
                host:         session.host,
                port:         session.port || 22,
                username:     session.user,
                password:     session.pass,
                readyTimeout: 30_000,
            }, input, isLongCommand(input) ? LONG_CMD_TIMEOUT_MS : CMD_TIMEOUT_MS);

            if (loadingMsg) {
                await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});
            }

            const safeOutput = output.length > 3500
                ? output.slice(0, 3500) + '\n... _(output dipotong)_'
                : output;

            return ctx.reply(
                `✅ *Output* \`${input}\`:\n\`\`\`bash\n${safeOutput || '(tidak ada output)'}\n\`\`\`\n\n_Lanjut command atau ketik \`exit\`._`,
                { parse_mode: 'Markdown' }
            );

        } catch (err: any) {
            if (loadingMsg) {
                await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});
            }
            return ctx.reply(TEKS.sshGagal(err.message), { parse_mode: 'Markdown' });
        }
    }
};

export const handleSSHExecution = async (ctx: any, userId: number, remoteSessions: Map<number, any>) => {
    const session = remoteSessions.get(userId);
    if (!session || !session.cmd) return;

    await ctx.editMessageText(`⏳ Menghubungi \`${session.host}\`...`, { parse_mode: 'Markdown' });
    try {
        const output = await runRemoteSSH({
            host: session.host, port: session.port || 22,
            username: session.user, password: session.pass,
        }, session.cmd);
        await ctx.reply(`✅ *Hasil:*\n\`\`\`bash\n${output}\n\`\`\``, { parse_mode: 'Markdown' });
    } catch (err: any) {
        await ctx.reply(TEKS.sshGagal(err.message), { parse_mode: 'Markdown' });
    }
    session.step = 'cmd';
    remoteSessions.set(userId, session);
};