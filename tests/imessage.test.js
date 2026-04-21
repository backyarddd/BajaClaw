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
  assert.match(s, /with timeout of 30 seconds/);
  assert.match(s, /hello \\"world\\"/);
});

test("buildSendAppleScript: escapes backslashes", async () => {
  const { buildSendAppleScript } = await import("../dist/channels/imessage.js");
  const s = buildSendAppleScript("+15551234567", "back\\slash");
  assert.match(s, /back\\\\slash/);
});

test("buildGroupSendAppleScript: uses text chat id form", async () => {
  const { buildGroupSendAppleScript } = await import("../dist/channels/imessage.js");
  const s = buildGroupSendAppleScript("iMessage;+;chatDEADBEEF", "hi group");
  assert.match(s, /tell application "Messages"/);
  assert.match(s, /text chat id "iMessage;\+;chatDEADBEEF"/);
  assert.match(s, /with timeout of 30 seconds/);
  assert.match(s, /send "hi group"/);
});

test("buildSendFileAppleScript: uses POSIX file form", async () => {
  const { buildSendFileAppleScript } = await import("../dist/channels/imessage.js");
  const s = buildSendFileAppleScript("+15551234567", "/tmp/pic.jpg");
  assert.match(s, /POSIX file "\/tmp\/pic\.jpg"/);
  assert.match(s, /send f to targetBuddy/);
  assert.match(s, /with timeout of 60 seconds/);
});

test("chatDbPath points at user Library/Messages", async (t) => {
  if (process.platform !== "darwin") return t.skip("darwin-only adapter");
  const { chatDbPath } = await import("../dist/channels/imessage.js");
  assert.match(chatDbPath(), /Library\/Messages\/chat\.db$/);
});

test("loadState returns zero default and saveState round-trips", async () => {
  const { loadState, saveState } = await import("../dist/channels/imessage.js");
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

// Built from a real macOS 26.2 chat.db row: the short-length case.
// Pattern: "NSString" ... 0x84 0x01 0x2B 0x05 "Hello" ...
const ATTRIBUTED_HEX_SHORT = (
  "040B73747265616D747970656481E803840140848484124E5341747472696275746564" +
  "537472696E67008484084E534F626A656374008592848484084E53537472696E670194" +
  "84012B0548656C6C6F86840269490105928484840C4E5344696374696F6E6172790094" +
  "84016901928496961D5F5F6B494D4D6573736167655061727441747472696275746545" +
  "614D6586"
);

// Long-length case: the same header + class graph then
//   84 01 2B 81 C8 00 <200 bytes of text>
// (uint16 little-endian = 0x00C8 = 200). Content filled with spaces.
function buildLongAttributedHex(text) {
  assert.ok(text.length > 127 && text.length < 65536, "test fixture requires 128..65535 chars");
  const header = Buffer.from(
    "040B73747265616D747970656481E803840140848484124E5341747472696275746564" +
    "537472696E67008484084E534F626A656374008592848484084E53537472696E670194" +
    "84012B81",
    "hex",
  );
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(text.length, 0);
  return Buffer.concat([header, lenBuf, Buffer.from(text, "utf8")]);
}

test("decodeAttributedBody: short string (single-byte length)", async () => {
  const { decodeAttributedBody } = await import("../dist/channels/imessage.js");
  const buf = Buffer.from(ATTRIBUTED_HEX_SHORT, "hex");
  assert.equal(decodeAttributedBody(buf), "Hello");
});

test("decodeAttributedBody: long string (0x81 uint16 length)", async () => {
  const { decodeAttributedBody } = await import("../dist/channels/imessage.js");
  const body = "A".repeat(200);
  const buf = buildLongAttributedHex(body);
  assert.equal(decodeAttributedBody(buf), body);
});

test("decodeAttributedBody: UTF-8 multi-byte string round-trips", async () => {
  const { decodeAttributedBody } = await import("../dist/channels/imessage.js");
  const body = "héllo · wörld 🌮 你好";
  const utf8 = Buffer.from(body, "utf8");
  // Force the long-length path so we don't have to worry about single-byte fit.
  const header = Buffer.from(
    "040B73747265616D747970656481E803840140848484124E5341747472696275746564" +
    "537472696E67008484084E534F626A656374008592848484084E53537472696E670194" +
    "84012B81",
    "hex",
  );
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(utf8.length, 0);
  const buf = Buffer.concat([header, lenBuf, utf8]);
  assert.equal(decodeAttributedBody(buf), body);
});

test("decodeAttributedBody: returns null for garbage / too-short input", async () => {
  const { decodeAttributedBody } = await import("../dist/channels/imessage.js");
  assert.equal(decodeAttributedBody(null), null);
  assert.equal(decodeAttributedBody(Buffer.alloc(0)), null);
  assert.equal(decodeAttributedBody(Buffer.from([1, 2, 3])), null);
  // Has NSString marker but no length-prefixed value after.
  assert.equal(decodeAttributedBody(Buffer.from("NSString")), null);
});

test("messageText: prefers the text column when present", async () => {
  const { messageText } = await import("../dist/channels/imessage.js");
  const buf = Buffer.from(ATTRIBUTED_HEX_SHORT, "hex");
  assert.equal(messageText("explicit text", buf), "explicit text");
});

test("messageText: falls back to attributedBody when text is null", async () => {
  const { messageText } = await import("../dist/channels/imessage.js");
  const buf = Buffer.from(ATTRIBUTED_HEX_SHORT, "hex");
  assert.equal(messageText(null, buf), "Hello");
  assert.equal(messageText("", buf), "Hello");
});

test("messageText: returns empty string when both inputs miss", async () => {
  const { messageText } = await import("../dist/channels/imessage.js");
  assert.equal(messageText(null, null), "");
  assert.equal(messageText("", Buffer.from("garbage")), "");
});

// chat.db fake: covers the schema the new adapter reads (style, guid,
// attributedBody, item_type, is_system_message, message_attachment_join,
// attachment). Row 1 is plain-text inbound, row 2 is outbound (skipped),
// row 3 is a group chat message (included only when includeGroups=true),
// row 4 is an inbound row with NULL text but a decodable attributedBody,
// row 5 is inbound with an attachment.
function seedChatDb(p) {
  const db = new Database(p);
  db.exec(`
    CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
    CREATE TABLE message (
      ROWID INTEGER PRIMARY KEY,
      guid TEXT,
      text TEXT,
      attributedBody BLOB,
      handle_id INTEGER,
      is_from_me INTEGER,
      cache_has_attachments INTEGER,
      date INTEGER,
      service TEXT,
      item_type INTEGER DEFAULT 0,
      is_system_message INTEGER DEFAULT 0
    );
    CREATE TABLE chat (
      ROWID INTEGER PRIMARY KEY,
      guid TEXT,
      style INTEGER,
      room_name TEXT,
      display_name TEXT
    );
    CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
    CREATE TABLE attachment (
      ROWID INTEGER PRIMARY KEY,
      guid TEXT,
      filename TEXT,
      mime_type TEXT,
      uti TEXT
    );
    CREATE TABLE message_attachment_join (message_id INTEGER, attachment_id INTEGER);

    INSERT INTO handle VALUES (1, '+15551234567');
    INSERT INTO handle VALUES (2, 'friend@icloud.com');

    INSERT INTO message VALUES (1, 'g1', 'hello',       NULL,                          1, 0, 0, 0, 'iMessage', 0, 0);
    INSERT INTO message VALUES (2, 'g2', 'my own msg',  NULL,                          1, 1, 0, 0, 'iMessage', 0, 0);
    INSERT INTO message VALUES (3, 'g3', 'from group',  NULL,                          2, 0, 0, 0, 'iMessage', 0, 0);
    INSERT INTO message VALUES (4, 'g4', NULL,          X'${ATTRIBUTED_HEX_SHORT}',    2, 0, 0, 0, 'iMessage', 0, 0);
    INSERT INTO message VALUES (5, 'g5', 'pic!',        NULL,                          1, 0, 1, 0, 'iMessage', 0, 0);

    INSERT INTO chat VALUES (100, 'any;-;+15551234567',   45, NULL,       NULL);
    INSERT INTO chat VALUES (101, 'iMessage;+;chatXYZ',   43, 'chatXYZ',  'crew');
    INSERT INTO chat_message_join VALUES (100, 1);
    INSERT INTO chat_message_join VALUES (100, 2);
    INSERT INTO chat_message_join VALUES (101, 3);
    INSERT INTO chat_message_join VALUES (100, 4);
    INSERT INTO chat_message_join VALUES (100, 5);

    INSERT INTO attachment VALUES (1, 'att1', '/does/not/exist.jpg', 'image/jpeg', 'public.jpeg');
    INSERT INTO message_attachment_join VALUES (5, 1);
  `);
  db.close();
}

test("fetchNewMessages: skips outbound, groups, and rows with no recoverable content", async () => {
  const { fetchNewMessages } = await import("../dist/channels/imessage.js");
  const p = join(tmpdir(), "fake-chat-" + Date.now() + ".db");
  seedChatDb(p);
  const ro = new Database(p, { readonly: true });
  const msgs = fetchNewMessages(ro, 0);
  assert.deepEqual(msgs.map((m) => m.rowId), [1, 4, 5]);
  assert.equal(msgs[0].handle, "+15551234567");
  assert.equal(msgs[0].text, "hello");
  assert.equal(msgs[1].handle, "friend@icloud.com");
  assert.equal(msgs[1].text, "Hello", "should recover text from attributedBody");
  assert.equal(msgs[2].hasAttachment, true);
  // sinceRowId filter
  assert.deepEqual(fetchNewMessages(ro, 4).map((m) => m.rowId), [5]);
  ro.close();
  rmSync(p, { force: true });
});

test("fetchNewMessages: includes groups when opted in, with groupGuid set", async () => {
  const { fetchNewMessages } = await import("../dist/channels/imessage.js");
  const p = join(tmpdir(), "fake-chat-groups-" + Date.now() + ".db");
  seedChatDb(p);
  const ro = new Database(p, { readonly: true });
  const msgs = fetchNewMessages(ro, 0, { includeGroups: true });
  assert.deepEqual(msgs.map((m) => m.rowId), [1, 3, 4, 5]);
  const group = msgs.find((m) => m.rowId === 3);
  assert.ok(group);
  assert.equal(group.groupGuid, "iMessage;+;chatXYZ");
  assert.equal(group.groupName, "crew");
  ro.close();
  rmSync(p, { force: true });
});

test("stageAttachment: copies source into ~/Pictures/bajaclaw-staging", async () => {
  const { stageAttachment, stagingDir } = await import("../dist/channels/imessage.js");
  const src = join(tmpdir(), "stage-src-" + Date.now() + ".txt");
  writeFileSync(src, "staged-fixture");
  try {
    const staged = stageAttachment(src);
    assert.ok(staged.startsWith(stagingDir()));
    assert.ok(existsSync(staged));
    assert.equal(readFileSync(staged, "utf8"), "staged-fixture");
    rmSync(staged, { force: true });
  } finally {
    rmSync(src, { force: true });
  }
});

test("insertIMessageTask: groups land with imessage:group:<guid> source", async () => {
  const { insertIMessageTask } = await import("../dist/channels/imessage.js");
  const { openDb } = await import("../dist/db.js");
  const tmpHome = join(tmpdir(), "bajaclaw-im-task-" + Date.now());
  mkdirSync(join(tmpHome, "profiles", "t"), { recursive: true });
  const prev = process.env.BAJACLAW_HOME;
  process.env.BAJACLAW_HOME = tmpHome;
  try {
    // Insert a 1:1 and a group task; verify source format on both.
    insertIMessageTask("t", {
      rowId: 1, guid: "g1", handle: "+15551234567", text: "hi",
      hasAttachment: false, dateIso: "2026-01-01T00:00:00Z", service: "iMessage",
    });
    insertIMessageTask("t", {
      rowId: 2, guid: "g2", handle: "someone@icloud.com", text: "group hi",
      hasAttachment: false, dateIso: "2026-01-01T00:00:00Z", service: "iMessage",
      groupGuid: "iMessage;+;chatABC", groupName: "crew",
    });
    const db = openDb("t");
    const rows = db.prepare("SELECT source, body FROM tasks ORDER BY id ASC").all();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].source, "imessage:+15551234567");
    assert.equal(rows[1].source, "imessage:group:iMessage;+;chatABC");
    db.close();
  } finally {
    if (prev === undefined) delete process.env.BAJACLAW_HOME;
    else process.env.BAJACLAW_HOME = prev;
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("ChannelKind type includes imessage - live channel list probe", () => {
  const ts = readFileSync(join(__dirname, "..", "src", "types.ts"), "utf8");
  assert.match(ts, /kind:\s*"telegram"\s*\|\s*"discord"\s*\|\s*"imessage"/);
});

test("setup-imessage skill is platform-gated to darwin/macos", () => {
  const md = readFileSync(join(__dirname, "..", "skills", "setup-imessage", "SKILL.md"), "utf8");
  assert.match(md, /platforms:\s*\[macos,\s*darwin\]/);
  assert.match(md, /bajaclaw channel add/);
  assert.match(md, /Full Disk Access/);
});

test("typing indicator is intentionally a no-op (HANDOFF landmine 48)", async () => {
  const src = readFileSync(join(__dirname, "..", "src", "channels", "imessage.ts"), "utf8");
  assert.match(src, /Typing indicator is not reachable/);
  // And the dead helper exports are gone.
  assert.doesNotMatch(src, /sendTypingIndicator/);
  assert.doesNotMatch(src, /resolveTypingHelperPath/);
});
