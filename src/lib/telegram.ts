// Tiny wrapper around the Telegram Bot API's sendMessage. Shared by the
// treasury-alert cron and the welcome-gas airdrop route so both speak the
// same format (Markdown, no link previews) and silently skip when the
// env isn't configured.

export async function sendTelegramMessage(text: string): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return false;

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "Markdown",
          disable_web_page_preview: true,
        }),
      },
    );
    return res.ok;
  } catch (e) {
    console.error("telegram send failed:", e);
    return false;
  }
}
