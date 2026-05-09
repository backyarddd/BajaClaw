import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, statSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// resolveAnthropicKey + saveAnthropicKey + loadSavedAnthropicKey read
// and write through userApiConfigPath(), which derives from
// bajaclawHome(). bajaclawHome respects BAJACLAW_HOME, so we point it
// at a fresh tmp dir per test to keep them hermetic.

function withTmpHome(fn) {
  const home = mkdtempSync(join(tmpdir(), "bajaclaw-auth-"));
  const prevHome = process.env.BAJACLAW_HOME;
  const prevKey = process.env.ANTHROPIC_API_KEY;
  process.env.BAJACLAW_HOME = home;
  delete process.env.ANTHROPIC_API_KEY;
  return {
    home,
    cleanup() {
      if (prevHome === undefined) delete process.env.BAJACLAW_HOME;
      else process.env.BAJACLAW_HOME = prevHome;
      if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prevKey;
      rmSync(home, { recursive: true, force: true });
    },
    run: fn,
  };
}

test("resolveAnthropicKey: env wins over saved file", async () => {
  const ctx = withTmpHome();
  try {
    const { saveAnthropicKey, resolveAnthropicKey } = await import("../src/api/anthropic-auth.ts");
    saveAnthropicKey("sk-ant-saved-key");
    process.env.ANTHROPIC_API_KEY = "sk-ant-env-key";
    const r = await resolveAnthropicKey({ autoSetup: false });
    assert.equal(r?.source, "env");
    assert.equal(r?.key, "sk-ant-env-key");
  } finally { ctx.cleanup(); }
});

test("resolveAnthropicKey: falls back to saved file when env unset", async () => {
  const ctx = withTmpHome();
  try {
    const { saveAnthropicKey, resolveAnthropicKey } = await import("../src/api/anthropic-auth.ts");
    saveAnthropicKey("sk-ant-saved-key");
    const r = await resolveAnthropicKey({ autoSetup: false });
    assert.equal(r?.source, "saved");
    assert.equal(r?.key, "sk-ant-saved-key");
  } finally { ctx.cleanup(); }
});

test("resolveAnthropicKey: returns null when neither env nor file is present (non-TTY)", async () => {
  const ctx = withTmpHome();
  try {
    const { resolveAnthropicKey } = await import("../src/api/anthropic-auth.ts");
    // autoSetup ignored on non-TTY; tests run non-TTY.
    const r = await resolveAnthropicKey({ autoSetup: true });
    assert.equal(r, null);
  } finally { ctx.cleanup(); }
});

test("saveAnthropicKey: writes JSON, preserves other fields, chmod 600 on POSIX", async () => {
  const ctx = withTmpHome();
  try {
    const userApiConfigPath = () => join(ctx.home, "api.json");
    const { saveAnthropicKey } = await import("../src/api/anthropic-auth.ts");
    const p = userApiConfigPath();
    // Pre-existing api.json with unrelated fields
    writeFileSync(p, JSON.stringify({ apiKey: "inbound-bearer", port: 9000 }));
    saveAnthropicKey("sk-ant-new");
    const cfg = JSON.parse(readFileSync(p, "utf8"));
    assert.equal(cfg.anthropicApiKey, "sk-ant-new");
    assert.equal(cfg.apiKey, "inbound-bearer");
    assert.equal(cfg.port, 9000);
    if (process.platform !== "win32") {
      const mode = statSync(p).mode & 0o777;
      assert.equal(mode, 0o600, `expected 0600, got 0${mode.toString(8)}`);
    }
  } finally { ctx.cleanup(); }
});

test("loadSavedAnthropicKey: returns null when api.json is missing or malformed", async () => {
  const ctx = withTmpHome();
  try {
    const { loadSavedAnthropicKey } = await import("../src/api/anthropic-auth.ts");
    const userApiConfigPath = () => join(ctx.home, "api.json");
    assert.equal(loadSavedAnthropicKey(), null);
    writeFileSync(userApiConfigPath(), "{ not valid json");
    assert.equal(loadSavedAnthropicKey(), null);
    writeFileSync(userApiConfigPath(), JSON.stringify({ anthropicApiKey: "" }));
    assert.equal(loadSavedAnthropicKey(), null);
  } finally { ctx.cleanup(); }
});
