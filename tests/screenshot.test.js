import { test } from "node:test";
import assert from "node:assert/strict";
import { platform } from "node:os";

test("defaultPath returns a .png under a writable dir", async () => {
  const { defaultPath } = await import("../dist/commands/screenshot.js");
  const p = defaultPath();
  assert.match(p, /\.png$/);
  assert.ok(p.length > 10);
});

test("defaultPath uses profileDir when profile provided", async () => {
  const { defaultPath } = await import("../dist/commands/screenshot.js");
  const p = defaultPath("test-profile");
  // Cross-platform separator: `/` on POSIX, `\` on Windows.
  assert.match(p, /profiles[\\/]test-profile[\\/]screenshots[\\/].*\.png$/);
});

test("takeScreenshot throws on unsupported platform", { skip: ["darwin", "linux", "win32"].includes(platform()) }, async () => {
  const { takeScreenshot } = await import("../dist/commands/screenshot.js");
  await assert.rejects(takeScreenshot({ quiet: true }), /unsupported platform/);
});

// Real capture requires Screen Recording permission, which CI and most
// test runners don't have. Set BAJACLAW_SMOKE_SCREENSHOT=1 on a machine
// with the permission granted to exercise this path.
test("takeScreenshot on darwin produces a real png", { skip: platform() !== "darwin" || !process.env.BAJACLAW_SMOKE_SCREENSHOT }, async () => {
  const { takeScreenshot } = await import("../dist/commands/screenshot.js");
  const { existsSync, statSync, unlinkSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const out = join(tmpdir(), `bajaclaw-smoke-${Date.now()}.png`);
  try {
    const path = await takeScreenshot({ output: out, quiet: true });
    assert.equal(path, out);
    assert.ok(existsSync(out), "png missing");
    // PNG header: 89 50 4e 47 0d 0a 1a 0a
    const { readFileSync } = await import("node:fs");
    const buf = readFileSync(out);
    assert.equal(buf[0], 0x89);
    assert.equal(buf[1], 0x50);
    assert.equal(buf[2], 0x4e);
    assert.equal(buf[3], 0x47);
    assert.ok(statSync(out).size > 1000, "png too small to be real");
  } finally {
    try { unlinkSync(out); } catch { /* ignore */ }
  }
});
