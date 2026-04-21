// `bajaclaw image <prompt>` - generate an image and save it to disk.
//
// Provider auto-selection:
//   1. OPENAI_API_KEY -> OpenAI Images API (`gpt-image-1`)
//   2. FAL_KEY        -> FAL (flux-schnell)
// Set BAJACLAW_IMAGE_PROVIDER=openai|fal to force a provider.
//
// Output defaults to <profileDir>/images/<timestamp>.png; override
// with --out.
//
// With --attach the generated image is pushed to the originating
// channel via the same path as `bajaclaw attach`.

import { writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import chalk from "chalk";
import { profileDir, ensureDir } from "../paths.js";
import { cmdAttach } from "./attach.js";

export interface ImageOpts {
  profile?: string;
  prompt: string;
  out?: string;
  provider?: "openai" | "fal" | "auto";
  model?: string;
  attach?: boolean;
  caption?: string;
  size?: string;
  quiet?: boolean;
}

export async function cmdImage(opts: ImageOpts): Promise<void> {
  if (!opts.prompt.trim()) {
    console.error(chalk.red("image: prompt is required"));
    process.exit(2);
  }

  const provider = resolveProvider(opts.provider);
  if (!provider) {
    console.error(chalk.red(
      "image: no API key detected. Set OPENAI_API_KEY for OpenAI or FAL_KEY for FAL.",
    ));
    process.exit(1);
  }

  const outPath = opts.out ?? defaultOutputPath(opts.profile);
  ensureDir(dirname(outPath));

  try {
    if (provider === "openai") await generateOpenAI(opts, outPath);
    else await generateFal(opts, outPath);
  } catch (e) {
    console.error(chalk.red(`image: ${(e as Error).message}`));
    process.exit(1);
  }

  if (!existsSync(outPath)) {
    console.error(chalk.red(`image: provider returned no file at ${outPath}`));
    process.exit(1);
  }

  if (opts.quiet) console.log(outPath);
  else console.log(chalk.green(`✓ ${outPath}`));

  if (opts.attach) {
    await cmdAttach(outPath, { caption: opts.caption ?? opts.prompt });
  }
}

function resolveProvider(preferred?: string): "openai" | "fal" | null {
  if (preferred === "openai") return process.env.OPENAI_API_KEY ? "openai" : null;
  if (preferred === "fal") return process.env.FAL_KEY ? "fal" : null;
  // auto
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.FAL_KEY) return "fal";
  return null;
}

function defaultOutputPath(profile?: string): string {
  const dir = profile ? join(profileDir(profile), "images") : join(process.cwd(), "bajaclaw-images");
  ensureDir(dir);
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return join(dir, `${ts}.png`);
}

async function generateOpenAI(opts: ImageOpts, outPath: string): Promise<void> {
  const model = opts.model ?? "gpt-image-1";
  const size = opts.size ?? "1024x1024";
  const r = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model, prompt: opts.prompt, size, n: 1, response_format: "b64_json" }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`OpenAI HTTP ${r.status}: ${body.slice(0, 300)}`);
  }
  const json = await r.json() as { data?: Array<{ b64_json?: string; url?: string }> };
  const first = json.data?.[0];
  if (!first) throw new Error("OpenAI returned no data");
  if (first.b64_json) {
    writeFileSync(outPath, Buffer.from(first.b64_json, "base64"));
    return;
  }
  if (first.url) {
    const imgRes = await fetch(first.url);
    if (!imgRes.ok) throw new Error(`fetch URL HTTP ${imgRes.status}`);
    writeFileSync(outPath, Buffer.from(await imgRes.arrayBuffer()));
    return;
  }
  throw new Error("OpenAI returned neither b64_json nor url");
}

async function generateFal(opts: ImageOpts, outPath: string): Promise<void> {
  const model = opts.model ?? "fal-ai/flux/schnell";
  const r = await fetch(`https://fal.run/${model}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Key ${process.env.FAL_KEY}`,
    },
    body: JSON.stringify({ prompt: opts.prompt, image_size: opts.size ?? "landscape_4_3" }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`FAL HTTP ${r.status}: ${body.slice(0, 300)}`);
  }
  const json = await r.json() as { images?: Array<{ url?: string }> };
  const first = json.images?.[0];
  if (!first?.url) throw new Error("FAL returned no image url");
  const imgRes = await fetch(first.url);
  if (!imgRes.ok) throw new Error(`FAL image fetch HTTP ${imgRes.status}`);
  writeFileSync(outPath, Buffer.from(await imgRes.arrayBuffer()));
}
