// Voice plumbing - speech-to-text (whisper) and text-to-speech (tts).
//
// Providers:
//   transcribe: OpenAI whisper-1 (OPENAI_API_KEY). No local fallback -
//               whisper.cpp is out of scope for v0.19.
//   synthesize: OpenAI tts-1 (OPENAI_API_KEY) or ElevenLabs
//               (ELEVENLABS_API_KEY), with macOS `say` + afconvert as a
//               zero-key fallback for local playback.
//
// Both functions throw on missing keys/tools so callers can surface a
// clean error. The CLI wrappers in src/commands/voice.ts do the
// user-facing message.

import { readFileSync, writeFileSync, existsSync, createReadStream } from "node:fs";
import { spawnSync } from "node:child_process";
import { platform, tmpdir } from "node:os";
import { join, basename, extname, dirname } from "node:path";
import { ensureDir } from "./paths.js";

export type TranscribeProvider = "openai";
export type SynthesizeProvider = "openai" | "elevenlabs" | "system";

export interface TranscribeOpts {
  provider?: TranscribeProvider;
  model?: string;
  language?: string;
}

export interface TranscribeResult {
  text: string;
  language?: string;
  durationSec?: number;
}

export async function transcribe(path: string, opts: TranscribeOpts = {}): Promise<TranscribeResult> {
  if (!existsSync(path)) throw new Error(`transcribe: file not found: ${path}`);
  const provider = opts.provider ?? "openai";
  if (provider === "openai") return transcribeOpenAI(path, opts);
  throw new Error(`transcribe: unknown provider '${provider}'`);
}

async function transcribeOpenAI(path: string, opts: TranscribeOpts): Promise<TranscribeResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("transcribe: OPENAI_API_KEY is not set");
  }
  const form = new FormData();
  const buf = readFileSync(path);
  const mime = guessAudioMime(path);
  form.append("file", new Blob([buf], { type: mime }), basename(path));
  form.append("model", opts.model ?? "whisper-1");
  if (opts.language) form.append("language", opts.language);
  form.append("response_format", "verbose_json");

  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`OpenAI transcribe HTTP ${r.status}: ${body.slice(0, 300)}`);
  }
  const json = await r.json() as { text?: string; language?: string; duration?: number };
  return { text: json.text ?? "", language: json.language, durationSec: json.duration };
}

export interface SynthesizeOpts {
  provider?: SynthesizeProvider;
  voice?: string;
  model?: string;
}

export async function synthesize(text: string, outPath: string, opts: SynthesizeOpts = {}): Promise<string> {
  ensureDir(dirname(outPath));
  const provider = opts.provider ?? resolveTtsProvider();
  if (!provider) {
    throw new Error("synthesize: no TTS provider available. Set OPENAI_API_KEY or ELEVENLABS_API_KEY (or use --provider system on macOS).");
  }
  if (provider === "openai") return synthesizeOpenAI(text, outPath, opts);
  if (provider === "elevenlabs") return synthesizeElevenLabs(text, outPath, opts);
  if (provider === "system") return synthesizeSystem(text, outPath);
  throw new Error(`synthesize: unknown provider '${provider}'`);
}

function resolveTtsProvider(): SynthesizeProvider | null {
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ELEVENLABS_API_KEY) return "elevenlabs";
  if (platform() === "darwin") return "system";
  return null;
}

async function synthesizeOpenAI(text: string, outPath: string, opts: SynthesizeOpts): Promise<string> {
  if (!process.env.OPENAI_API_KEY) throw new Error("synthesize openai: OPENAI_API_KEY is not set");
  const r = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: opts.model ?? "tts-1",
      voice: opts.voice ?? "alloy",
      input: text,
      response_format: "mp3",
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`OpenAI tts HTTP ${r.status}: ${body.slice(0, 300)}`);
  }
  writeFileSync(outPath, Buffer.from(await r.arrayBuffer()));
  return outPath;
}

async function synthesizeElevenLabs(text: string, outPath: string, opts: SynthesizeOpts): Promise<string> {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error("synthesize elevenlabs: ELEVENLABS_API_KEY is not set");
  // Rachel is ElevenLabs' most popular default voice id.
  const voice = opts.voice ?? "21m00Tcm4TlvDq8ikWAM";
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "xi-api-key": process.env.ELEVENLABS_API_KEY,
    },
    body: JSON.stringify({ text, model_id: opts.model ?? "eleven_turbo_v2" }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`ElevenLabs HTTP ${r.status}: ${body.slice(0, 300)}`);
  }
  writeFileSync(outPath, Buffer.from(await r.arrayBuffer()));
  return outPath;
}

function synthesizeSystem(text: string, outPath: string): string {
  if (platform() !== "darwin") {
    throw new Error("synthesize system: only supported on macOS (uses `say` + afconvert)");
  }
  // `say -o` writes AIFF by default; convert to m4a so Telegram and
  // Discord accept it inline.
  const aiff = join(tmpdir(), `bajaclaw-say-${Date.now()}.aiff`);
  const sayR = spawnSync("say", ["-o", aiff, text], { stdio: "pipe" });
  if (sayR.status !== 0) throw new Error(`say exited ${sayR.status}`);
  const ext = extname(outPath).toLowerCase();
  if (ext === ".aiff") {
    // No conversion needed.
    spawnSync("mv", [aiff, outPath]);
    return outPath;
  }
  const format = ext === ".m4a" ? "m4af" : ext === ".mp3" ? "mp3" : "m4af";
  const r = spawnSync("afconvert", ["-f", format, "-d", "aac", aiff, outPath], { stdio: "pipe" });
  try { spawnSync("rm", [aiff]); } catch { /* ignore */ }
  if (r.status !== 0) throw new Error(`afconvert exited ${r.status}`);
  return outPath;
}

function guessAudioMime(path: string): string {
  const ext = extname(path).toLowerCase();
  return {
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".webm": "audio/webm",
    ".flac": "audio/flac",
    ".aiff": "audio/aiff",
    ".opus": "audio/opus",
  }[ext] ?? "audio/mpeg";
}
