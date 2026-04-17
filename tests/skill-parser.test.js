import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Light smoke: ensure built-in skills parse — all three include triggers/description.
test("built-in skill frontmatters parse", async () => {
  const skillsDir = join(__dirname, "..", "skills");
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const entries = readdirSync(skillsDir).filter((e) => {
    const full = join(skillsDir, e);
    try { return statSync(full).isDirectory(); } catch { return false; }
  });
  assert.ok(entries.includes("daily-briefing"));
  assert.ok(entries.includes("email-triage"));
  assert.ok(entries.includes("web-research"));
  for (const name of entries) {
    const body = readFileSync(join(skillsDir, name, "SKILL.md"), "utf8");
    assert.match(body, /^---/);
    assert.match(body, /name:\s*\S+/);
    assert.match(body, /description:\s*\S+/);
  }
});
