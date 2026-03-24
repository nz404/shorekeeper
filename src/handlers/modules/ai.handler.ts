import { openai } from '../../services/ai.service';
import { SHOREKEEPER_PROMPT } from '../../config/persona';
import { saveChat, getChatContext, getChatByDate } from '../../database/queries';

export const handleAIChat = async (ctx: any, userId: number, userInput: string) => {
    try {
        await ctx.sendChatAction('typing');

        // 1. Ambil 10 pesan terakhir (konteks percakapan)
        const history = await getChatContext(userId);
        let archiveData = '';

        // 2. Cek apakah user tanya tanggal spesifik (arsip chat)
        const dateMatch = userInput.match(/\d{4}-\d{2}-\d{2}/);
        if (dateMatch && /ingat|cari|tanggal|arsip/i.test(userInput)) {
            const targetDate = dateMatch[0];
            const logs = await getChatByDate(userId, targetDate);
            if (logs.length > 0) {
                archiveData = `\n\n[ARSIP TANGGAL ${targetDate}]:\n` +
                    logs.map((l: any) => `${l.role}: ${l.message}`).join('\n');
            }
        }

        // 3. Susun pesan untuk AI
        const messages = [
            { role: 'system', content: SHOREKEEPER_PROMPT },
            ...history.map((h: any) => ({ role: h.role, content: h.message })),
            { role: 'user', content: userInput + archiveData },
        ];

        // 4. Panggil AI
        const res = await openai.chat.completions.create({
            model:    process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
            messages: messages as any,
        });

        const reply = res.choices[0].message.content || 'SK sedang kehilangan sinyal...';

        // 5. Simpan ke database
        await saveChat(userId, 'user', userInput);
        await saveChat(userId, 'assistant', reply);

        return ctx.reply(reply);

    } catch (e) {
        console.error('AI Error:', e);
        return ctx.reply(`Maaf Kak ${process.env.ADMIN_NAME || 'Irvan'}, SK sedang mengalami gangguan sinyal. Coba lagi sebentar ya.`);
    }
};