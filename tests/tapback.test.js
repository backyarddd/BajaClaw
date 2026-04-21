import { test } from "node:test";
import assert from "node:assert/strict";

test("TAPBACK_TYPES has the documented six reactions", async () => {
  const { TAPBACK_TYPES, TAPBACK_NAMES } = await import("../dist/channels/imessage.js");
  assert.equal(TAPBACK_TYPES.love, 2000);
  assert.equal(TAPBACK_TYPES.like, 2001);
  assert.equal(TAPBACK_TYPES.dislike, 2002);
  assert.equal(TAPBACK_TYPES.laugh, 2003);
  assert.equal(TAPBACK_TYPES.emphasize, 2004);
  assert.equal(TAPBACK_TYPES.question, 2005);
  assert.equal(TAPBACK_NAMES[2000], "love");
  assert.equal(TAPBACK_NAMES[2005], "question");
});

test("buildTapbackAppleScript escapes quotes in the guid + handle", async () => {
  const { buildTapbackAppleScript } = await import("../dist/channels/imessage.js");
  const s = buildTapbackAppleScript("alice@icloud.com", `p:0/aaa"bbb`, 2001);
  assert.match(s, /tell application "Messages"/);
  assert.match(s, /associated message type:2001/);
  // Quote in guid must be escaped.
  assert.match(s, /aaa\\"bbb/);
});

test("buildTapbackAppleScript wraps in `with timeout` for tahoe-flake mitigation", async () => {
  const { buildTapbackAppleScript } = await import("../dist/channels/imessage.js");
  const s = buildTapbackAppleScript("+15555555555", "abc", 2003);
  assert.match(s, /with timeout of 30 seconds/);
  assert.match(s, /end timeout/);
});
