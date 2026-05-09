// Outbound Anthropic auth for the OpenAI-compatible HTTP endpoint.
//
// Endpoint cycles run with `--bare` (see ClaudeOptions.bare). --bare
// strips OAuth + keychain reads, so claude needs ANTHROPIC_API_KEY in
// its env (or apiKeyHelper, or 3P provider creds). For Pro/Max/Team/
// Enterprise subscribers, `claude setup-token` mints a 1-year inference
// token that works as ANTHROPIC_API_KEY and bills against subscription
// quota - no separate API credits needed.
//
// Resolution precedence:
//   1. process.env.ANTHROPIC_API_KEY                    (whatever is exported)
//   2. ~/.bajaclaw/api.json `anthropicApiKey` field     (saved by setup)
//   3. interactive: prompt to run `claude setup-token`  (TTY only)
//   4. unresolved -> caller decides whether to warn or block
//
// All cross-file refs into bajaclaw's own source tree are lazy-imported
// (await import inside functions) so this module stays test-friendly
// under Node's type-strip path. See HANDOFF landmine 6.

import { execa } from "execa";
import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export type AnthropicKeySource = "env" | "saved" | "setup-token";

export interface ResolvedAnthropicKey {
  source: AnthropicKeySource;
  key: string;
}

export interface ResolveOptions {
  // Allow prompting the user to run `claude setup-token` if no key is
  // found. Default false; serve.ts opts in. Always disabled if not on
  // a TTY regardless of this flag.
  autoSetup?: boolean;
}

// Inlined so this module has no static value-imports into bajaclaw's
// own source tree. BAJACLAW_HOME is honored to match paths.ts, and
// for hermetic tests.
function userApiConfigPath(): string {
  const home = process.env.BAJACLAW_HOME ?? join(homedir(), ".bajaclaw");
  return join(home, "api.json");
}

export function loadSavedAnthropicKey(): string | null {
  const p = userApiConfigPath();
  if (!existsSync(p)) return null;
  try {
    const cfg = JSON.parse(readFileSync(p, "utf8")) as { anthropicApiKey?: string };
    const k = (cfg.anthropicApiKey ?? "").trim();
    return k || null;
  } catch {
    return null;
  }
}

// Persist a token to ~/.bajaclaw/api.json, preserving any other fields
// (apiKey, host, port, etc) already in the file. chmod 600 so other
// users on the box can't read it. Throws on write failure - we'd
// rather fail loudly than save a token to a world-readable file.
export function saveAnthropicKey(key: string): void {
  const p = userApiConfigPath();
  let existing: Record<string, unknown> = {};
  if (existsSync(p)) {
    try { existing = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>; }
    catch { existing = {}; }
  }
  const next = { ...existing, anthropicApiKey: key };
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(next, null, 2) + "\n", "utf8");
  try { chmodSync(p, 0o600); }
  catch { /* non-fatal; some filesystems (FAT, network mounts) don't support chmod */ }
}

function ttyAvailable(): boolean {
  return !!process.stdin.isTTY && !!process.stdout.isTTY;
}

// Spawn `claude setup-token` with inherited stdio so the user sees the
// OAuth URL + completes the browser flow. Then prompt for the token to
// be pasted back. Returns the trimmed token, or null if any step is
// cancelled. We can't capture stdout while inheriting it, so the paste
// is the cleanest way to get the token across.
export async function runSetupTokenInteractively(): Promise<string | null> {
  if (!ttyAvailable()) return null;
  const { ask } = await import("../prompt.js");
  console.log("");
  console.log("Running `claude setup-token` to mint a long-lived inference token.");
  console.log("Follow the OAuth flow in your browser, then copy the token from the");
  console.log("output and paste it here.");
  console.log("");
  try {
    await execa("claude", ["setup-token"], { stdio: "inherit", reject: false });
  } catch {
    return null;
  }
  console.log("");
  const pasted = (await ask("Paste the token (starts with sk-ant-...):"))?.trim();
  if (!pasted) return null;
  if (!pasted.startsWith("sk-ant-")) {
    console.log(`note: token doesn't start with "sk-ant-"; saving anyway.`);
  }
  return pasted;
}

export async function resolveAnthropicKey(opts: ResolveOptions = {}): Promise<ResolvedAnthropicKey | null> {
  const fromEnv = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (fromEnv) return { source: "env", key: fromEnv };

  const saved = loadSavedAnthropicKey();
  if (saved) return { source: "saved", key: saved };

  if (!opts.autoSetup || !ttyAvailable()) return null;

  const { confirm } = await import("../prompt.js");
  const yes = await confirm(
    "No ANTHROPIC_API_KEY found. Run `claude setup-token` now to mint one (subscription users)?",
    true,
  );
  if (!yes) return null;

  const minted = await runSetupTokenInteractively();
  if (!minted) return null;

  try {
    saveAnthropicKey(minted);
  } catch (e) {
    console.error(`failed to save token to ~/.bajaclaw/api.json: ${(e as Error).message}`);
    return null;
  }
  return { source: "setup-token", key: minted };
}
