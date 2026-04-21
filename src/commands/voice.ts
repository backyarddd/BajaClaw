// CLI wrappers for voice. `bajaclaw transcribe <path>` prints the
// transcription; `bajaclaw tts <text>` writes audio to disk and
// optionally pushes it to the originating channel.

import { join, dirname } from "node:path";
import chalk from "chalk";
import { profileDir, ensureDir } from "../paths.js";
import { transcribe, synthesize, type TranscribeProvider, type SynthesizeProvider } from "../voice.js";
import { cmdAttach } from "./attach.js";

export interface TranscribeCmdOpts {
  profile?: string;
  path: string;
  provider?: TranscribeProvider;
  model?: string;
  language?: string;
  quiet?: boolean;
}

export async function cmdTranscribe(opts: TranscribeCmdOpts): Promise<void> {
  try {
    const r = await transcribe(opts.path, {
      provider: opts.provider,
      model: opts.model,
      language: opts.language,
    });
    if (opts.quiet) console.log(r.text);
    else {
      console.log(chalk.green("✓ transcribed"));
      if (r.language) console.log(chalk.dim(`  language: ${r.language}${r.durationSec ? ` · ${r.durationSec.toFixed(1)}s` : ""}`));
      console.log("");
      console.log(r.text);
    }
  } catch (e) {
    console.error(chalk.red((e as Error).message));
    process.exit(1);
  }
}

export interface TtsCmdOpts {
  profile?: string;
  text: string;
  out?: string;
  provider?: SynthesizeProvider;
  voice?: string;
  model?: string;
  attach?: boolean;
  caption?: string;
  quiet?: boolean;
}

export async function cmdTts(opts: TtsCmdOpts): Promise<void> {
  if (!opts.text.trim()) {
    console.error(chalk.red("tts: text is required"));
    process.exit(2);
  }
  const out = opts.out ?? defaultAudioPath(opts.profile, opts.provider);
  try {
    await synthesize(opts.text, out, {
      provider: opts.provider,
      voice: opts.voice,
      model: opts.model,
    });
    if (opts.quiet) console.log(out);
    else console.log(chalk.green(`✓ ${out}`));
    if (opts.attach) await cmdAttach(out, { caption: opts.caption });
  } catch (e) {
    console.error(chalk.red((e as Error).message));
    process.exit(1);
  }
}

function defaultAudioPath(profile: string | undefined, provider: SynthesizeProvider | undefined): string {
  const dir = profile ? join(profileDir(profile), "audio") : join(process.cwd(), "bajaclaw-audio");
  ensureDir(dir);
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const ext = provider === "system" ? ".m4a" : ".mp3";
  return join(dir, `${ts}${ext}`);
}
