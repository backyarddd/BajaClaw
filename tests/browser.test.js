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

test("default args enable headless, caps vision+pdf+storage, viewport 1280x800", async () => {
  const { buildBrowserArgs } = await import("../dist/commands/browser.js");
  const args = buildBrowserArgs();
  assert.ok(args.includes("--headless"), "expected --headless in default args");
  const capsIdx = args.indexOf("--caps");
  assert.ok(capsIdx >= 0, "expected --caps flag");
  assert.equal(args[capsIdx + 1], "vision,pdf,storage");
  const vpIdx = args.indexOf("--viewport-size");
  assert.ok(vpIdx >= 0, "expected --viewport-size flag");
  assert.equal(args[vpIdx + 1], "1280x800");
});

test("--headed flag drops --headless", async () => {
  const { buildBrowserArgs } = await import("../dist/commands/browser.js");
  const args = buildBrowserArgs({ headed: true });
  assert.ok(!args.includes("--headless"), "headed mode should not include --headless");
});

test("empty caps list omits the --caps flag", async () => {
  const { buildBrowserArgs } = await import("../dist/commands/browser.js");
  const args = buildBrowserArgs({ caps: [] });
  assert.ok(!args.includes("--caps"), "empty caps should skip --caps");
});

test("custom caps + viewport flow through", async () => {
  const { buildBrowserArgs } = await import("../dist/commands/browser.js");
  const args = buildBrowserArgs({ caps: ["vision", "network"], viewport: "1920x1080" });
  const capsIdx = args.indexOf("--caps");
  assert.equal(args[capsIdx + 1], "vision,network");
  const vpIdx = args.indexOf("--viewport-size");
  assert.equal(args[vpIdx + 1], "1920x1080");
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

test("setup-browser skill documents default caps + headless mode", () => {
  const p = join(__dirname, "..", "skills", "setup-browser", "SKILL.md");
  const body = readFileSync(p, "utf8");
  assert.match(body, /vision/);
  assert.match(body, /pdf/);
  assert.match(body, /storage/);
  assert.match(body, /headless/);
  assert.match(body, /1280x800/);
});
