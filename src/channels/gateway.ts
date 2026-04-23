// bajaclaw-gateway: normalizes inbound messages from configured channel
// adapters into the tasks queue, and routes outbound replies back.
//
// Adapters are kept alive in a process-wide map keyed by `profile:kind`
// so the daemon can call `replyToSource` after a cycle completes.
import { spawnSync } from "node:child_process";
import { statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { loadConfig } from "../config.js";
import { openDb } from "../db.js";
import { Logger } from "../logger.js";
import type { ChannelConfig } from "../types.js";
import { startIMessage, insertIMessageTask, normalizeHandle } from "./imessage.js";

function extractFrames(videoPath: string, frameCount = 8): string[] {
  let interval = 2;
  const probe = spawnSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", videoPath,
  ], { encoding: "utf8" });
  if (probe.status === 0) {
    const dur = parseFloat(probe.stdout.trim());
    if (dur > 0) interval = Math.max(0.5, dur / frameCount);
  }
  const ts = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const pattern = join(tmpdir(), `bajaclaw-video-${ts}-frame-%03d.jpg`);
  spawnSync("ffmpeg", [
    "-i", videoPath,
    "-vf", `fps=1/${interval.toFixed(2)}`,
    "-frames:v", String(frameCount),
    pattern,
  ]);
  const frames: string[] = [];
  for (let i = 1; i <= frameCount; i++) {
    const fp = pattern.replace("%03d", String(i).padStart(3, "0"));
    try { if (statSync(fp).isFile()) frames.push(fp); } catch { /* skip */ }
  }
  return frames;
}

async function downloadToTmp(url: string, ext: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const tmpPath = join(tmpdir(), `bajaclaw-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    writeFileSync(tmpPath, buf);
    return tmpPath;
  } catch {
    return null;
  }
}

type Sender = (chatId: string | number, text: string) => Promise<void>;
type FileSender = (chatId: string | number, path: string, caption?: string) => Promise<void>;
type TypingStarter = (chatId: string | number) => () => void;

export type ChannelKind = "telegram" | "discord" | "imessage";

// A progress-message handle returned by openProgressMessage. The
// adapter decides the shape; callers treat it as opaque. `null` means
// the adapter does not support edit-in-place (e.g. iMessage).
export type ProgressHandle = { messageId: string | number } | null;

interface Adapter {
  kind: ChannelKind;
  send: Sender;
  sendFile?: FileSender;
  sendTapback?: (chatId: string | number, messageGuid: string, type: number) => Promise<void>;
  startTyping: TypingStarter;
  stop: () => Promise<void>;
  // Open a new "progress message" in the given chat. Adapters that
  // support edit-in-place (Telegram, Discord) send `initialText` and
  // return a handle the caller uses to edit or delete it. Adapters
  // that don't (iMessage) should return null so the caller knows to
  // take the summary-at-cycle-end path instead.
  openProgressMessage?: (chatId: string | number, initialText: string) => Promise<ProgressHandle>;
  editProgressMessage?: (chatId: string | number, handle: ProgressHandle, text: string) => Promise<void>;
  // Optional: delete the progress message at cycle end so the final
  // reply stands alone. Implementations may swallow errors.
  deleteProgressMessage?: (chatId: string | number, handle: ProgressHandle) => Promise<void>;
}

const adapters = new Map<string, Adapter>();
// Active typing indicators, keyed by source ("kind:chatId"). Each
// value is the stop function returned by the adapter's startTyping.
const activeTyping = new Map<string, () => void>();
// Last active chat/channel ID per adapter, keyed by "profile:kind".
// Updated whenever a message arrives. Used by broadcastToProfile.
const notifyTargets = new Map<string, string>();

function key(profile: string, kind: ChannelKind): string {
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
      } else if (c.kind === "imessage") {
        const a = await startIMessage(profile, c, log, {
          onInbound: (msg) => {
            insertIMessageTask(profile, msg);
            const nh = normalizeHandle(msg.handle);
            // Group routing uses the chat GUID as the chatId so the
            // AppleScript reply path can hit `text chat id "..."`. 1:1
            // routing uses the sender's handle. Both shapes flow back
            // through replyToSource unchanged.
            const chatId = msg.groupGuid ? `group:${msg.groupGuid}` : nh;
            const source = `imessage:${chatId}`;
            notifyTargets.set(key(profile, "imessage"), chatId);
            log.info("gateway.imessage.msg", {
              from: nh,
              group: msg.groupGuid,
              len: msg.text.length,
              attachments: msg.attachmentPaths?.length ?? 0,
            });
            beginTyping(profile, source);
          },
        });
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
 *  `source` is formatted as "telegram:<id>" or "discord:<id>" - the
 *  same string written into tasks.source by the inbound handlers.
 *  Also ends any typing indicator associated with that source. */
export async function replyToSource(profile: string, source: string, text: string): Promise<void> {
  endTyping(source);
  const colon = source.indexOf(":");
  if (colon < 0) return;
  const kind = source.slice(0, colon);
  const id = source.slice(colon + 1);
  if (kind !== "telegram" && kind !== "discord" && kind !== "imessage") return;
  const a = adapters.get(key(profile, kind));
  if (!a) return;
  await a.send(id, text);
}

/** Send a file attachment to the channel that originated a task.
 *  Images on Telegram and Discord arrive inline; iMessage attaches as
 *  a normal file. No-ops (returns false) when the adapter does not
 *  support file send. Does NOT end typing; follow with a normal reply
 *  to close the turn. */
export async function sendAttachmentToSource(
  profile: string,
  source: string,
  path: string,
  caption?: string,
): Promise<boolean> {
  const colon = source.indexOf(":");
  if (colon < 0) return false;
  const kind = source.slice(0, colon);
  const id = source.slice(colon + 1);
  if (kind !== "telegram" && kind !== "discord" && kind !== "imessage") return false;
  const a = adapters.get(key(profile, kind));
  if (!a || !a.sendFile) return false;
  await a.sendFile(id, path, caption);
  return true;
}

/** Send a tapback (reaction) to a specific message. iMessage only
 *  for now. Returns false if the channel does not support it OR the
 *  AppleScript path failed (e.g. private-entitlement gate on macOS
 *  14+). Callers should treat this as best-effort. */
export async function sendTapbackToSource(
  profile: string,
  source: string,
  messageGuid: string,
  type: number,
): Promise<boolean> {
  const colon = source.indexOf(":");
  if (colon < 0) return false;
  const kind = source.slice(0, colon);
  const id = source.slice(colon + 1);
  if (kind !== "imessage") return false;
  const a = adapters.get(key(profile, kind));
  if (!a || !a.sendTapback) return false;
  try { await a.sendTapback(id, messageGuid, type); return true; }
  catch { return false; }
}

/** Like sendAttachmentToSource but pings the last-active chat on the
 *  profile for a given kind. Used when BAJACLAW_SOURCE is not set and
 *  the user still wants the attachment to land somewhere. Returns
 *  false if no last-active chat is known on that channel. */
export async function broadcastAttachmentToProfile(
  profile: string,
  path: string,
  caption?: string,
): Promise<boolean> {
  for (const kind of ["telegram", "discord", "imessage"] as ChannelKind[]) {
    const target = notifyTargets.get(key(profile, kind));
    if (!target) continue;
    const a = adapters.get(key(profile, kind));
    if (!a || !a.sendFile) continue;
    try { await a.sendFile(target, path, caption); return true; }
    catch { /* try next kind */ }
  }
  return false;
}

/** Show the platform's "typing…" indicator for the given source. The
 *  adapter internally refreshes on the platform's cadence (Telegram
 *  indicator lasts ~5s, Discord ~10s) until `endTyping(source)` is
 *  called. Safe to call multiple times - a second call replaces the
 *  first. No-ops if the adapter isn't loaded. */
export function beginTyping(profile: string, source: string): void {
  const colon = source.indexOf(":");
  if (colon < 0) return;
  const kind = source.slice(0, colon) as ChannelKind;
  const id = source.slice(colon + 1);
  if (kind !== "telegram" && kind !== "discord" && kind !== "imessage") return;
  const a = adapters.get(key(profile, kind));
  if (!a) return;
  const existing = activeTyping.get(source);
  if (existing) existing();
  try {
    const stop = a.startTyping(id);
    activeTyping.set(source, stop);
  } catch { /* ignore - typing is best-effort */ }
}

export function endTyping(source: string): void {
  const stop = activeTyping.get(source);
  if (!stop) return;
  activeTyping.delete(source);
  try { stop(); } catch { /* ignore */ }
}

/** Send a progress update to the task's originating channel without
 *  ending the typing indicator. Used by `bajaclaw say` from inside a
 *  running cycle. Unlike `replyToSource`, this is a mid-flight ping -
 *  the final reply still fires at cycle end and is the one that
 *  clears typing. No-ops if source is not a channel or no adapter is
 *  registered. */
export async function sendProgressToSource(profile: string, source: string, text: string): Promise<void> {
  const colon = source.indexOf(":");
  if (colon < 0) return;
  const kind = source.slice(0, colon);
  const id = source.slice(colon + 1);
  if (kind !== "telegram" && kind !== "discord" && kind !== "imessage") return;
  const a = adapters.get(key(profile, kind));
  if (!a) return;
  await a.send(id, text);
}

/** Open an edit-in-place progress message for the narrator.
 *  Returns null when the adapter does not support edits (iMessage)
 *  or is not loaded; callers must fall back to the summary path. */
export async function openProgressMessage(
  profile: string,
  source: string,
  initialText: string,
): Promise<ProgressHandle> {
  const colon = source.indexOf(":");
  if (colon < 0) return null;
  const kind = source.slice(0, colon);
  const id = source.slice(colon + 1);
  if (kind !== "telegram" && kind !== "discord" && kind !== "imessage") return null;
  const a = adapters.get(key(profile, kind));
  if (!a || !a.openProgressMessage) return null;
  try { return await a.openProgressMessage(id, initialText); }
  catch { return null; }
}

export async function editProgressMessage(
  profile: string,
  source: string,
  handle: ProgressHandle,
  text: string,
): Promise<void> {
  if (!handle) return;
  const colon = source.indexOf(":");
  if (colon < 0) return;
  const kind = source.slice(0, colon);
  const id = source.slice(colon + 1);
  if (kind !== "telegram" && kind !== "discord" && kind !== "imessage") return;
  const a = adapters.get(key(profile, kind));
  if (!a || !a.editProgressMessage) return;
  try { await a.editProgressMessage(id, handle, text); }
  catch { /* swallow: edits are best-effort */ }
}

export async function deleteProgressMessage(
  profile: string,
  source: string,
  handle: ProgressHandle,
): Promise<void> {
  if (!handle) return;
  const colon = source.indexOf(":");
  if (colon < 0) return;
  const kind = source.slice(0, colon);
  const id = source.slice(colon + 1);
  if (kind !== "telegram" && kind !== "discord" && kind !== "imessage") return;
  const a = adapters.get(key(profile, kind));
  if (!a || !a.deleteProgressMessage) return;
  try { await a.deleteProgressMessage(id, handle); }
  catch { /* swallow */ }
}

/** Send a proactive notification to all active channels for a profile.
 *  Uses the last seen chat/channel ID per adapter. No-ops if no messages
 *  have arrived yet (no chatId to target). Fire-and-forget. */
export function broadcastToProfile(profile: string, text: string): void {
  for (const kind of ["telegram", "discord", "imessage"] as const) {
    const k = key(profile, kind);
    const a = adapters.get(k);
    if (!a) continue;
    const chatId = notifyTargets.get(k);
    if (!chatId) continue;
    a.send(chatId, text).catch(() => undefined);
  }
}

async function startTelegram(profile: string, c: ChannelConfig, log: Logger): Promise<Adapter | undefined> {
  if (!c.token) { log.error("gateway.telegram.missing-token"); return undefined; }
  let TelegramBot: typeof import("node-telegram-bot-api") | undefined;
  try { TelegramBot = (await import("node-telegram-bot-api")).default; }
  catch { log.warn("gateway.telegram.missing-dep"); return undefined; }

  const bot = new TelegramBot(c.token, { polling: true });
  bot.on("polling_error", (err: Error) => log.error("gateway.telegram.poll-err", { error: err.message }));
  bot.on("message", async (msg) => {
    const sender = msg.from?.id;
    const chatId = msg.chat.id;
    if (c.allowlist && c.allowlist.length > 0 && sender !== undefined) {
      const hit = c.allowlist.some((v) => Number(v) === sender);
      if (!hit) return;
    }

    const hasPhoto = Array.isArray(msg.photo) && msg.photo.length > 0;
    const hasDoc = Boolean(msg.document?.mime_type?.startsWith("image/"));
    const hasVideo = Boolean(msg.video);
    const hasVideoNote = Boolean(msg.video_note);
    const hasVideoDoc = Boolean(msg.document?.mime_type?.startsWith("video/"));
    const hasVoice = Boolean(msg.voice);
    const hasAudio = Boolean(msg.audio);
    let body = msg.text ?? msg.caption ?? "";
    if (!body && !hasPhoto && !hasDoc && !hasVideo && !hasVideoNote && !hasVideoDoc && !hasVoice && !hasAudio) return;

    const attachmentPaths: string[] = [];
    if (hasPhoto) {
      const largest = msg.photo![msg.photo!.length - 1]!;
      try {
        const url = await bot.getFileLink(largest.file_id);
        const tmpPath = await downloadToTmp(String(url), ".jpg");
        if (tmpPath) attachmentPaths.push(tmpPath);
      } catch (e) { log.warn("gateway.telegram.download.fail", { type: "photo", error: (e as Error).message }); }
    } else if (hasDoc && msg.document) {
      const ext = extname(msg.document.file_name ?? ".jpg") || ".jpg";
      try {
        const url = await bot.getFileLink(msg.document.file_id);
        const tmpPath = await downloadToTmp(String(url), ext);
        if (tmpPath) attachmentPaths.push(tmpPath);
      } catch (e) { log.warn("gateway.telegram.download.fail", { type: "document", error: (e as Error).message }); }
    } else if (hasVideo && msg.video) {
      try {
        const url = await bot.getFileLink(msg.video.file_id);
        const tmpPath = await downloadToTmp(String(url), ".mp4");
        if (tmpPath) attachmentPaths.push(...extractFrames(tmpPath));
      } catch (e) { log.warn("gateway.telegram.download.fail", { type: "video", error: (e as Error).message }); }
    } else if (hasVideoNote && msg.video_note) {
      try {
        const url = await bot.getFileLink(msg.video_note.file_id);
        const tmpPath = await downloadToTmp(String(url), ".mp4");
        if (tmpPath) attachmentPaths.push(...extractFrames(tmpPath));
      } catch (e) { log.warn("gateway.telegram.download.fail", { type: "video_note", error: (e as Error).message }); }
    } else if (hasVideoDoc && msg.document) {
      const ext = extname(msg.document.file_name ?? ".mp4") || ".mp4";
      try {
        const url = await bot.getFileLink(msg.document.file_id);
        const tmpPath = await downloadToTmp(String(url), ext);
        if (tmpPath) attachmentPaths.push(...extractFrames(tmpPath));
      } catch (e) { log.warn("gateway.telegram.download.fail", { type: "video_doc", error: (e as Error).message }); }
    }
    // Voice notes (OGG/opus) and audio files. Download for reference;
    // if OPENAI_API_KEY is set, auto-transcribe and use the transcript
    // as the task body so the agent can respond to what was said
    // without needing to read the audio file itself.
    if (hasVoice && msg.voice) {
      try {
        const url = await bot.getFileLink(msg.voice.file_id);
        const tmpPath = await downloadToTmp(String(url), ".oga");
        if (tmpPath) {
          attachmentPaths.push(tmpPath);
          if (process.env.OPENAI_API_KEY) {
            try {
              const { transcribe } = await import("../voice.js");
              const r = await transcribe(tmpPath);
              if (r.text) body = body ? `${body}\n\n[voice transcript] ${r.text}` : `[voice] ${r.text}`;
            } catch (e) {
              log.warn("gateway.telegram.voice.transcribe-fail", { error: (e as Error).message });
            }
          }
        }
      } catch (e) { log.warn("gateway.telegram.download.fail", { type: "voice", error: (e as Error).message }); }
    } else if (hasAudio && msg.audio) {
      try {
        const url = await bot.getFileLink(msg.audio.file_id);
        const rawName = (msg.audio as { file_name?: string }).file_name;
        const ext = extname(rawName ?? ".mp3") || ".mp3";
        const tmpPath = await downloadToTmp(String(url), ext);
        if (tmpPath) {
          attachmentPaths.push(tmpPath);
          if (process.env.OPENAI_API_KEY) {
            try {
              const { transcribe } = await import("../voice.js");
              const r = await transcribe(tmpPath);
              if (r.text) body = body ? `${body}\n\n[audio transcript] ${r.text}` : `[audio] ${r.text}`;
            } catch (e) {
              log.warn("gateway.telegram.audio.transcribe-fail", { error: (e as Error).message });
            }
          }
        }
      } catch (e) { log.warn("gateway.telegram.download.fail", { type: "audio", error: (e as Error).message }); }
    }

    const db = openDb(profile);
    try {
      const attachmentsJson = attachmentPaths.length > 0 ? JSON.stringify(attachmentPaths) : null;
      db.prepare("INSERT INTO tasks(created_at, priority, status, body, source, attachments) VALUES(?,?,?,?,?,?)").run(
        new Date().toISOString(), "normal", "pending", body, `telegram:${chatId}`, attachmentsJson,
      );
    } finally { db.close(); }
    notifyTargets.set(key(profile, "telegram"), String(chatId));
    log.info("gateway.telegram.msg", { from: sender, chat: chatId, len: body.length, attachments: attachmentPaths.length });
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
    sendFile: async (chatId, path, caption) => {
      // Images go through sendPhoto so they render inline in the
      // chat. Everything else is a document attachment.
      const ext = path.toLowerCase().split(".").pop() ?? "";
      const isImage = ["png", "jpg", "jpeg", "gif", "webp"].includes(ext);
      if (isImage) {
        await bot.sendPhoto(Number(chatId), path, caption ? { caption } : {});
      } else {
        await bot.sendDocument(Number(chatId), path, caption ? { caption } : {});
      }
    },
    openProgressMessage: async (chatId, initialText) => {
      // Telegram rejects empty messages. Fall back to a thin marker so
      // the handle is valid and editProgressMessage can replace it.
      const body = initialText.trim().length > 0 ? initialText : "…";
      const msg = await bot.sendMessage(Number(chatId), body);
      return { messageId: msg.message_id };
    },
    editProgressMessage: async (chatId, handle, text) => {
      if (!handle) return;
      const body = text.trim().length > 0 ? text : "…";
      try {
        await bot.editMessageText(body, {
          chat_id: Number(chatId),
          message_id: Number(handle.messageId),
        });
      } catch (e) {
        // Telegram throws on "message is not modified" (no-op edits)
        // and on rate limit. Both are non-fatal for a progress UI.
        const msg = (e as Error).message ?? "";
        if (!/not modified|Too Many Requests/i.test(msg)) throw e;
      }
    },
    deleteProgressMessage: async (chatId, handle) => {
      if (!handle) return;
      try { await bot.deleteMessage(Number(chatId), Number(handle.messageId)); }
      catch { /* ignore */ }
    },
    startTyping: (chatId) => {
      // Telegram's typing indicator auto-clears after 5s, so re-send
      // every 4s until stopped. `sendChatAction` errors are swallowed
      // - they'd be noise (bot blocked, etc.) and the agent still has
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
  if (!c.token) { log.error("gateway.discord.missing-token"); return undefined; }
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
  client.on("messageCreate", async (msg) => {
    if (msg.author.bot) return;
    if (c.channelId && msg.channelId !== c.channelId) return;
    if (c.allowlist && c.allowlist.length > 0 && !c.allowlist.some((v) => String(v) === msg.author.id)) return;

    const imageAttachments = [...msg.attachments.values()].filter(
      (a) => a.contentType?.startsWith("image/"),
    );
    const videoAttachments = [...msg.attachments.values()].filter(
      (a) => a.contentType?.startsWith("video/"),
    );
    if (!msg.content && imageAttachments.length === 0 && videoAttachments.length === 0) return;

    const attachmentPaths: string[] = [];
    for (const att of imageAttachments) {
      const ext = att.name.includes(".") ? `.${att.name.split(".").pop()!}` : ".jpg";
      try {
        const tmpPath = await downloadToTmp(att.url, ext);
        if (tmpPath) attachmentPaths.push(tmpPath);
      } catch (e) { log.warn("gateway.discord.download.fail", { type: "image", name: att.name, error: (e as Error).message }); }
    }
    for (const att of videoAttachments) {
      const ext = att.name.includes(".") ? `.${att.name.split(".").pop()!}` : ".mp4";
      try {
        const tmpPath = await downloadToTmp(att.url, ext);
        if (tmpPath) attachmentPaths.push(...extractFrames(tmpPath));
      } catch (e) { log.warn("gateway.discord.download.fail", { type: "video", name: att.name, error: (e as Error).message }); }
    }

    const db = openDb(profile);
    try {
      const attachmentsJson = attachmentPaths.length > 0 ? JSON.stringify(attachmentPaths) : null;
      db.prepare("INSERT INTO tasks(created_at, priority, status, body, source, attachments) VALUES(?,?,?,?,?,?)").run(
        new Date().toISOString(), "normal", "pending", msg.content, `discord:${msg.channelId}`, attachmentsJson,
      );
    } finally { db.close(); }
    notifyTargets.set(key(profile, "discord"), msg.channelId);
    log.info("gateway.discord.msg", { from: msg.author.id, len: msg.content.length, attachments: attachmentPaths.length });
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
    openProgressMessage: async (channelId, initialText) => {
      const ch = await client.channels.fetch(String(channelId));
      if (!ch || !("send" in ch) || typeof (ch as { send?: unknown }).send !== "function") return null;
      const body = initialText.trim().length > 0 ? initialText : "…";
      const sent = await (ch as { send: (t: string) => Promise<{ id: string }> }).send(body);
      return { messageId: sent.id };
    },
    editProgressMessage: async (channelId, handle, text) => {
      if (!handle) return;
      const ch = await client.channels.fetch(String(channelId));
      if (!ch || !("messages" in ch)) return;
      try {
        const m = await (ch as { messages: { fetch: (id: string) => Promise<{ edit: (t: string) => Promise<unknown> }> } })
          .messages.fetch(String(handle.messageId));
        const body = text.trim().length > 0 ? text : "…";
        await m.edit(body);
      } catch { /* rate-limited or gone - ignore */ }
    },
    deleteProgressMessage: async (channelId, handle) => {
      if (!handle) return;
      const ch = await client.channels.fetch(String(channelId));
      if (!ch || !("messages" in ch)) return;
      try {
        const m = await (ch as { messages: { fetch: (id: string) => Promise<{ delete: () => Promise<unknown> }> } })
          .messages.fetch(String(handle.messageId));
        await m.delete();
      } catch { /* ignore */ }
    },
    sendFile: async (channelId, path, caption) => {
      const ch = await client.channels.fetch(String(channelId));
      if (ch && "send" in ch && typeof (ch as { send?: unknown }).send === "function") {
        await (ch as { send: (o: { files: string[]; content?: string }) => Promise<unknown> }).send({
          files: [path],
          content: caption,
        });
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
