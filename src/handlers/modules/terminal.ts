import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

// Daftar kata terlarang (Blacklist)
const BLACKLIST_COMMANDS = [
    'rm ', 'rmdir', 'mkfs', 'dd', 'format', 
    'shutdown', 'reboot', 'halt', 'poweroff', 
    'del ', 'rd ', 'format' // Tambahan untuk antisipasi command Windows (CMD/PowerShell)
];

export const handleLocalTerminal = async (ctx: any, command: string) => {
    const lowerCmd = command.toLowerCase().trim();

    // 1. FILTER KEAMANAN: Cek apakah mengandung kata terlarang
    const isDangerous = BLACKLIST_COMMANDS.some(forbidden => lowerCmd.includes(forbidden));

    if (isDangerous) {
        return ctx.reply("🚫 **Akses Ditolak!**\nPerintah ini mengandung instruksi berbahaya yang dapat merusak Mercusuar (Host).", { parse_mode: 'Markdown' });
    }

    // 2. FILTER TAMBAHAN: Jangan biarkan input kosong
    if (!command || command.length < 1) {
        return ctx.reply("❓ Masukkan perintah setelah tanda `$`");
    }

    try {
        await ctx.sendChatAction('typing');
        
        // Menjalankan perintah
        const { stdout, stderr } = await execPromise(command);
        
        const output = stdout || stderr || "✅ Command executed (no output).";
        
        // Potong output jika terlalu panjang untuk Telegram
        const safeOutput = output.length > 3500 ? output.slice(0, 3500) + "\n... (output dipotong karena terlalu panjang)" : output;
        
        return ctx.reply(`💻 **Terminal Output:**\n\`\`\`bash\n${safeOutput}\n\`\`\``, { parse_mode: 'Markdown' });

    } catch (e: any) {
        // Jika ada error (perintah tidak dikenal, dll)
        return ctx.reply(`❌ **Terminal Error:**\n\`\`\`text\n${e.message}\n\`\`\``);
    }
};