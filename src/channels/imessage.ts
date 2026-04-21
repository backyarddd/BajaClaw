// iMessage adapter - macOS only.
//
// Shape matches Telegram/Discord: a watcher enqueues inbound tasks,
// `send()` routes replies back. Unlike the other two, there's no bot
// token and no webhook - everything is local to the Mac:
//   - Receive: FSEvents watch on ~/Library/Messages/ (via node:fs.watch
//     recursive) with a slow-poll safety net. Needs Full Disk Access.
//   - Send: AppleScript via `osascript` to Messages.app. macOS prompts
//     for Automation permission on first use.
//
// State: last-seen `message.ROWID` per profile, persisted to a small
// JSON file in profileDir so cross-restart dedup works without
// touching bajaclaw's main DB on the hot path.
//
// macOS 26 (Tahoe) notes:
//   - `message.text` is NULL for rich messages (edits, effects, links,
//     replies, ~50% of modern traffic). Real content lives in the
//     `attributedBody` BLOB (typedstream). `decodeAttributedBody`
//     recovers it.
//   - Chat GUIDs now use the `any;-;` / `any;+;` prefix rather than
//     `iMessage;-;`. Send uses `1st service whose service type = iMessage`
//     + `participant` for 1:1 and `text chat id` for groups.
//   - AppleScript has intermittent 10-20s first-invocation beachballs
//     and spurious -1700 type-coercion errors. We wrap every script
//     in `with timeout` + `try`, retry -1700/-1712, and pre-warm at
//     adapter start.
//   - No typing indicator. The IMCore private API path is gated on
//     Apple-private entitlements that aren't issuable to third parties;
//     helpers exit 4 with empty IMChatRegistry. See HANDOFF landmine 48.
import { spawnSync } from "node:child_process";
import {
  existsSync, readFileSync, writeFileSync, renameSync, openSync,
  closeSync, copyFileSync, mkdirSync, readdirSync, statSync, unlinkSync,
  watch as fsWatch, type FSWatcher,
} from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { profileDir, ensureDir } from "../paths.js";
import { openDb } from "../db.js";
import { Logger } from "../logger.js";
import type { ChannelConfig } from "../types.js";

// Apple's CFAbsoluteTime epoch: 2001-01-01 00:00:00 UTC, in seconds
// since Unix epoch. chat.db stores message.date as nanoseconds since
// that moment (macOS 10.13+; older versions used seconds).
export const APPLE_EPOCH_UNIX_SECONDS = 978307200;

// chat.db dates larger than this are nanosecond-precision; smaller
// were stored in seconds. Every modern macOS uses nanoseconds.
const NS_THRESHOLD = 1e12;

export function appleDateToIso(rawDate: number): string {
  const seconds = rawDate > NS_THRESHOLD ? rawDate / 1e9 : rawDate;
  return new Date((APPLE_EPOCH_UNIX_SECONDS + seconds) * 1000).toISOString();
}

export function chatDbPath(): string {
  return join(homedir(), "Library", "Messages", "chat.db");
}

export function messagesDir(): string {
  return join(homedir(), "Library", "Messages");
}

// Full Disk Access is granted at the binary-path level. We can't check
// the grant directly from sandboxed Node - best we can do is try to
// open the file and observe EACCES/EPERM.
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

export function openFullDiskAccessPane(): void {
  spawnSync("open", ["x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"]);
}

export function openAutomationPane(): void {
  spawnSync("open", ["x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"]);
}

// Normalize a handle to the form Messages.app's `participants` lookup
// expects. iMessage accepts either a phone number in any common format
// or an email address. Pass emails through as-is (lowercased), strip
// formatting from phone numbers.
export function normalizeHandle(handle: string): string {
  const h = handle.trim();
  if (h.includes("@")) return h.toLowerCase();
  const stripped = h.replace(/[^\d+]/g, "");
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

// Extract the primary NSString value from a typedstream-encoded
// `message.attributedBody` blob. macOS 26 leaves `message.text` NULL
// for rich messages (edits, effects, embedded links, mentions, replies),
// so this is required to read ~half of modern inbound traffic.
//
// Full typedstream parsing is complex (see dgelessus/python-typedstream
// or ReagentX/imessage-exporter for the VM-style approach). We only
// need the first NSString value, which always follows the pattern:
//   ... "NSString" ... 0x84 0x01 0x2B <length> <utf8 bytes>
// where <length> is one byte (0..127), or 0x81 followed by a uint16-LE
// for 128+. Verified against real blobs on macOS 26.2.
export function decodeAttributedBody(buf: Buffer | Uint8Array | null | undefined): string | null {
  if (!buf) return null;
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.length < 32) return null;
  const MARKER = Buffer.from("NSString");
  const start = b.indexOf(MARKER);
  if (start < 0) return null;
  // Scan up to ~1KiB past the NSString class name for the value tag.
  const end = Math.min(start + 1024, b.length - 4);
  for (let i = start + MARKER.length; i < end; i++) {
    if (b.at(i) !== 0x84) continue;
    if (b.at(i + 1) !== 0x01) continue;
    const tag = b.at(i + 2);
    // `+` (0x2B) and `*` (0x2A) are both observed - typedstream uses
    // Obj-C runtime type codes. Both prefix a length-counted UTF-8 run.
    if (tag !== 0x2B && tag !== 0x2A) continue;
    const lenByte = b.at(i + 3);
    if (lenByte === undefined) continue;
    let len: number;
    let dataStart: number;
    if (lenByte === 0x81) {
      if (i + 6 > b.length) continue;
      len = b.readUInt16LE(i + 4);
      dataStart = i + 6;
    } else if (lenByte === 0x82) {
      if (i + 8 > b.length) continue;
      len = b.readUInt32LE(i + 4);
      dataStart = i + 8;
    } else {
      len = lenByte;
      dataStart = i + 4;
    }
    if (len <= 0 || len > 1_000_000) continue;
    if (dataStart + len > b.length) continue;
    const s = b.subarray(dataStart, dataStart + len).toString("utf8");
    // Sanity: the first UTF-8 char should be printable or whitespace.
    const c = s.charCodeAt(0);
    if (c !== 0 && (c >= 0x20 || c === 0x09 || c === 0x0A || c === 0x0D)) {
      return s;
    }
  }
  return null;
}

// Best-effort text recovery: prefer the `text` column; fall back to
// decoding `attributedBody`; if both fail, return empty string so the
// caller can decide whether to drop the row or annotate it.
export function messageText(
  text: string | null | undefined,
  attributedBody: Buffer | Uint8Array | null | undefined,
): string {
  if (text && text.length > 0) return text;
  const decoded = decodeAttributedBody(attributedBody);
  return decoded ?? "";
}

export interface InboundIMessage {
  rowId: number;
  guid: string;
  handle: string;
  text: string;
  hasAttachment: boolean;
  dateIso: string;
  service: string;
  // Group chat GUID when the row came from a group (chat.style=43),
  // else undefined. Consumers use this to decide routing: 1:1 uses
  // `handle`, groups use `groupGuid`.
  groupGuid?: string;
  groupName?: string;
  // On-disk paths to attachment files (already expanded, macOS-local).
  // HEIC is converted to JPEG lazily by `resolveInboundAttachments`.
  attachmentPaths?: string[];
}

export function openChatDb(): Database.Database {
  return new Database(chatDbPath(), { readonly: true, fileMustExist: true });
}

// ROWID is monotonic and indexed. Join to handle.id for the sender
// identity, left-join chat via chat_message_join for group detection.
// Pull both `text` and `attributedBody` so the caller can recover
// content from either. `chat.style = 45` = 1:1, `43` = group.
const INBOUND_SQL = `
SELECT
  m.ROWID                              AS row_id,
  m.guid                               AS guid,
  COALESCE(h.id, '')                   AS handle,
  m.text                               AS text,
  m.attributedBody                     AS attributed_body,
  COALESCE(m.cache_has_attachments, 0) AS has_attachment,
  m.date                               AS raw_date,
  COALESCE(m.service, '')              AS service,
  COALESCE(c.style, 0)                 AS chat_style,
  COALESCE(c.guid, '')                 AS chat_guid,
  COALESCE(c.display_name, '')         AS chat_display_name
FROM message m
LEFT JOIN handle h ON m.handle_id = h.ROWID
LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
LEFT JOIN chat c ON c.ROWID = cmj.chat_id
WHERE m.ROWID > @sinceRowId
  AND m.is_from_me = 0
  AND m.item_type = 0
  AND m.is_system_message = 0
ORDER BY m.ROWID ASC
LIMIT 500
`;

interface Row {
  row_id: number;
  guid: string;
  handle: string;
  text: string | null;
  attributed_body: Buffer | null;
  has_attachment: number;
  raw_date: number;
  service: string;
  chat_style: number;
  chat_guid: string;
  chat_display_name: string;
}

// Resolve the on-disk paths for a message's attachments. Called lazily
// from fetchNewMessages so we only pay the query + HEIC-convert cost
// on rows that actually have attachments.
const ATTACHMENT_SQL = `
SELECT
  COALESCE(a.filename, '')   AS filename,
  COALESCE(a.mime_type, '')  AS mime_type,
  COALESCE(a.uti, '')        AS uti
FROM message_attachment_join j
JOIN attachment a ON a.ROWID = j.attachment_id
WHERE j.message_id = @rowId
  AND a.filename IS NOT NULL
ORDER BY a.ROWID ASC
`;

interface AttachmentRow {
  filename: string;
  mime_type: string;
  uti: string;
}

function expandHome(p: string): string {
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  if (p === "~") return homedir();
  return p;
}

// Convert HEIC -> JPEG via `sips`. macOS ships sips so this has no
// extra install surface. Output lives next to the source with .jpg
// extension; if conversion fails, return the original path so the
// consumer can still see something.
function heicToJpeg(heicPath: string): string {
  const ext = extname(heicPath).toLowerCase();
  if (ext !== ".heic" && ext !== ".heif") return heicPath;
  const out = heicPath.slice(0, heicPath.length - ext.length) + ".jpg";
  if (existsSync(out)) return out;
  const r = spawnSync("sips", ["-s", "format", "jpeg", heicPath, "--out", out], { stdio: "ignore" });
  if (r.status === 0 && existsSync(out)) return out;
  return heicPath;
}

export function resolveInboundAttachments(db: Database.Database, rowId: number): string[] {
  const rows = db.prepare(ATTACHMENT_SQL).all({ rowId }) as AttachmentRow[];
  const out: string[] = [];
  for (const r of rows) {
    const expanded = expandHome(r.filename);
    if (!existsSync(expanded)) continue;
    // Heuristic: HEIC is Apple's default iOS camera format but most
    // downstream consumers (LLM vision APIs, previews) want JPEG.
    const uti = r.uti.toLowerCase();
    if (uti.includes("heic") || uti.includes("heif") || expanded.toLowerCase().endsWith(".heic")) {
      out.push(heicToJpeg(expanded));
    } else {
      out.push(expanded);
    }
  }
  return out;
}

export interface FetchOpts {
  // Include group messages (chat.style = 43). Default false - match
  // legacy v1 behavior.
  includeGroups?: boolean;
  // Resolve attachment paths on each row. Default true when provided
  // a live db.
  resolveAttachments?: boolean;
}

export function fetchNewMessages(
  db: Database.Database,
  sinceRowId: number,
  opts: FetchOpts = {},
): InboundIMessage[] {
  const includeGroups = opts.includeGroups ?? false;
  const resolveAttachments = opts.resolveAttachments ?? true;
  const rows = db.prepare(INBOUND_SQL).all({ sinceRowId }) as Row[];
  const out: InboundIMessage[] = [];
  for (const r of rows) {
    const isGroup = r.chat_style === 43 || Boolean(r.chat_guid && r.chat_guid.includes(";+;"));
    if (isGroup && !includeGroups) continue;
    const text = messageText(r.text, r.attributed_body);
    const hasAttachment = r.has_attachment === 1;
    // Drop rows that have neither recoverable text nor an attachment -
    // typically tapback removals or system metadata.
    if (!text && !hasAttachment) continue;
    const attachmentPaths = hasAttachment && resolveAttachments
      ? resolveInboundAttachments(db, r.row_id)
      : undefined;
    out.push({
      rowId: r.row_id,
      guid: r.guid,
      handle: r.handle,
      text,
      hasAttachment,
      dateIso: appleDateToIso(r.raw_date),
      service: r.service,
      groupGuid: isGroup ? r.chat_guid : undefined,
      groupName: isGroup ? (r.chat_display_name || undefined) : undefined,
      attachmentPaths,
    });
  }
  return out;
}

// Outbound: build an AppleScript `send` targeting either a 1:1
// participant or a group chat id. Uses `1st service whose service
// type = iMessage` which is the form that's stable on macOS 14-26.
export function buildSendAppleScript(handle: string, text: string): string {
  const esc = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const norm = normalizeHandle(handle);
  return `
with timeout of 30 seconds
  tell application "Messages"
    set targetService to 1st service whose service type = iMessage
    set targetBuddy to participant "${esc(norm)}" of targetService
    send "${esc(text)}" to targetBuddy
  end tell
end timeout
`.trim();
}

export function buildGroupSendAppleScript(chatGuid: string, text: string): string {
  const esc = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `
with timeout of 30 seconds
  tell application "Messages"
    send "${esc(text)}" to text chat id "${esc(chatGuid)}"
  end tell
end timeout
`.trim();
}

export function buildSendFileAppleScript(handle: string, filePath: string): string {
  const esc = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const norm = normalizeHandle(handle);
  return `
with timeout of 60 seconds
  tell application "Messages"
    set targetService to 1st service whose service type = iMessage
    set targetBuddy to participant "${esc(norm)}" of targetService
    set f to POSIX file "${esc(filePath)}"
    send f to targetBuddy
  end tell
end timeout
`.trim();
}

// Run a one-line osascript, retrying transient Tahoe errors. macOS 26
// intermittently surfaces -1712 (timeout) and -1700 ("Can't make any
// into type constant") on the same script that worked seconds earlier;
// a short backoff usually recovers. -1743 (Automation permission
// denied) is fatal and must surface a clean error to the user.
interface OsaResult { ok: boolean; stderr: string; code: number }

function runOsa(script: string): OsaResult {
  const r = spawnSync("osascript", ["-e", script], { encoding: "utf8", timeout: 45000 });
  return { ok: r.status === 0, stderr: (r.stderr || "").trim(), code: r.status ?? -1 };
}

const BACKOFF_MS = [500, 2000, 5000];
const TRANSIENT_CODES = /-1712|-1700|-609/; // timeout, type coercion, connection invalid

async function runOsaWithRetry(script: string, log?: Logger): Promise<void> {
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    const r = runOsa(script);
    if (r.ok) return;
    if (/-1743/.test(r.stderr)) {
      log?.error("gateway.imessage.automation-denied");
      throw new Error(
        "Automation permission denied for Messages.app. Open System Settings -> " +
        "Privacy & Security -> Automation and allow bajaclaw (or your terminal) " +
        "to control Messages.",
      );
    }
    const transient = TRANSIENT_CODES.test(r.stderr);
    const final = attempt === BACKOFF_MS.length;
    if (!transient || final) {
      log?.error("gateway.imessage.osa-fail", {
        attempt, code: r.code, error: r.stderr.slice(0, 200),
      });
      throw new Error(`osascript failed (code ${r.code}): ${r.stderr.slice(0, 200)}`);
    }
    log?.warn("gateway.imessage.osa-retry", {
      attempt, code: r.code, error: r.stderr.slice(0, 120),
    });
    await new Promise((res) => setTimeout(res, BACKOFF_MS[attempt]));
  }
}

export async function sendViaAppleScript(handle: string, text: string, log?: Logger): Promise<void> {
  await runOsaWithRetry(buildSendAppleScript(handle, text), log);
}

export async function sendGroupViaAppleScript(chatGuid: string, text: string, log?: Logger): Promise<void> {
  await runOsaWithRetry(buildGroupSendAppleScript(chatGuid, text), log);
}

// Outbound attachments: Messages.app's AppleScript `send` rejects files
// outside a small set of standard user directories on Sequoia/Tahoe
// (sandbox regression). Stage a copy into ~/Pictures/bajaclaw-staging
// which Messages trusts, then send from there. Caller is responsible
// for the original file's lifecycle; staged copy is pruned on next
// adapter start.
const STAGING_SUBDIR = "bajaclaw-staging";

export function stagingDir(): string {
  return join(homedir(), "Pictures", STAGING_SUBDIR);
}

export function stageAttachment(sourcePath: string): string {
  if (!existsSync(sourcePath)) throw new Error(`attachment not found: ${sourcePath}`);
  const dir = stagingDir();
  mkdirSync(dir, { recursive: true });
  const safeName = basename(sourcePath).replace(/[^\w.\- ]+/g, "_");
  const staged = join(dir, `${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}`);
  copyFileSync(sourcePath, staged);
  return staged;
}

function pruneStaging(olderThanMs = 24 * 60 * 60 * 1000): void {
  const dir = stagingDir();
  if (!existsSync(dir)) return;
  try {
    const cutoff = Date.now() - olderThanMs;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      try {
        const st = statSync(full);
        if (st.mtimeMs < cutoff) unlinkSync(full);
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

export async function sendFileViaAppleScript(
  handle: string,
  sourcePath: string,
  log?: Logger,
): Promise<void> {
  const staged = stageAttachment(sourcePath);
  await runOsaWithRetry(buildSendFileAppleScript(handle, staged), log);
}

// Pre-warm Messages.app. On Tahoe, the first AppleScript invocation
// after login can hang 10-20 seconds while the scripting dictionary
// loads; doing it at adapter start (not on the first real send) keeps
// user-visible latency low. Fire-and-forget; errors are fine.
function prewarmMessages(log?: Logger): void {
  const script = `with timeout of 10 seconds\n  tell application "Messages" to get name\nend timeout`;
  try {
    spawnSync("osascript", ["-e", script], { timeout: 20000, stdio: "ignore" });
    log?.info("gateway.imessage.prewarm");
  } catch { /* ignore */ }
}

// Light-touch delivery verification: after a send, peek at the last
// is_from_me=1 row for this service. Log-only; we don't retry sends
// based on this. Gives the operator something to cross-check in logs
// when a user reports "never got my reply".
function verifyRecentSend(db: Database.Database, log: Logger, handle: string): void {
  setTimeout(() => {
    try {
      const row = db.prepare(`
        SELECT ROWID, guid, is_sent, is_delivered, error, was_downgraded, service
        FROM message
        WHERE is_from_me = 1
        ORDER BY ROWID DESC
        LIMIT 1
      `).get() as {
        ROWID: number; guid: string; is_sent: number; is_delivered: number;
        error: number; was_downgraded: number; service: string;
      } | undefined;
      if (!row) return;
      log.info("gateway.imessage.send-verify", {
        to: handle, rowId: row.ROWID,
        sent: row.is_sent === 1,
        delivered: row.is_delivered === 1,
        error: row.error,
        downgraded: row.was_downgraded === 1,
        service: row.service,
      });
    } catch { /* ignore */ }
  }, 5000).unref();
}

type Sender = (chatId: string | number, text: string) => Promise<void>;
type TypingStarter = (chatId: string | number) => () => void;

export interface IMessageAdapter {
  kind: "imessage";
  send: Sender;
  sendFile?: (chatId: string | number, filePath: string, caption?: string) => Promise<void>;
  startTyping: TypingStarter;
  stop: () => Promise<void>;
}

export interface StartIMessageDeps {
  onInbound: (msg: InboundIMessage) => void;
  // Optional slow-poll interval (ms). Used as a safety net in case
  // FSEvents misses a change (rare but not impossible). Default 30000.
  pollMs?: number;
  // Optional debounce after a watch event before we query. Default 200.
  debounceMs?: number;
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

  const pollMs = deps.pollMs ?? 30000;
  const debounceMs = deps.debounceMs ?? 200;
  let state = loadState(profile);
  if (state.lastRowId === 0) {
    const maxRow = (db.prepare("SELECT COALESCE(MAX(ROWID),0) AS m FROM message").get() as { m: number }).m;
    state = { lastRowId: maxRow };
    saveState(profile, state);
    log.info("gateway.imessage.seed", { lastRowId: maxRow });
  }

  const includeGroups = Boolean((config as ChannelConfig & { includeGroups?: boolean }).includeGroups);
  const allowlist = (config.allowlist ?? []).map((h) => normalizeHandle(String(h)));
  const useAllowlist = allowlist.length > 0;

  let stopped = false;
  let watcher: FSWatcher | null = null;
  let slowTimer: NodeJS.Timeout | null = null;
  let debounceTimer: NodeJS.Timeout | null = null;
  let scanInFlight = false;
  let pending = false;

  const scan = async (): Promise<void> => {
    if (stopped) return;
    if (scanInFlight) { pending = true; return; }
    scanInFlight = true;
    try {
      const msgs = fetchNewMessages(db, state.lastRowId, { includeGroups });
      if (msgs.length > 0) {
        for (const m of msgs) {
          const nh = normalizeHandle(m.handle);
          // Allowlist still applies to groups (via any participant's handle),
          // but group routing uses the group GUID rather than a handle.
          if (useAllowlist && !allowlist.includes(nh) && !m.groupGuid) {
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
      scanInFlight = false;
      if (pending) { pending = false; setImmediate(scan); }
    }
  };

  const kickScan = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { debounceTimer = null; void scan(); }, debounceMs);
  };

  // FSEvents-backed watch on the Messages directory. Node 22's fs.watch
  // uses FSEvents on macOS when recursive is set, and we get events for
  // chat.db + chat.db-wal + chat.db-shm writes within milliseconds.
  try {
    watcher = fsWatch(messagesDir(), { recursive: true, persistent: false }, (_event, filename) => {
      if (!filename) return;
      if (!filename.toString().startsWith("chat.db")) return;
      kickScan();
    });
    watcher.on("error", (e) => log.warn("gateway.imessage.watch-err", { error: (e as Error).message }));
  } catch (e) {
    log.warn("gateway.imessage.watch-unavail", { error: (e as Error).message });
  }

  // Slow-poll safety net - covers the rare case where fs.watch drops
  // an event. Interval is generous; the watcher is doing the real work.
  const slowTick = async (): Promise<void> => {
    if (stopped) return;
    await scan();
    if (!stopped) slowTimer = setTimeout(slowTick, pollMs);
  };

  // First scan immediately (catches anything that arrived while we
  // were seeding state). Then let the watcher + slow poll take over.
  process.nextTick(() => { void scan(); });
  slowTimer = setTimeout(slowTick, pollMs);

  prewarmMessages(log);
  pruneStaging();

  log.info("gateway.imessage.ready", {
    profile,
    allowlist: allowlist.length,
    includeGroups,
    pollMs,
    watcher: Boolean(watcher),
  });

  return {
    kind: "imessage",
    send: async (chatId, text) => {
      const id = String(chatId);
      if (id.startsWith("group:")) {
        const guid = id.slice("group:".length);
        await sendGroupViaAppleScript(guid, text, log);
      } else {
        await sendViaAppleScript(id, text, log);
        verifyRecentSend(db, log, id);
      }
    },
    sendFile: async (chatId, filePath, caption) => {
      const id = String(chatId);
      if (id.startsWith("group:")) {
        throw new Error("sendFile to iMessage groups not yet supported");
      }
      await sendFileViaAppleScript(id, filePath, log);
      // AppleScript's file send does not take a caption. Send it as a
      // follow-up text message so the user sees "here's the image" /
      // "source: ..." in the thread.
      if (caption && caption.trim().length > 0) {
        await sendViaAppleScript(id, caption, log);
      }
    },
    startTyping: (_chatId) => {
      // Typing indicator is not reachable without Apple-private
      // entitlements on macOS 26+. See HANDOFF landmine 48. Returning
      // a no-op stop keeps the gateway plumbing consistent.
      return () => {};
    },
    stop: async () => {
      stopped = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (slowTimer) clearTimeout(slowTimer);
      if (watcher) try { watcher.close(); } catch { /* ignore */ }
      try { db.close(); } catch { /* ignore */ }
    },
  };
}

// Gateway helper: translate an InboundIMessage into a task row. Source
// format is `imessage:<handle>` for 1:1 and `imessage:group:<guid>`
// for groups, mirroring the outbound chatId convention so replyToSource
// round-trips cleanly.
export function insertIMessageTask(profile: string, msg: InboundIMessage): void {
  const db = openDb(profile);
  try {
    const body = msg.text || (msg.hasAttachment ? "[attachment]" : "");
    const source = msg.groupGuid
      ? `imessage:group:${msg.groupGuid}`
      : `imessage:${normalizeHandle(msg.handle)}`;
    const attachments = msg.attachmentPaths && msg.attachmentPaths.length > 0
      ? JSON.stringify(msg.attachmentPaths)
      : null;
    db.prepare("INSERT INTO tasks(created_at, priority, status, body, source, attachments) VALUES(?,?,?,?,?,?)").run(
      new Date().toISOString(),
      "normal",
      "pending",
      body,
      source,
      attachments,
    );
  } finally {
    db.close();
  }
}
