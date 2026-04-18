// bajaclaw-gateway: normalizes inbound messages from configured channel
// adapters into the tasks queue, and routes outbound replies back.
//
// Adapters are kept alive in a process-wide map keyed by `profile:kind`
// so the daemon can call `replyToSource` after a cycle completes.
import { loadConfig } from "../config.js";
import { openDb } from "../db.js";
import { Logger } from "../logger.js";
import type { ChannelConfig } from "../types.js";

type Sender = (chatId: string | number, text: string) => Promise<void>;
type TypingStarter = (chatId: string | number) => () => void;

interface Adapter {
  kind: "telegram" | "discord";
  send: Sender;
  startTyping: TypingStarter;
  stop: () => Promise<void>;
}

const adapters = new Map<string, Adapter>();
// Active typing indicators, keyed by source ("kind:chatId"). Each
// value is the stop function returned by the adapter's startTyping.
const activeTyping = new Map<string, () => void>();

function key(profile: string, kind: "telegram" | "discord"): string {
  return `${profile}:${kind}`;
}

/** Start all configured channel adapters for a profile. Returns once
 *  adapters are wired; they then run in the background for the lifetime
 *  of the process. Idempotent: re-running swaps adapters in place. */
export async function startAllGateways(profile: string): Promise<void> {
  const cfg = loadConfig(profile);
  const log = new Logger(profile);
  log.info("gateway.start", { profile });
  const chans = cfg.channels ?? [];
  for (const c of chans) {
    const k = key(profile, c.kind);
    const existing = adapters.get(k);
    if (existing) {
      try { await existing.stop(); } catch { /* ignore */ }
      adapters.delete(k);
    }
    try {
      if (c.kind === "telegram") {
        const a = await startTelegram(profile, c, log);
        if (a) adapters.set(k, a);
      } else if (c.kind === "discord") {
        const a = await startDiscord(profile, c, log);
        if (a) adapters.set(k, a);
      }
    } catch (e) {
      log.error(`gateway.${c.kind}.err`, { error: (e as Error).message });
    }
  }
}

/** Backwards-compatible entry point: starts adapters, then blocks. */
export async function runGateway(profile: string): Promise<void> {
  await startAllGateways(profile);
  await new Promise(() => {});
}

/** Send an agent reply back to whatever channel originated a task.
 *  `source` is formatted as "telegram:<id>" or "discord:<id>" — the
 *  same string written into tasks.source by the inbound handlers.
 *  Also ends any typing indicator associated with that source. */
export async function replyToSource(profile: string, source: string, text: string): Promise<void> {
  endTyping(source);
  const colon = source.indexOf(":");
  if (colon < 0) return;
  const kind = source.slice(0, colon);
  const id = source.slice(colon + 1);
  if (kind !== "telegram" && kind !== "discord") return;
  const a = adapters.get(key(profile, kind));
  if (!a) return;
  await a.send(id, text);
}

/** Show the platform's "typing…" indicator for the given source. The
 *  adapter internally refreshes on the platform's cadence (Telegram
 *  indicator lasts ~5s, Discord ~10s) until `endTyping(source)` is
 *  called. Safe to call multiple times — a second call replaces the
 *  first. No-ops if the adapter isn't loaded. */
export function beginTyping(profile: string, source: string): void {
  const colon = source.indexOf(":");
  if (colon < 0) return;
  const kind = source.slice(0, colon) as "telegram" | "discord";
  const id = source.slice(colon + 1);
  if (kind !== "telegram" && kind !== "discord") return;
  const a = adapters.get(key(profile, kind));
  if (!a) return;
  const existing = activeTyping.get(source);
  if (existing) existing();
  try {
    const stop = a.startTyping(id);
    activeTyping.set(source, stop);
  } catch { /* ignore — typing is best-effort */ }
}

export function endTyping(source: string): void {
  const stop = activeTyping.get(source);
  if (!stop) return;
  activeTyping.delete(source);
  try { stop(); } catch { /* ignore */ }
}

async function startTelegram(profile: string, c: ChannelConfig, log: Logger): Promise<Adapter | undefined> {
  let TelegramBot: typeof import("node-telegram-bot-api") | undefined;
  try { TelegramBot = (await import("node-telegram-bot-api")).default; }
  catch { log.warn("gateway.telegram.missing-dep"); return undefined; }

  const bot = new TelegramBot(c.token, { polling: true });
  bot.on("polling_error", (err: Error) => log.error("gateway.telegram.poll-err", { error: err.message }));
  bot.on("message", (msg) => {
    const sender = msg.from?.id;
    const chatId = msg.chat.id;
    if (c.allowlist && c.allowlist.length > 0 && sender !== undefined) {
      const hit = c.allowlist.some((v) => Number(v) === sender);
      if (!hit) return;
    }
    const body = msg.text ?? "";
    if (!body) return;
    const db = openDb(profile);
    try {
      db.prepare("INSERT INTO tasks(created_at, priority, status, body, source) VALUES(?,?,?,?,?)").run(
        new Date().toISOString(), "normal", "pending", body, `telegram:${chatId}`,
      );
    } finally { db.close(); }
    log.info("gateway.telegram.msg", { from: sender, chat: chatId, len: body.length });
    // Kick off the "typing…" indicator immediately so the user knows
    // the message was received. Stays on until replyToSource fires.
    beginTyping(profile, `telegram:${chatId}`);
  });
  log.info("gateway.telegram.ready");

  return {
    kind: "telegram",
    send: async (chatId, text) => {
      await bot.sendMessage(Number(chatId), text);
    },
    startTyping: (chatId) => {
      // Telegram's typing indicator auto-clears after 5s, so re-send
      // every 4s until stopped. `sendChatAction` errors are swallowed
      // — they'd be noise (bot blocked, etc.) and the agent still has
      // a reply path via the eventual send.
      const send = (): void => {
        bot.sendChatAction(Number(chatId), "typing").catch(() => undefined);
      };
      send();
      const timer = setInterval(send, 4000);
      return () => clearInterval(timer);
    },
    stop: async () => { try { await bot.stopPolling(); } catch { /* ignore */ } },
  };
}

async function startDiscord(profile: string, c: ChannelConfig, log: Logger): Promise<Adapter | undefined> {
  let discord: typeof import("discord.js") | undefined;
  try { discord = await import("discord.js"); }
  catch { log.warn("gateway.discord.missing-dep"); return undefined; }

  const { Client, GatewayIntentBits } = discord;
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
  });
  client.on("messageCreate", (msg) => {
    if (msg.author.bot) return;
    if (c.channelId && msg.channelId !== c.channelId) return;
    if (c.allowlist && c.allowlist.length > 0 && !c.allowlist.some((v) => String(v) === msg.author.id)) return;
    const db = openDb(profile);
    try {
      db.prepare("INSERT INTO tasks(created_at, priority, status, body, source) VALUES(?,?,?,?,?)").run(
        new Date().toISOString(), "normal", "pending", msg.content, `discord:${msg.channelId}`,
      );
    } finally { db.close(); }
    log.info("gateway.discord.msg", { from: msg.author.id, len: msg.content.length });
    beginTyping(profile, `discord:${msg.channelId}`);
  });
  client.once("ready", () => log.info("gateway.discord.ready"));
  await client.login(c.token);

  return {
    kind: "discord",
    send: async (channelId, text) => {
      const ch = await client.channels.fetch(String(channelId));
      if (ch && "send" in ch && typeof (ch as { send?: unknown }).send === "function") {
        await (ch as { send: (t: string) => Promise<unknown> }).send(text);
      }
    },
    startTyping: (channelId) => {
      // Discord's typing indicator auto-clears after ~10s or on send.
      // Re-trigger every 8s. `sendTyping` is channel-bound; the fetch
      // is cached inside discord.js, so the per-tick cost is cheap.
      let stopped = false;
      const tick = async (): Promise<void> => {
        if (stopped) return;
        try {
          const ch = await client.channels.fetch(String(channelId));
          if (ch && "sendTyping" in ch && typeof (ch as { sendTyping?: unknown }).sendTyping === "function") {
            await (ch as { sendTyping: () => Promise<void> }).sendTyping();
          }
        } catch { /* ignore */ }
      };
      tick();
      const timer = setInterval(tick, 8000);
      return () => { stopped = true; clearInterval(timer); };
    },
    stop: async () => { try { await client.destroy(); } catch { /* ignore */ } },
  };
}
