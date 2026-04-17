// bajaclaw-gateway subprocess: normalizes inbound messages from configured
// channel adapters into the tasks queue. Telegram + Discord. Both optional.
import { loadConfig } from "../config.js";
import { openDb } from "../db.js";
import { Logger } from "../logger.js";
import type { ChannelConfig } from "../types.js";

export async function runGateway(profile: string): Promise<void> {
  const cfg = loadConfig(profile);
  const log = new Logger(profile);
  log.info("gateway.start", { profile });
  const chans = cfg.channels ?? [];
  for (const c of chans) {
    if (c.kind === "telegram") startTelegram(profile, c, log).catch((e) => log.error("gateway.telegram.err", { error: (e as Error).message }));
    if (c.kind === "discord") startDiscord(profile, c, log).catch((e) => log.error("gateway.discord.err", { error: (e as Error).message }));
  }
  // Keep alive
  await new Promise(() => {});
}

async function startTelegram(profile: string, c: ChannelConfig, log: Logger): Promise<void> {
  let TelegramBot: typeof import("node-telegram-bot-api") | undefined;
  try { TelegramBot = (await import("node-telegram-bot-api")).default; }
  catch { log.warn("gateway.telegram.missing-dep"); return; }

  const bot = new TelegramBot(c.token, { polling: true });
  bot.on("message", (msg) => {
    const sender = msg.from?.id;
    if (c.allowlist && c.allowlist.length > 0 && sender && !c.allowlist.includes(sender)) return;
    const body = msg.text ?? "";
    if (!body) return;
    const db = openDb(profile);
    try {
      db.prepare("INSERT INTO tasks(created_at, priority, status, body, source) VALUES(?,?,?,?,?)").run(
        new Date().toISOString(), "normal", "pending", body, `telegram:${sender ?? "?"}`,
      );
    } finally { db.close(); }
    log.info("gateway.telegram.msg", { from: sender, len: body.length });
  });
}

async function startDiscord(profile: string, c: ChannelConfig, log: Logger): Promise<void> {
  let discord: typeof import("discord.js") | undefined;
  try { discord = await import("discord.js"); }
  catch { log.warn("gateway.discord.missing-dep"); return; }

  const { Client, GatewayIntentBits } = discord;
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages] });
  client.on("messageCreate", (msg) => {
    if (msg.author.bot) return;
    if (c.channelId && msg.channelId !== c.channelId) return;
    if (c.allowlist && c.allowlist.length > 0 && !c.allowlist.includes(msg.author.id)) return;
    const db = openDb(profile);
    try {
      db.prepare("INSERT INTO tasks(created_at, priority, status, body, source) VALUES(?,?,?,?,?)").run(
        new Date().toISOString(), "normal", "pending", msg.content, `discord:${msg.author.id}`,
      );
    } finally { db.close(); }
    log.info("gateway.discord.msg", { from: msg.author.id, len: msg.content.length });
  });
  await client.login(c.token);
}
