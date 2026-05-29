// Telegram channel. Pure HTTP long-polling (getUpdates) + sendMessage.
// Zero deps. Config: { enabled: true, token: "<bot token from @BotFather>" }.
const API = (token, method) => `https://api.telegram.org/bot${token}/${method}`;

export async function start({ config, onMessage, log }) {
  const token = config.token;
  if (!token) throw new Error("missing telegram bot token");

  // Validate the token up front so a bad config fails loudly.
  const me = await fetch(API(token, "getMe")).then((r) => r.json()).catch(() => null);
  if (!me?.ok) throw new Error("invalid telegram token (getMe failed)");
  log?.(`[telegram] connected as @${me.result.username}`);

  let offset = 0;
  let running = true;

  (async function poll() {
    while (running) {
      try {
        const r = await fetch(API(token, "getUpdates") + `?timeout=30&offset=${offset}`, {
          signal: AbortSignal.timeout(40000),
        }).then((x) => x.json());
        if (r?.ok) {
          for (const u of r.result) {
            offset = u.update_id + 1;
            const msg = u.message;
            if (!msg?.text) continue;
            try {
              const reply = await onMessage(msg.text, { channel: "telegram", chatId: msg.chat.id });
              await fetch(API(token, "sendMessage"), {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ chat_id: msg.chat.id, text: reply || "(no reply)" }),
              });
            } catch (e) {
              log?.(`[telegram] handler error: ${e.message}`);
            }
          }
        }
      } catch {
        // network blip / long-poll timeout: brief pause then retry
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  })();

  return { stop() { running = false; }, info: `@${me.result.username}` };
}
