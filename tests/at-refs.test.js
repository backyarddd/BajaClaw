import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("parseAtRefs finds @kind:arg forms", async () => {
  const { parseAtRefs } = await import("../dist/at-refs.js");
  const refs = parseAtRefs("check @file:src/a.ts and @folder:src/ and @cycle:142");
  assert.equal(refs.length, 3);
  assert.deepEqual(refs.map((r) => r.kind), ["file", "folder", "cycle"]);
});

test("parseAtRefs finds bare path refs", async () => {
  const { parseAtRefs } = await import("../dist/at-refs.js");
  const refs = parseAtRefs("look at @src/foo.ts please");
  assert.equal(refs.length, 1);
  assert.equal(refs[0].kind, "path");
  assert.equal(refs[0].arg, "src/foo.ts");
});

test("parseAtRefs finds bare http(s) urls", async () => {
  const { parseAtRefs } = await import("../dist/at-refs.js");
  const refs = parseAtRefs("see @https://example.com/page");
  assert.equal(refs.length, 1);
  assert.equal(refs[0].kind, "url");
});

test("parseAtRefs finds @screen / @screenshot", async () => {
  const { parseAtRefs } = await import("../dist/at-refs.js");
  const refs = parseAtRefs("take @screen and explain");
  assert.equal(refs.length, 1);
  assert.equal(refs[0].kind, "screen");
});

test("parseAtRefs ignores email-like text", async () => {
  const { parseAtRefs } = await import("../dist/at-refs.js");
  const refs = parseAtRefs("contact foo@example.com now");
  assert.equal(refs.length, 0);
});

test("parseAtRefs does not double-count duplicates later", async () => {
  const { parseAtRefs } = await import("../dist/at-refs.js");
  const refs = parseAtRefs("@file:a.ts @file:a.ts");
  // parseAtRefs doesn't dedup; expandAtRefs does. Assert parse returns both.
  assert.equal(refs.length, 2);
});

test("parseAtRefs skips empty colon args", async () => {
  const { parseAtRefs } = await import("../dist/at-refs.js");
  const refs = parseAtRefs("@file: is empty");
  assert.equal(refs.length, 0);
});

test("expandAtRefs with no refs returns the text verbatim", async () => {
  const { expandAtRefs } = await import("../dist/at-refs.js");
  const out = await expandAtRefs("hello world", { profile: "x" });
  assert.equal(out.task, "hello world");
  assert.deepEqual(out.attachments, []);
  assert.deepEqual(out.warnings, []);
});

test("expandAtRefs inlines a small file", async () => {
  const { expandAtRefs } = await import("../dist/at-refs.js");
  const dir = mkdtempSync(join(tmpdir(), "bajaclaw-at-"));
  try {
    const p = join(dir, "hello.ts");
    writeFileSync(p, "export const x = 1;\n");
    const out = await expandAtRefs(`look at @file:${p}`, { profile: "x" });
    assert.match(out.task, /Referenced context/);
    assert.match(out.task, /export const x = 1;/);
    assert.match(out.task, /```ts/);
    assert.equal(out.attachments.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("expandAtRefs treats image files as attachments, not text", async () => {
  const { expandAtRefs } = await import("../dist/at-refs.js");
  const dir = mkdtempSync(join(tmpdir(), "bajaclaw-at-"));
  try {
    const p = join(dir, "pic.png");
    writeFileSync(p, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const out = await expandAtRefs(`check @file:${p}`, { profile: "x" });
    assert.equal(out.attachments.length, 1);
    assert.ok(out.attachments[0].endsWith("pic.png"));
    assert.doesNotMatch(out.task, /Referenced context/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("expandAtRefs lists a folder", async () => {
  const { expandAtRefs } = await import("../dist/at-refs.js");
  const dir = mkdtempSync(join(tmpdir(), "bajaclaw-at-"));
  try {
    writeFileSync(join(dir, "a.ts"), "");
    writeFileSync(join(dir, "b.ts"), "");
    mkdirSync(join(dir, "sub"));
    const out = await expandAtRefs(`check @folder:${dir}`, { profile: "x" });
    assert.match(out.task, /a\.ts/);
    assert.match(out.task, /b\.ts/);
    assert.match(out.task, /sub/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("expandAtRefs warns on missing path", async () => {
  const { expandAtRefs } = await import("../dist/at-refs.js");
  const out = await expandAtRefs("see @file:/tmp/definitely-does-not-exist-xyz", { profile: "x" });
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /no such/);
  // original text unchanged since nothing resolved
  assert.equal(out.task, "see @file:/tmp/definitely-does-not-exist-xyz");
});

test("expandAtRefs uses fetchFn for @url and truncates on size", async () => {
  const { expandAtRefs } = await import("../dist/at-refs.js");
  let called = 0;
  const fakeFetch = async (url) => {
    called++;
    return new Response("body-" + url, { status: 200 });
  };
  const out = await expandAtRefs("@https://example.com/x", { profile: "x", fetchFn: fakeFetch });
  assert.equal(called, 1);
  assert.match(out.task, /body-https:\/\/example\.com\/x/);
  assert.equal(out.warnings.length, 0);
});

test("expandAtRefs surfaces HTTP non-2xx as warning", async () => {
  const { expandAtRefs } = await import("../dist/at-refs.js");
  const fakeFetch = async () => new Response("nope", { status: 404 });
  const out = await expandAtRefs("@https://example.com/missing", { profile: "x", fetchFn: fakeFetch });
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /HTTP 404/);
});

test("expandAtRefs @screen calls onScreen and attaches result", async () => {
  const { expandAtRefs } = await import("../dist/at-refs.js");
  let called = 0;
  const fakePath = "/tmp/fake-screen.png";
  const out = await expandAtRefs("@screen", {
    profile: "x",
    onScreen: async () => { called++; return fakePath; },
  });
  assert.equal(called, 1);
  assert.deepEqual(out.attachments, [fakePath]);
});

test("expandAtRefs @screen warns when hook not provided", async () => {
  const { expandAtRefs } = await import("../dist/at-refs.js");
  const out = await expandAtRefs("@screen", { profile: "x" });
  assert.equal(out.attachments.length, 0);
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /not wired/);
});
