import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("image-gen skill exists and parses", () => {
  const p = join(__dirname, "..", "skills", "image-gen", "SKILL.md");
  assert.ok(existsSync(p), "skills/image-gen/SKILL.md missing");
  const body = readFileSync(p, "utf8");
  assert.match(body, /^---/);
  assert.match(body, /name: image-gen/);
  assert.match(body, /triggers:/);
  assert.match(body, /bajaclaw image/);
});

test("cmdAttach rejects missing files cleanly", async () => {
  const { cmdAttach } = await import("../dist/commands/attach.js");
  // Capture exit to avoid exiting the test runner.
  const origExit = process.exit;
  let exitCode = 0;
  // @ts-ignore
  process.exit = (code) => { exitCode = code ?? 0; throw new Error("exit"); };
  try {
    await cmdAttach("/tmp/definitely-does-not-exist.png", {}).catch(() => {});
  } finally {
    process.exit = origExit;
  }
  assert.equal(exitCode, 1);
});
