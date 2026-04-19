import { execa, type ResultPromise } from "execa";
import { platform } from "node:os";
import type { ClaudeEvent, ClaudeOptions, ClaudeResult } from "./types.js";

const DEFAULT_TIMEOUT = 10 * 60 * 1000;

// Env vars injected by the Claude Desktop app into any process it
// launches. If BajaClaw's daemon was started from within the desktop
// app (or any claude-code session), these get inherited and then
// poison every spawned `claude` subprocess: the Desktop-managed OAuth
// token overrides the user's own on-disk credentials, and when it
// rotates BajaClaw silently breaks with 401s. We scrub them so the
// spawned CLI falls back to its normal credential lookup.
const DESKTOP_MANAGED_ENV_VARS = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH",
  "CLAUDECODE",
] as const;

function cleanSpawnEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of DESKTOP_MANAGED_ENV_VARS) delete env[k];
  return env;
}

let cachedBinary: string | null | undefined;
let cachedSupportsJson: boolean | undefined;

export async function findClaudeBinary(): Promise<string | null> {
  if (cachedBinary !== undefined) return cachedBinary;
  const cmd = platform() === "win32" ? "where.exe" : "which";
  try {
    const r = await execa(cmd, ["claude"], { reject: false });
    if (r.exitCode === 0 && r.stdout.trim()) {
      cachedBinary = r.stdout.split(/\r?\n/)[0]!.trim();
      return cachedBinary;
    }
  } catch { /* fall through */ }
  cachedBinary = null;
  return null;
}

export async function claudeVersion(): Promise<string | null> {
  const bin = await findClaudeBinary();
  if (!bin) return null;
  try {
    const r = await execa(bin, ["--version"], { reject: false, timeout: 5000 });
    return r.exitCode === 0 ? r.stdout.trim() : null;
  } catch {
    return null;
  }
}

export async function supportsJsonOutput(): Promise<boolean> {
  if (cachedSupportsJson !== undefined) return cachedSupportsJson;
  const bin = await findClaudeBinary();
  if (!bin) { cachedSupportsJson = false; return false; }
  try {
    const r = await execa(bin, ["--help"], { reject: false, timeout: 5000 });
    const text = `${r.stdout}\n${r.stderr}`;
    cachedSupportsJson = /--output-format/i.test(text);
  } catch {
    cachedSupportsJson = false;
  }
  return cachedSupportsJson;
}

export function buildCommand(prompt: string, opts: ClaudeOptions): string[] {
  const args: string[] = [];
  if (opts.printMode !== false) args.push("-p", prompt);
  if (opts.model) args.push("--model", opts.model);
  // --effort is the real knob for "how much runway does the agent get".
  // Levels: low < medium < high < xhigh < max. Higher = more turns
  // + more tokens + higher cost. claude's internal turn budget is
  // tied to this level - there is no `--max-turns` flag.
  if (opts.effort) args.push("--effort", opts.effort);
  if (opts.allowedTools?.length) args.push("--allowedTools", opts.allowedTools.join(","));
  if (opts.disallowedTools?.length) args.push("--disallowedTools", opts.disallowedTools.join(","));
  if (opts.mcpConfig) args.push("--mcp-config", opts.mcpConfig);
  if (opts.systemPrompt) args.push("--system-prompt", opts.systemPrompt);

  // Beta flags. `context1M: true` is shorthand for adding the
  // `context-1m-2025-08-07` beta. API-key-only - the CLI warns and
  // falls back to 200k for subscription auth.
  const betas = [...(opts.betas ?? [])];
  if (opts.context1M && !betas.includes("context-1m-2025-08-07")) {
    betas.push("context-1m-2025-08-07");
  }
  if (betas.length > 0) args.push("--betas", ...betas);

  // Per-cycle cost ceiling. Safer than a turn cap because agent
  // complexity varies wildly - this caps the actual spend, not a
  // proxy for it.
  if (opts.maxBudgetUsd !== undefined) {
    args.push("--max-budget-usd", String(opts.maxBudgetUsd));
  }

  // Skip interactive permission prompts. BajaClaw spawns claude with
  // stdin closed, so the interactive prompt would hang / auto-deny.
  // The agent is trusted within the user's account; if they want
  // per-tool confirmations they should use `claude` directly.
  if (opts.skipPermissions !== false) {
    args.push("--dangerously-skip-permissions");
  }
  // JSON output always included when the flag is supported. runOnce checks support.
  return args;
}

export async function runOnce(prompt: string, opts: ClaudeOptions = {}): Promise<ClaudeResult> {
  const start = Date.now();
  const dryRun = process.env.BAJACLAW_DRY_RUN === "1" || (opts as { dryRun?: boolean }).dryRun === true;

  let cmd = buildCommand(prompt, opts);
  const jsonSupported = await supportsJsonOutput();
  if (jsonSupported) cmd = [...cmd, "--output-format", "json"];

  if (dryRun) {
    return {
      ok: true,
      text: "[dry-run] no exec",
      events: [],
      dryRun: true,
      durationMs: Date.now() - start,
      command: ["claude", ...cmd],
    };
  }

  const bin = await findClaudeBinary();
  if (!bin) {
    return {
      ok: false,
      text: "",
      events: [],
      error: "claude CLI not found. See docs/claude-integration.md.",
      durationMs: Date.now() - start,
    };
  }

  try {
    const r = await execa(bin, cmd, {
      cwd: opts.workdir,
      timeout: opts.timeout ?? DEFAULT_TIMEOUT,
      reject: false,
      // Explicitly close stdin. Without this, the claude CLI waits 3s
      // for piped input before proceeding (and treats the wait as a
      // warning that contaminates stdout). Closing stdin tells it
      // "the prompt on -p is complete - don't wait for more".
      stdin: "ignore",
      env: cleanSpawnEnv(),
    });
    return parseResult(r.stdout, r.stderr, r.exitCode ?? 0, start, jsonSupported, ["claude", ...cmd]);
  } catch (e) {
    return {
      ok: false,
      text: "",
      events: [],
      error: (e as Error).message,
      durationMs: Date.now() - start,
      command: ["claude", ...cmd],
    };
  }
}

export function runStream(prompt: string, opts: ClaudeOptions = {}): ResultPromise | null {
  const cmd = buildCommand(prompt, opts);
  const bin = cachedBinary;
  if (!bin) return null;
  return execa(bin, [...cmd, "--output-format", "stream-json"], {
    cwd: opts.workdir,
    stdio: ["ignore", "pipe", "pipe"],
    env: cleanSpawnEnv(),
  });
}

function parseResult(
  stdout: string,
  stderr: string,
  exitCode: number,
  start: number,
  jsonMode: boolean,
  command: string[],
): ClaudeResult {
  const base: ClaudeResult = {
    ok: exitCode === 0,
    text: stdout,
    events: [],
    durationMs: Date.now() - start,
    command,
  };

  // True when the JSON result block explicitly reported success. When
  // it's set, trust the JSON over a non-zero exit code - claude can
  // exit non-zero if a child process it spawned (e.g. a long-running
  // dashboard server) leaves stdout/stderr pipes open past the
  // parent's timeout, even though the turn itself completed cleanly.
  let jsonReportedSuccess = false;

  // Try JSON parse regardless of exit code - claude sometimes emits
  // useful error detail in JSON even when exiting non-zero.
  if (jsonMode) {
    try {
      const parsed = JSON.parse(stdout);
      if (Array.isArray(parsed)) {
        base.events = parsed as ClaudeEvent[];
      } else if (parsed && typeof parsed === "object") {
        const obj = parsed as Record<string, unknown>;
        if (Array.isArray(obj.messages)) base.events = obj.messages as ClaudeEvent[];
        if (typeof obj.result === "string") base.text = obj.result;
        if (typeof obj.total_cost_usd === "number") base.costUsd = obj.total_cost_usd;
        else if (typeof obj.cost_usd === "number") base.costUsd = obj.cost_usd;
        const usage = obj.usage as {
          input_tokens?: number;
          output_tokens?: number;
          cache_creation_input_tokens?: number;
          cache_read_input_tokens?: number;
        } | undefined;
        if (usage) {
          // Sum all input-side token classes so the displayed "in" count
          // reflects the true scale the model processed. Cache reads are
          // cheap but still count toward context.
          base.inputTokens =
            (usage.input_tokens ?? 0) +
            (usage.cache_creation_input_tokens ?? 0) +
            (usage.cache_read_input_tokens ?? 0);
          base.outputTokens = usage.output_tokens;
        }
        if (typeof obj.num_turns === "number") base.turns = obj.num_turns;

        // Error extraction. Claude's result wrapper sets is_error:true
        // for a handful of terminal conditions (max_turns, execution
        // error, rate limit mid-run). Normalize each subtype into a
        // clean, actionable message. Also force ok=false and clear
        // base.text so the raw JSON never bleeds into the agent's
        // "response".
        if (typeof obj.error === "string") {
          base.error = obj.error;
          base.ok = false;
          base.text = "";
        } else if (obj.type === "error" && typeof obj.message === "string") {
          base.error = obj.message as string;
          base.ok = false;
          base.text = "";
        } else if (obj.subtype === "success" && obj.is_error === false) {
          jsonReportedSuccess = true;
        } else if (obj.is_error === true) {
          const subtype = typeof obj.subtype === "string" ? obj.subtype : "";
          const numTurns = typeof obj.num_turns === "number" ? obj.num_turns : undefined;
          if (subtype === "error_max_turns") {
            // Sentinel format. chat.ts pretty-prints; other callers
            // see a short machine-parseable prefix.
            base.error = `max_turns_hit:${numTurns ?? "?"}`;
          } else if (subtype === "error_during_execution") {
            const detail = typeof obj.result === "string" ? obj.result : "";
            base.error = `backend error during execution${detail ? `: ${detail}` : ""}`;
          } else if (typeof obj.result === "string") {
            base.error = obj.result;
          } else if (subtype) {
            base.error = `backend error (${subtype})`;
          } else {
            base.error = "backend reported an error with no message";
          }
          base.ok = false;
          base.text = "";
        }
      }
    } catch {
      // Non-JSON stdout. Could be a streaming fragment or a warning.
      // Leave text as raw stdout.
    }
  }

  if (exitCode !== 0 && !base.error && !jsonReportedSuccess) {
    // Prefer stderr, then stdout first-line fallback. Never echo the
    // entire stdout into the error field - it may be a multi-KB JSON.
    const trimmedStderr = stderr.trim();
    if (trimmedStderr) base.error = trimmedStderr.slice(0, 400);
    else if (stdout.trim()) base.error = stdout.trim().split("\n")[0]!.slice(0, 400);
    else base.error = `backend exited ${exitCode} with no output`;
  }

  // If we determined an error from JSON but exit was 0, still mark not-ok.
  if (base.error && base.ok) base.ok = false;

  // Conversely: JSON explicitly said success. Honor that - ignore a
  // non-zero exit caused by lingering child processes.
  if (jsonReportedSuccess) {
    base.ok = true;
    base.error = undefined;
  }

  return base;
}

export function resetCache(): void {
  cachedBinary = undefined;
  cachedSupportsJson = undefined;
}
