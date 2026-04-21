import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("appleDateToIso: nanosecond format (modern macOS)", async () => {
  const { appleDateToIso, APPLE_EPOCH_UNIX_SECONDS } = await import("../dist/channels/imessage.js");
  // 2023-06-15T12:00:00 UTC in Apple nanoseconds
  const unixSeconds = new Date("2023-06-15T12:00:00Z").getTime() / 1000;
  const appleSeconds = unixSeconds - APPLE_EPOCH_UNIX_SECONDS;
  const raw = appleSeconds * 1e9;
  assert.equal(appleDateToIso(raw), "2023-06-15T12:00:00.000Z");
});

test("appleDateToIso: second format (legacy macOS)", async () => {
  const { appleDateToIso, APPLE_EPOCH_UNIX_SECONDS } = await import("../dist/channels/imessage.js");
  const unixSeconds = new Date("2013-06-15T12:00:00Z").getTime() / 1000;
  const appleSeconds = unixSeconds - APPLE_EPOCH_UNIX_SECONDS;
  assert.equal(appleDateToIso(appleSeconds), "2013-06-15T12:00:00.000Z");
});

test("normalizeHandle: email passthrough (lowercased)", async () => {
  const { normalizeHandle } = await import("../dist/channels/imessage.js");
  assert.equal(normalizeHandle("User@iCloud.com"), "user@icloud.com");
  assert.equal(normalizeHandle("  test@gmail.com  "), "test@gmail.com");
});

test("normalizeHandle: US 10-digit prepends +1", async () => {
  const { normalizeHandle } = await import("../dist/channels/imessage.js");
  assert.equal(normalizeHandle("5551234567"), "+15551234567");
  assert.equal(normalizeHandle("(555) 123-4567"), "+15551234567");
  assert.equal(normalizeHandle("555.123.4567"), "+15551234567");
});

test("normalizeHandle: 11-digit prepends +", async () => {
  const { normalizeHandle } = await import("../dist/channels/imessage.js");
  assert.equal(normalizeHandle("15551234567"), "+15551234567");
});

test("normalizeHandle: existing E.164 untouched", async () => {
  const { normalizeHandle } = await import("../dist/channels/imessage.js");
  assert.equal(normalizeHandle("+447700900123"), "+447700900123");
});

test("isEmailHandle", async () => {
  const { isEmailHandle } = await import("../dist/channels/imessage.js");
  assert.equal(isEmailHandle("foo@bar.com"), true);
  assert.equal(isEmailHandle("+15551234567"), false);
});

test("buildSendAppleScript: escapes quotes and picks iMessage service", async () => {
  const { buildSendAppleScript } = await import("../dist/channels/imessage.js");
  const s = buildSendAppleScript("+15551234567", `hello "world"`);
  assert.match(s, /tell application "Messages"/);
  assert.match(s, /service type = iMessage/);
  assert.match(s, /participant "\+15551234567"/);
  // Embedded quotes escaped
  assert.match(s, /hello \\"world\\"/);
});

test("buildSendAppleScript: escapes backslashes", async () => {
  const { buildSendAppleScript } = await import("../dist/channels/imessage.js");
  const s = buildSendAppleScript("+15551234567", "back\\slash");
  // One backslash in input -> two in the emitted AppleScript string literal
  assert.match(s, /back\\\\slash/);
});

test("chatDbPath points at user Library/Messages", async () => {
  const { chatDbPath } = await import("../dist/channels/imessage.js");
  const p = chatDbPath();
  assert.match(p, /Library\/Messages\/chat\.db$/);
});

test("loadState returns zero default and saveState round-trips", async () => {
  const { loadState, saveState } = await import("../dist/channels/imessage.js");
  // Use a throwaway BAJACLAW_HOME so we don't stomp the real profile.
  const tmpHome = join(tmpdir(), "bajaclaw-imessage-test-" + Date.now());
  mkdirSync(join(tmpHome, "profiles", "t"), { recursive: true });
  const prev = process.env.BAJACLAW_HOME;
  process.env.BAJACLAW_HOME = tmpHome;
  try {
    assert.deepEqual(loadState("t"), { lastRowId: 0 });
    saveState("t", { lastRowId: 42 });
    assert.deepEqual(loadState("t"), { lastRowId: 42 });
  } finally {
    if (prev === undefined) delete process.env.BAJACLAW_HOME;
    else process.env.BAJACLAW_HOME = prev;
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("fetchNewMessages: reads from a fake chat.db-shaped SQLite", async () => {
  const { fetchNewMessages } = await import("../dist/channels/imessage.js");
  // Create a minimal chat.db-shaped database in tmp.
  const p = join(tmpdir(), "fake-chat-" + Date.now() + ".db");
  const db = new Database(p);
  db.exec(`
    CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
    CREATE TABLE message (
      ROWID INTEGER PRIMARY KEY,
      text TEXT,
      handle_id INTEGER,
      is_from_me INTEGER,
      cache_has_attachments INTEGER,
      date INTEGER,
      service TEXT
    );
    CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, room_name TEXT);
    CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);

    INSERT INTO handle VALUES (1, '+15551234567');
    INSERT INTO handle VALUES (2, 'friend@icloud.com');
    -- Three inbound from phone, one outbound (should be skipped), one group chat.
    INSERT INTO message VALUES (1, 'hello', 1, 0, 0, 0, 'iMessage');
    INSERT INTO message VALUES (2, 'world', 1, 0, 0, 0, 'iMessage');
    INSERT INTO message VALUES (3, 'my own msg', 1, 1, 0, 0, 'iMessage');
    INSERT INTO message VALUES (4, 'from group', 2, 0, 0, 0, 'iMessage');
    INSERT INTO message VALUES (5, 'from email', 2, 0, 0, 0, 'iMessage');

    INSERT INTO chat VALUES (100, NULL);
    INSERT INTO chat VALUES (101, 'chat123');
    INSERT INTO chat_message_join VALUES (100, 1);
    INSERT INTO chat_message_join VALUES (100, 2);
    INSERT INTO chat_message_join VALUES (100, 3);
    INSERT INTO chat_message_join VALUES (101, 4);
    INSERT INTO chat_message_join VALUES (100, 5);
  `);
  db.close();
  const ro = new Database(p, { readonly: true });
  const msgs = fetchNewMessages(ro, 0);
  // Expect: 1, 2, 5 (inbound 1:1 only). Row 3 is outbound (is_from_me),
  // row 4 is a group chat (room_name set).
  assert.deepEqual(msgs.map((m) => m.rowId), [1, 2, 5]);
  assert.equal(msgs[0].handle, "+15551234567");
  assert.equal(msgs[2].handle, "friend@icloud.com");
  // sinceRowId filter
  const after2 = fetchNewMessages(ro, 2);
  assert.deepEqual(after2.map((m) => m.rowId), [5]);
  ro.close();
  rmSync(p, { force: true });
});

test("ChannelKind type includes imessage - live channel list probe", () => {
  // Parse the types.ts source to confirm the union includes "imessage".
  const ts = readFileSync(join(__dirname, "..", "src", "types.ts"), "utf8");
  assert.match(ts, /kind:\s*"telegram"\s*\|\s*"discord"\s*\|\s*"imessage"/);
});

test("setup-imessage skill is platform-gated to darwin/macos", () => {
  const md = readFileSync(join(__dirname, "..", "skills", "setup-imessage", "SKILL.md"), "utf8");
  assert.match(md, /platforms:\s*\[macos,\s*darwin\]/);
  assert.match(md, /bajaclaw channel add/);
  assert.match(md, /Full Disk Access/);
});

test("typing helper binary is present and executable on macOS", async (t) => {
  if (process.platform !== "darwin") return t.skip("darwin-only");
  const bin = join(__dirname, "..", "helpers", "bajaclaw-imessage-helper");
  assert.ok(existsSync(bin), `missing helper: ${bin}`);
  const { statSync } = await import("node:fs");
  const st = statSync(bin);
  assert.ok(st.isFile());
  // Executable bit on owner at minimum
  assert.ok((st.mode & 0o100) !== 0, "helper not executable");
});

test("typing helper exits with usage on missing args", async (t) => {
  if (process.platform !== "darwin") return t.skip("darwin-only");
  const { spawnSync } = await import("node:child_process");
  const bin = join(__dirname, "..", "helpers", "bajaclaw-imessage-helper");
  const r = spawnSync(bin, [], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage/);
});

test("typing helper returns clean error for nonexistent chat (IMCore loads)", async (t) => {
  if (process.platform !== "darwin") return t.skip("darwin-only");
  const { spawnSync } = await import("node:child_process");
  const bin = join(__dirname, "..", "helpers", "bajaclaw-imessage-helper");
  // A handle that cannot exist as a chat - exit 4 proves IMCore loaded,
  // IMChatRegistry resolved, and the code path reached the "no chat"
  // branch without crashing.
  const r = spawnSync(bin, ["start", "+19999999999"], { encoding: "utf8" });
  assert.equal(r.status, 4);
  assert.match(r.stderr, /no existing chat/);
});

test("resolveTypingHelperPath finds the shipped binary", async (t) => {
  if (process.platform !== "darwin") return t.skip("darwin-only");
  const { resolveTypingHelperPath } = await import("../dist/channels/imessage.js");
  const p = resolveTypingHelperPath();
  assert.ok(p, "helper path should resolve");
  assert.match(p, /bajaclaw-imessage-helper$/);
});

test("sendTypingIndicator returns ok:false for nonexistent chat with graceful exit code", async (t) => {
  if (process.platform !== "darwin") return t.skip("darwin-only");
  const { sendTypingIndicator } = await import("../dist/channels/imessage.js");
  const r = sendTypingIndicator("+19999999999", true);
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 4);
  assert.match(r.error || "", /no existing chat/);
});

test("sendTypingIndicator returns unsupported-platform on non-darwin", async (t) => {
  // We can't change process.platform at runtime, but we can assert the
  // code path exists by reading the compiled dist.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(join(__dirname, "..", "dist", "channels", "imessage.js"), "utf8");
  assert.match(src, /unsupported-platform/);
});

test("universal Mach-O: helper contains both arm64 and x86_64 slices", async (t) => {
  if (process.platform !== "darwin") return t.skip("darwin-only");
  const { spawnSync } = await import("node:child_process");
  const bin = join(__dirname, "..", "helpers", "bajaclaw-imessage-helper");
  const r = spawnSync("lipo", ["-info", bin], { encoding: "utf8" });
  if (r.status !== 0) return t.skip("lipo unavailable");
  assert.match(r.stdout, /arm64/);
  assert.match(r.stdout, /x86_64/);
});
