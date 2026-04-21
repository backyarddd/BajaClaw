import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("BROWSER_MCP_SPEC points at @playwright/mcp via npx", async () => {
  const { BROWSER_MCP_SPEC, BROWSER_MCP_NAME } = await import("../dist/commands/browser.js");
  assert.equal(BROWSER_MCP_NAME, "playwright");
  assert.equal(BROWSER_MCP_SPEC.command, "npx");
  assert.ok(BROWSER_MCP_SPEC.args.includes("@playwright/mcp@latest"));
});

test("setup-browser skill exists and parses", () => {
  const p = join(__dirname, "..", "skills", "setup-browser", "SKILL.md");
  assert.ok(existsSync(p), "skills/setup-browser/SKILL.md missing");
  const body = readFileSync(p, "utf8");
  assert.match(body, /^---/);
  assert.match(body, /name: setup-browser/);
  assert.match(body, /triggers:/);
  assert.match(body, /bajaclaw browser enable/);
});

test("setup-browser skill has the NEVER-ASK preamble", () => {
  const p = join(__dirname, "..", "skills", "setup-browser", "SKILL.md");
  const body = readFileSync(p, "utf8");
  assert.match(body, /never ask/i);
  assert.match(body, /non-negotiable/i);
});
