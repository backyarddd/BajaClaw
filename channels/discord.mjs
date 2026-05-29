// Discord channel. Uses the Gateway WebSocket (Node's built-in global WebSocket)
// for inbound messages + REST for replies. Zero deps.
// Config: { enabled: true, token: "<bot token>" }.
const GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";
const REST = "https://discord.com/api/v10";
// intents: GUILDS(1<<0) | GUILD_MESSAGES(1<<9) | MESSAGE_CONTENT(1<<15) | DIRECT_MESSAGES(1<<12)
const INTENTS = (1 << 0) | (1 << 9) | (1 << 15) | (1 << 12);

export async function start({ config, onMessage, log }) {
  const token = config.token;
  if (!token) throw new Error("missing discord bot token");

  let ws, heartbeat, seq = null, selfId = null, running = true;

  function connect() {
    ws = new WebSocket(GATEWAY);
    ws.onmessage = async (ev) => {
      const p = JSON.parse(ev.data);
      if (p.s != null) seq = p.s;
      if (p.op === 10) {
        const interval = p.d.heartbeat_interval;
        heartbeat = setInterval(() => ws.send(JSON.stringify({ op: 1, d: seq })), interval);
        ws.send(JSON.stringify({ op: 2, d: { token, intents: INTENTS, properties: { os: "darwin", browser: "bajaclaw", device: "bajaclaw" } } }));
      } else if (p.op === 0) {
        if (p.t === "READY") { selfId = p.d.user.id; log?.(`[discord] connected as ${p.d.user.username}`); }
        if (p.t === "MESSAGE_CREATE") {
          const m = p.d;
          if (!m.content || m.author?.bot || m.author?.id === selfId) return;
          try {
            const reply = await onMessage(m.content, { channel: "discord", channelId: m.channel_id });
            await fetch(`${REST}/channels/${m.channel_id}/messages`, {
              method: "POST",
              headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
              body: JSON.stringify({ content: (reply || "(no reply)").slice(0, 1900) }),
            });
          } catch (e) { log?.(`[discord] handler error: ${e.message}`); }
        }
      }
    };
    ws.onclose = () => { clearInterval(heartbeat); if (running) setTimeout(connect, 2000); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }
  connect();
  return { stop() { running = false; clearInterval(heartbeat); try { ws.close(); } catch {} } };
}
