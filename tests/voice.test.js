import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("voice skill exists and parses", () => {
  const p = join(__dirname, "..", "skills", "voice", "SKILL.md");
  assert.ok(existsSync(p), "skills/voice/SKILL.md missing");
  const body = readFileSync(p, "utf8");
  assert.match(body, /^---/);
  assert.match(body, /name: voice/);
  assert.match(body, /triggers:/);
  assert.match(body, /bajaclaw tts/);
  assert.match(body, /bajaclaw transcribe/);
});

test("transcribe throws on missing file", async () => {
  const { transcribe } = await import("../dist/voice.js");
  await assert.rejects(transcribe("/tmp/definitely-missing-audio.mp3"), /file not found/);
});

test("transcribe throws on missing OPENAI_API_KEY", async () => {
  const { transcribe } = await import("../dist/voice.js");
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "bajaclaw-voice-"));
  const p = join(dir, "fake.mp3");
  writeFileSync(p, Buffer.from([0x49, 0x44, 0x33]));
  const orig = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await assert.rejects(transcribe(p), /OPENAI_API_KEY is not set/);
  } finally {
    if (orig) process.env.OPENAI_API_KEY = orig;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("synthesize without any key or macOS fallback throws a clear error", async () => {
  const { synthesize } = await import("../dist/voice.js");
  const orig1 = process.env.OPENAI_API_KEY;
  const orig2 = process.env.ELEVENLABS_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  try {
    // On macOS the system fallback kicks in, so this assertion only
    // holds on linux/windows. We only assert the no-provider path on
    // non-darwin runners.
    const { platform } = await import("node:os");
    if (platform() !== "darwin") {
      await assert.rejects(synthesize("hello", "/tmp/out.mp3"), /no TTS provider/);
    } else {
      assert.ok(true, "skipped: macOS has system fallback");
    }
  } finally {
    if (orig1) process.env.OPENAI_API_KEY = orig1;
    if (orig2) process.env.ELEVENLABS_API_KEY = orig2;
  }
});
