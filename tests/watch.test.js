import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("scanForAiComments picks up // AI: markers", async () => {
  const { scanForAiComments } = await import("../dist/commands/watch.js");
  const text = `function foo() {\n  // AI: rewrite this to use async/await\n  return 1;\n}`;
  const out = scanForAiComments(text);
  assert.equal(out.length, 1);
  assert.equal(out[0].instruction, "rewrite this to use async/await");
  assert.equal(out[0].line, 2);
  assert.equal(out[0].marker, "slash");
});

test("scanForAiComments picks up # AI: markers", async () => {
  const { scanForAiComments } = await import("../dist/commands/watch.js");
  const text = `def foo():\n  # AI: convert this to list comprehension\n  return [1,2,3]`;
  const out = scanForAiComments(text);
  assert.equal(out.length, 1);
  assert.equal(out[0].marker, "hash");
  assert.match(out[0].instruction, /list comprehension/);
});

test("scanForAiComments picks up HTML <!-- AI: --> markers", async () => {
  const { scanForAiComments } = await import("../dist/commands/watch.js");
  const text = `<div>\n  <!-- AI: add aria-label -->\n  <button>Go</button>\n</div>`;
  const out = scanForAiComments(text);
  assert.equal(out.length, 1);
  assert.equal(out[0].marker, "html");
  assert.equal(out[0].instruction, "add aria-label");
});

test("scanForAiComments picks up /* AI: */ block markers", async () => {
  const { scanForAiComments } = await import("../dist/commands/watch.js");
  const text = `int main() { /* AI: refactor into helper */ return 0; }`;
  const out = scanForAiComments(text);
  assert.equal(out.length, 1);
  assert.equal(out[0].marker, "cblock");
  assert.equal(out[0].instruction, "refactor into helper");
});

test("scanForAiComments picks up SQL -- AI: markers", async () => {
  const { scanForAiComments } = await import("../dist/commands/watch.js");
  const text = `SELECT * FROM users\n-- AI: add WHERE clause filtering to active=1`;
  const out = scanForAiComments(text);
  assert.equal(out.length, 1);
  assert.equal(out[0].marker, "dash");
});

test("scanForAiComments finds multiple markers and sorts by position", async () => {
  const { scanForAiComments } = await import("../dist/commands/watch.js");
  const text = `// AI: first\nconst x = 1;\n// AI: second\nconst y = 2;`;
  const out = scanForAiComments(text);
  assert.equal(out.length, 2);
  assert.equal(out[0].instruction, "first");
  assert.equal(out[1].instruction, "second");
  assert.ok(out[0].line < out[1].line);
});

test("scanForAiComments ignores comments without AI: prefix", async () => {
  const { scanForAiComments } = await import("../dist/commands/watch.js");
  const text = `// TODO: not mine\n# just a note\n/* regular block */`;
  const out = scanForAiComments(text);
  assert.equal(out.length, 0);
});

test("scanForAiComments does not match inside URL fragments", async () => {
  const { scanForAiComments } = await import("../dist/commands/watch.js");
  const text = `see https://example.com/page#AIsomething for context`;
  const out = scanForAiComments(text);
  assert.equal(out.length, 0);
});

test("scanForAiComments skips empty instructions", async () => {
  const { scanForAiComments } = await import("../dist/commands/watch.js");
  const text = `// AI:   \n# AI:\n<!-- AI:  -->`;
  const out = scanForAiComments(text);
  assert.equal(out.length, 0);
});

test("scanForAiComments handles inline trailing // AI:", async () => {
  const { scanForAiComments } = await import("../dist/commands/watch.js");
  const text = `const x = 1; // AI: rename to totalCount`;
  const out = scanForAiComments(text);
  assert.equal(out.length, 1);
  assert.equal(out[0].instruction, "rename to totalCount");
});

test("shouldIgnorePath filters node_modules + .git + build dirs", async () => {
  const { shouldIgnorePath } = await import("../dist/commands/watch.js");
  assert.equal(shouldIgnorePath("/a/node_modules/foo.ts"), true);
  assert.equal(shouldIgnorePath("/a/.git/HEAD"), true);
  assert.equal(shouldIgnorePath("/a/dist/cli.js"), true);
  assert.equal(shouldIgnorePath("/a/.venv/lib/python.py"), true);
  assert.equal(shouldIgnorePath("/a/src/cli.ts"), false);
});

test("shouldIgnorePath filters binary + media + lock extensions", async () => {
  const { shouldIgnorePath } = await import("../dist/commands/watch.js");
  for (const p of ["a.png", "a.pdf", "a.mp4", "a.lock", "a.min.js", "a.dylib"]) {
    assert.equal(shouldIgnorePath(p), true, `expected ignore: ${p}`);
  }
  assert.equal(shouldIgnorePath("src/app.ts"), false);
});

test("hashComment is stable + differs across path/line/text", async () => {
  const { hashComment } = await import("../dist/commands/watch.js");
  const a = hashComment("/a.ts", { line: 1, col: 0, marker: "slash", instruction: "do X" });
  const b = hashComment("/a.ts", { line: 1, col: 0, marker: "slash", instruction: "do X" });
  const c = hashComment("/a.ts", { line: 2, col: 0, marker: "slash", instruction: "do X" });
  const d = hashComment("/b.ts", { line: 1, col: 0, marker: "slash", instruction: "do X" });
  const e = hashComment("/a.ts", { line: 1, col: 0, marker: "slash", instruction: "do Y" });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
  assert.notEqual(a, e);
});

test("enumerateFiles returns a list and skips ignored dirs", async () => {
  const { enumerateFiles } = await import("../dist/commands/watch.js");
  const dir = mkdtempSync(join(tmpdir(), "bajaclaw-watch-"));
  try {
    writeFileSync(join(dir, "a.ts"), "// AI: thing\n");
    writeFileSync(join(dir, "b.md"), "plain");
    const nm = join(dir, "node_modules");
    const fs = await import("node:fs");
    fs.mkdirSync(nm);
    writeFileSync(join(nm, "c.ts"), "should be skipped");
    const files = enumerateFiles(dir);
    assert.ok(files.some((f) => f.endsWith("a.ts")));
    assert.ok(files.some((f) => f.endsWith("b.md")));
    assert.ok(!files.some((f) => f.includes("node_modules")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
