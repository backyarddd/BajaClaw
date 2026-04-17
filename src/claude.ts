import { execa, type ExecaChildProcess } from "execa";
import { platform } from "node:os";
import type { ClaudeEvent, ClaudeOptions, ClaudeResult } from "./types.js";

const DEFAULT_TIMEOUT = 10 * 60 * 1000;

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
  if (opts.maxTurns !== undefined) args.push("--max-turns", String(opts.maxTurns));
  if (opts.allowedTools?.length) args.push("--allowedTools", opts.allowedTools.join(","));
  if (opts.disallowedTools?.length) args.push("--disallowedTools", opts.disallowedTools.join(","));
  if (opts.mcpConfig) args.push("--mcp-config", opts.mcpConfig);
  if (opts.systemPrompt) args.push("--system-prompt", opts.systemPrompt);
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

export function runStream(prompt: string, opts: ClaudeOptions = {}): ExecaChildProcess | null {
  const cmd = buildCommand(prompt, opts);
  const bin = cachedBinary;
  if (!bin) return null;
  return execa(bin, [...cmd, "--output-format", "stream-json"], {
    cwd: opts.workdir,
    stdio: ["ignore", "pipe", "pipe"],
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
  if (exitCode !== 0) base.error = stderr || `exit ${exitCode}`;
  if (!jsonMode) return base;

  try {
    const parsed = JSON.parse(stdout);
    if (Array.isArray(parsed)) base.events = parsed as ClaudeEvent[];
    else if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj.messages)) base.events = obj.messages as ClaudeEvent[];
      if (typeof obj.result === "string") base.text = obj.result;
      if (typeof obj.total_cost_usd === "number") base.costUsd = obj.total_cost_usd;
      else if (typeof obj.cost_usd === "number") base.costUsd = obj.cost_usd;
      const usage = obj.usage as { input_tokens?: number; output_tokens?: number } | undefined;
      if (usage) {
        base.inputTokens = usage.input_tokens;
        base.outputTokens = usage.output_tokens;
      }
      if (typeof obj.num_turns === "number") base.turns = obj.num_turns;
    }
  } catch {
    // Non-JSON stdout; leave text as-is.
  }
  return base;
}

export function resetCache(): void {
  cachedBinary = undefined;
  cachedSupportsJson = undefined;
}
