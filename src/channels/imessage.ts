// iMessage adapter - macOS only.
//
// Shape matches Telegram/Discord: a poll loop enqueues inbound tasks,
// `send()` routes replies back. Unlike the other two, there's no bot
// token and no webhook - everything is local to the Mac:
//   - Receive: read-only SQLite poll over ~/Library/Messages/chat.db
//     (Apple's own message store; bajaclaw needs Full Disk Access
//     to read it).
//   - Send: AppleScript via `osascript` to Messages.app (macOS
//     prompts for Automation permission on first use).
//
// State: last-seen `message.ROWID` per profile, persisted to a small
// JSON file in profileDir so cross-restart dedup works without
// touching bajaclaw's main DB on the hot path.
//
// Scope (v1): 1:1 iMessage text only. No groups, no outbound
// attachments. Inbound attachments are noted in the body as
// `[attachment]` markers; agents still see them and can ask the user
// to forward through another channel.
import { spawnSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { profileDir, ensureDir } from "../paths.js";
import { openDb } from "../db.js";
import { Logger } from "../logger.js";
import type { ChannelConfig } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Apple's CFAbsoluteTime epoch: 2001-01-01 00:00:00 UTC, in seconds
// since Unix epoch. chat.db stores message.date as nanoseconds since
// that moment (macOS 10.13+; older versions used seconds).
export const APPLE_EPOCH_UNIX_SECONDS = 978307200;

// Nanosecond multiplier threshold - chat.db dates larger than this are
// nanosecond-precision; smaller were stored in seconds (ancient). In
// practice every modern macOS uses nanoseconds.
const NS_THRESHOLD = 1e12;

export function appleDateToIso(rawDate: number): string {
  const seconds = rawDate > NS_THRESHOLD
    ? rawDate / 1e9
    : rawDate;
  return new Date((APPLE_EPOCH_UNIX_SECONDS + seconds) * 1000).toISOString();
}

export function chatDbPath(): string {
  return join(homedir(), "Library", "Messages", "chat.db");
}

// "Full Disk Access" is granted at the binary-path level. We can't
// check the grant directly from sandboxed Node - best we can do is
// try to open the file and observe EACCES/EPERM.
export function probeFullDiskAccess(): { granted: boolean; error?: string } {
  const p = chatDbPath();
  if (!existsSync(p)) return { granted: false, error: "chat.db not found - is Messages.app set up?" };
  try {
    const fd = openSync(p, "r");
    closeSync(fd);
    return { granted: true };
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "EACCES" || err.code === "EPERM") {
      return { granted: false, error: "Full Disk Access not granted" };
    }
    return { granted: false, error: err.message };
  }
}

// macOS URL that jumps straight to the Full Disk Access pane in
// System Settings. `open` is built into macOS.
export function openFullDiskAccessPane(): void {
  spawnSync("open", ["x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"]);
}

export function openAutomationPane(): void {
  spawnSync("open", ["x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"]);
}

// Normalize a handle to the form that AppleScript's `participants`
// lookup expects. iMessage accepts either a phone number in any
// common format or an email address. We pass through emails as-is
// and strip formatting from phone numbers. Messages.app canonicalizes
// internally; we just help it along.
export function normalizeHandle(handle: string): string {
  const h = handle.trim();
  if (h.includes("@")) return h.toLowerCase();
  // Phone number - strip non-digits except the leading '+'
  const stripped = h.replace(/[^\d+]/g, "");
  // US numbers without country code: prepend +1 as Apple's default
  if (/^\d{10}$/.test(stripped)) return "+1" + stripped;
  if (!stripped.startsWith("+") && /^\d{11,15}$/.test(stripped)) return "+" + stripped;
  return stripped;
}

export function isEmailHandle(handle: string): boolean {
  return handle.includes("@");
}

interface IMessageState {
  lastRowId: number;
}

function stateFile(profile: string): string {
  return join(profileDir(profile), "imessage.state.json");
}

export function loadState(profile: string): IMessageState {
  try {
    const raw = readFileSync(stateFile(profile), "utf8");
    const parsed = JSON.parse(raw) as Partial<IMessageState>;
    return { lastRowId: Number(parsed.lastRowId) || 0 };
  } catch {
    return { lastRowId: 0 };
  }
}

export function saveState(profile: string, state: IMessageState): void {
  ensureDir(profileDir(profile));
  const tmp = stateFile(profile) + ".tmp";
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, stateFile(profile));
}

export interface InboundIMessage {
  rowId: number;
  handle: string;
  text: string;
  hasAttachment: boolean;
  dateIso: string;
  service: string;
}

// Open chat.db read-only. SQLite's `mode: "ro"` avoids accidental
// writes and plays nice with the running Messages.app which holds its
// own write lock. We also set `fileMustExist: true` so a nonexistent
// file surfaces as a clear error instead of creating an empty db.
export function openChatDb(): Database.Database {
  return new Database(chatDbPath(), { readonly: true, fileMustExist: true });
}

// Native typing helper. Compiled from helpers/imessage-typing.m into a
// universal Mach-O binary shipped alongside bajaclaw. Calls IMCore's
// private setLocalUserIsTyping: to produce the "..." indicator on the
// recipient's device - something AppleScript can't do.
//
// Resolves to one of:
//   - <repo>/helpers/bajaclaw-imessage-helper  (dev checkout; src/channels -> up two)
//   - <pkg>/helpers/bajaclaw-imessage-helper   (installed; dist/channels -> up two)
// Both paths end up the same shape because `files` in package.json
// ships helpers/ verbatim next to dist/.
let cachedHelperPath: string | null | undefined;

export function resolveTypingHelperPath(): string | null {
  if (cachedHelperPath !== undefined) return cachedHelperPath;
  // __dirname is <root>/dist/channels when installed, or <root>/src/channels
  // via tsx. Either way, up two levels is the package root.
  const root = join(__dirname, "..", "..");
  const candidate = join(root, "helpers", "bajaclaw-imessage-helper");
  try {
    const st = statSync(candidate);
    if (st.isFile()) {
      // Strip the quarantine attribute npm applies to files downloaded
      // in tarballs. Idempotent; no-op if absent. Ignored on failure.
      spawnSync("xattr", ["-dr", "com.apple.quarantine", candidate], { stdio: "ignore" });
      cachedHelperPath = candidate;
      return candidate;
    }
  } catch { /* not present */ }
  cachedHelperPath = null;
  return null;
}

export interface TypingResult {
  ok: boolean;
  exitCode: number;
  error?: string;
}

export function sendTypingIndicator(
  handle: string,
  typing: boolean,
  log?: Logger,
): TypingResult {
  if (process.platform !== "darwin") {
    return { ok: false, exitCode: -1, error: "unsupported-platform" };
  }
  const helper = resolveTypingHelperPath();
  if (!helper) {
    return { ok: false, exitCode: -1, error: "helper-not-found" };
  }
  const norm = normalizeHandle(handle);
  const verb = typing ? "start" : "stop";
  const r = spawnSync(helper, [verb, norm], { encoding: "utf8", timeout: 5000 });
  if (r.status === 0) {
    return { ok: true, exitCode: 0 };
  }
  const err = (r.stderr || "").trim();
  log?.warn("gateway.imessage.typing-fail", { verb, handle: norm, status: r.status, err: err.slice(0, 200) });
  return { ok: false, exitCode: r.status ?? -1, error: err };
}

// Long-lived subprocess wrapper for the typing helper in `serve` mode.
// The helper reads commands from stdin and writes ok/err lines to stdout.
// Keeping it alive means the IMDaemonListener stays registered and
// imagent keeps the chat registry populated.
interface TypingHelper {
  send: (cmd: string) => void;
  stop: () => void;
}

function startTypingHelperProcess(log: Logger): TypingHelper | null {
  if (process.platform !== "darwin") return null;
  const helperPath = resolveTypingHelperPath();
  if (!helperPath) return null;

  let proc: ChildProcess | null = null;
  let helperStopped = false;
  let retried = false;

  function launchHelper(): void {
    // helperPath is checked non-null at the top of startTypingHelperProcess.
    const child = spawn(helperPath as string, ["serve"], { stdio: ["pipe", "pipe", "pipe"] });
    proc = child;

    child.stderr?.on("data", (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) log.warn("gateway.imessage.helper-stderr", { msg: msg.slice(0, 200) });
    });

    child.stdout?.on("data", (d: Buffer) => {
      const lines = d.toString().trim().split(/\r?\n/);
      for (const line of lines) {
        if (line.startsWith("err ")) {
          log.warn("gateway.imessage.helper-err", { msg: line.slice(4, 200) });
        }
      }
    });

    child.on("error", (e: Error) => {
      log.warn("gateway.imessage.helper-spawn-error", { error: e.message });
    });

    child.on("exit", (code) => {
      if (!helperStopped && !retried) {
        retried = true;
        log.info("gateway.imessage.helper-respawn", { code });
        launchHelper();
      }
    });
  }

  launchHelper();

  return {
    send: (cmd: string) => {
      try { proc?.stdin?.write(cmd + "\n"); } catch { /* typing is best-effort */ }
    },
    stop: () => {
      helperStopped = true;
      try { proc?.stdin?.write("quit\n"); } catch { /* ignore */ }
      // Give it 1s to exit cleanly, then SIGTERM.
      setTimeout(() => { try { proc?.kill("SIGTERM"); } catch { /* ignore */ } }, 1000);
    },
  };
}

// The inbound query. ROWID is monotonic and indexed, so "everything
// after the last one we saw" is an O(log n) lookup plus a sequential
// scan over only the new rows. Joins to handle.id for the sender
// identity and left-joins the chat_message_join + chat tables to let
// us filter out group chats (where cache_roomname is NOT NULL).
const INBOUND_SQL = `
SELECT
  m.ROWID                          AS row_id,
  COALESCE(h.id, '')               AS handle,
  COALESCE(m.text, '')             AS text,
  COALESCE(m.cache_has_attachments, 0) AS has_attachment,
  m.date                           AS raw_date,
  COALESCE(m.service, '')          AS service,
  COALESCE(c.room_name, '')        AS room_name
FROM message m
LEFT JOIN handle h ON m.handle_id = h.ROWID
LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
LEFT JOIN chat c ON c.ROWID = cmj.chat_id
WHERE m.ROWID > @sinceRowId
  AND m.is_from_me = 0
ORDER BY m.ROWID ASC
LIMIT 500
`;

interface Row {
  row_id: number;
  handle: string;
  text: string;
  has_attachment: number;
  raw_date: number;
  service: string;
  room_name: string;
}

export function fetchNewMessages(db: Database.Database, sinceRowId: number): InboundIMessage[] {
  const rows = db.prepare(INBOUND_SQL).all({ sinceRowId }) as Row[];
  const out: InboundIMessage[] = [];
  for (const r of rows) {
    // Skip group chats (v1 scope).
    if (r.room_name) continue;
    // Skip non-iMessage rows unless text is present (SMS fallback can
    // be legitimate but we let the allowlist decide).
    if (!r.text && !r.has_attachment) continue;
    out.push({
      rowId: r.row_id,
      handle: r.handle,
      text: r.text || "",
      hasAttachment: r.has_attachment === 1,
      dateIso: appleDateToIso(r.raw_date),
      service: r.service,
    });
  }
  return out;
}

// Build the AppleScript command for sending. Uses single-quote-safe
// escaping for the body (doubles any ' inside the string, wraps in
// singles). Participants lookup is service-scoped to iMessage so we
// don't accidentally fall back to SMS when the user doesn't want it.
export function buildSendAppleScript(handle: string, text: string): string {
  const esc = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const norm = normalizeHandle(handle);
  return `
tell application "Messages"
  set targetService to 1st account whose service type = iMessage
  set targetBuddy to participant "${esc(norm)}" of targetService
  send "${esc(text)}" to targetBuddy
end tell
`.trim();
}

export async function sendViaAppleScript(handle: string, text: string, log?: Logger): Promise<void> {
  const script = buildSendAppleScript(handle, text);
  const r = spawnSync("osascript", ["-e", script], { encoding: "utf8" });
  if (r.status !== 0) {
    const msg = r.stderr || r.stdout || "osascript failed";
    // Detect the Automation permission denial - macOS returns a
    // specific error code (-1743) when the calling app isn't approved.
    if (/-1743/.test(msg)) {
      log?.error("gateway.imessage.automation-denied");
      throw new Error("Automation permission denied for Messages.app. Open System Settings -> Privacy & Security -> Automation and allow bajaclaw (or your terminal) to control Messages.");
    }
    log?.error("gateway.imessage.send-fail", { error: msg.slice(0, 200) });
    throw new Error(`osascript send failed: ${msg.slice(0, 200)}`);
  }
}

type Sender = (chatId: string | number, text: string) => Promise<void>;
type TypingStarter = (chatId: string | number) => () => void;

export interface IMessageAdapter {
  kind: "imessage";
  send: Sender;
  startTyping: TypingStarter;
  stop: () => Promise<void>;
}

export interface StartIMessageDeps {
  // Hook for the gateway to enqueue a received message. Same signature
  // used by telegram/discord adapters via direct db writes there; we
  // parameterize it here so unit tests can spy on the call.
  onInbound: (msg: InboundIMessage) => void;
  // How often (ms) to check chat.db for new rows. Default 2000.
  pollMs?: number;
}

export async function startIMessage(
  profile: string,
  config: ChannelConfig,
  log: Logger,
  deps: StartIMessageDeps,
): Promise<IMessageAdapter | undefined> {
  if (process.platform !== "darwin") {
    log.warn("gateway.imessage.unsupported-platform", { platform: process.platform });
    return undefined;
  }

  const probe = probeFullDiskAccess();
  if (!probe.granted) {
    // Log-only here: the CLI already opens the System Settings pane
    // when the user runs `channel add imessage`. Re-opening it on
    // every daemon restart is noise - trust that they'll grant it
    // when they see the CLI nudge, and that subsequent daemon
    // restarts will pick it up automatically.
    log.error("gateway.imessage.fda-missing", { error: probe.error });
    return undefined;
  }

  let db: Database.Database;
  try {
    db = openChatDb();
  } catch (e) {
    log.error("gateway.imessage.open-fail", { error: (e as Error).message });
    return undefined;
  }

  const pollMs = deps.pollMs ?? 2000;
  let state = loadState(profile);
  // First-run safety: if we've never seen a ROWID, seed with the
  // current max so we don't dump the user's entire message history
  // into the task queue on first start. They'd be cycling for hours.
  if (state.lastRowId === 0) {
    const maxRow = (db.prepare("SELECT COALESCE(MAX(ROWID),0) AS m FROM message").get() as { m: number }).m;
    state = { lastRowId: maxRow };
    saveState(profile, state);
    log.info("gateway.imessage.seed", { lastRowId: maxRow });
  }

  const allowlist = (config.allowlist ?? []).map((h) => normalizeHandle(String(h)));
  const useAllowlist = allowlist.length > 0;

  const typingHelper = startTypingHelperProcess(log);

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const msgs = fetchNewMessages(db, state.lastRowId);
      if (msgs.length > 0) {
        for (const m of msgs) {
          const nh = normalizeHandle(m.handle);
          if (useAllowlist && !allowlist.includes(nh)) {
            log.info("gateway.imessage.skip", { handle: nh, reason: "not-in-allowlist" });
            state = { lastRowId: m.rowId };
            continue;
          }
          try {
            deps.onInbound(m);
          } catch (e) {
            log.error("gateway.imessage.onInbound-fail", { error: (e as Error).message, rowId: m.rowId });
          }
          state = { lastRowId: m.rowId };
        }
        saveState(profile, state);
      }
    } catch (e) {
      log.error("gateway.imessage.poll-fail", { error: (e as Error).message });
    } finally {
      if (!stopped) timer = setTimeout(tick, pollMs);
    }
  };

  // Kick off the first tick on nextTick so callers have a chance to
  // wire up logging before the first row fires.
  process.nextTick(tick);

  log.info("gateway.imessage.ready", { profile, allowlist: allowlist.length, pollMs });

  return {
    kind: "imessage",
    send: async (chatId, text) => {
      // chatId here is the normalized handle string for the adapter.
      await sendViaAppleScript(String(chatId), text, log);
    },
    startTyping: (chatId) => {
      if (!typingHelper) return () => {};
      const handle = normalizeHandle(String(chatId));
      let indicatorStopped = false;

      const sendStart = () => typingHelper.send(`start ${handle}`);
      sendStart();

      // iMessage "..." indicator stays on until the sender replies or
      // ~60s elapse. Refresh every 30s to keep it alive across long
      // cycles. Also retry at 10s in case the first call raced against
      // the helper's registry population (imagent may take a few seconds
      // to push chat state after the listener is registered).
      const initialRetry = setTimeout(() => { if (!indicatorStopped) sendStart(); }, 10_000);
      const refreshTimer = setInterval(() => { if (!indicatorStopped) sendStart(); }, 30_000);

      return () => {
        indicatorStopped = true;
        clearTimeout(initialRetry);
        clearInterval(refreshTimer);
        typingHelper.send(`stop ${handle}`);
      };
    },
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      typingHelper?.stop();
      try { db.close(); } catch { /* ignore */ }
    },
  };
}

// Helper for gateway.ts: translate InboundIMessage into a task row
// using the profile DB. Exported so the gateway can call it from the
// onInbound callback without duplicating the insert shape.
export function insertIMessageTask(profile: string, msg: InboundIMessage): void {
  const db = openDb(profile);
  try {
    const body = msg.text || "";
    // Flag attachment presence in the body when there's no text so the
    // agent knows something arrived even without content.
    const augmented = body || (msg.hasAttachment ? "[attachment]" : "");
    db.prepare("INSERT INTO tasks(created_at, priority, status, body, source, attachments) VALUES(?,?,?,?,?,?)").run(
      new Date().toISOString(),
      "normal",
      "pending",
      augmented,
      `imessage:${normalizeHandle(msg.handle)}`,
      null,
    );
  } finally {
    db.close();
  }
}
