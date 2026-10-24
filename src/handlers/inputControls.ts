/** Membuat tombol navigasi kembali dan batal untuk alur input Telegram. */
export const inputControls = (backTarget: string, backLabel = 'Kembali') => ({
    inline_keyboard: [[
        { text: `⬅️ ${backLabel}`, callback_data: `cancel_input:${backTarget}` },
        { text: '❌ Batal', callback_data: 'cancel_input:back_to_help' },
    ]],
});
