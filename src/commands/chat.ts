// `bajaclaw chat [profile]` - interactive REPL.
//
// Design notes:
// - Uses `readline/promises` with `.question()` in a `while` loop.
//   Readline is only "active" while awaiting user input - while the
//   cycle runs, it's idle, so stdout writes don't fight with its
//   terminal-mode redraw logic.
// - No animated spinner. A static "…is thinking…" line is written
//   once and erased with cursor-up + clear-line (no `\r` writes,
//   which would trigger readline's prompt-redraw behavior).
// - Each turn is fully sequential: read input → run cycle → print
//   response → loop. No concurrent dispatch, no race conditions.
// - Errors are surfaced with friendly context. Raw `exit 1` is
//   translated into actionable text.

import { createInterface } from "node:readline/promises";
import { PassThrough } from "node:stream";
import { stdin, stdout } from "node:process";
import chalk from "chalk";
import { runCycle, type CycleOutput } from "../agent.js";
import { loadConfig, saveConfig } from "../config.js";
import { openDb, type DB } from "../db.js";
import { tierFor, budgetFor, AUTO, HAIKU, SONNET, OPUS } from "../model-picker.js";
import { currentVersion } from "../updater.js";
import { loadPersona } from "../persona-io.js";
import type { AgentConfig, ChatTurn } from "../types.js";

const HISTORY_LIMIT = 10;

const MODEL_ALIAS: Record<string, string> = {
  auto: AUTO,
  haiku: HAIKU,
  sonnet: SONNET,
  opus: OPUS,
};

const CTX_TOKENS_200K: Record<"haiku" | "sonnet" | "opus", number> = {
  haiku: 200_000,
  sonnet: 200_000,
  opus: 200_000,
};
const CTX_TOKENS_1M = 1_000_000;

export interface ChatOptions {
  profile: string;
  model?: string;
}

interface SessionStats {
  started: number;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

interface UsageWindow {
  cycles: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export async function runChat(opts: ChatOptions): Promise<void> {
  if (!stdin.isTTY || !stdout.isTTY) {
    console.error(chalk.red("bajaclaw chat requires an interactive terminal."));
    console.error(chalk.dim("For scripted use: bajaclaw start --task \"<prompt>\""));
    process.exitCode = 1;
    return;
  }

  let cfg: AgentConfig;
  try {
    cfg = loadConfig(opts.profile);
  } catch (e) {
    console.error(chalk.red(`error: ${(e as Error).message}`));
    process.exitCode = 1;
    return;
  }

  const persona = loadPersona(opts.profile);
  const agentName = (persona?.agentName ?? "baja").toLowerCase();

  let modelOverride: string | undefined = opts.model ? resolveModelAlias(opts.model) : undefined;
  const history: ChatTurn[] = [];
  const stats: SessionStats = {
    started: Date.now(),
    turnCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  };

  printHeader(opts.profile, cfg, agentName, modelOverride);

  // Bracketed-paste shim. Terminals that support bracketed paste
  // (xterm, iTerm, Terminal.app, etc.) wrap pasted content in
  // \x1b[200~ ... \x1b[201~. Inside those markers, newlines should
  // be treated as literal text - not as "submit this line".
  //
  // We intercept stdin, replace in-paste \r and \n with a marker
  // (\x16 SYN - non-printing, very unlikely in real input), feed
  // the rewritten stream to readline, then swap the marker back to
  // a real newline when rl.question() resolves.
  const paste = installPasteShim();
  const rl = createInterface({ input: paste.input, output: stdout });

  // Main loop. One turn at a time, no concurrency.
  // Per-turn layout (Claude Code style):
  //   ─── top rule ───
  //    › user input
  //   ─── bottom rule ───
  //    · haiku · 1.2s · $0.0012 · 2 turns · #42
  //
  //    emily › agent response…
  //
  //   (next turn's top rule follows)
  while (true) {
    writeHRule();
    let input: string;
    try {
      const raw = await rl.question(chalk.cyan(" › "));
      input = raw.replace(/\x16/g, "\n").trim();
    } catch {
      break; // rl closed (EOF / Ctrl-D)
    }

    if (!input) {
      // Empty enter: nothing to do. Move on; a fresh top rule prints
      // on the next pass. (Accept the visual glitch of an adjacent
      // double-rule over adding cursor-manipulation complexity.)
      continue;
    }

    writeHRule();

    // Slash commands
    if (input.startsWith("/")) {
      const action = await handleSlash(input, {
        profile: opts.profile,
        cfg,
        agentName,
        history,
        stats,
        getModel: () => modelOverride,
        setModel: (m) => { modelOverride = m; },
      });
      if (action === "exit") break;
      continue;
    }

    // Normal turn: run a cycle.
    history.push({ role: "user", content: input, ts: Date.now() });
    // Temporary meta line while the cycle runs. Swapped for the real
    // stats line once we have a result.
    stdout.write(chalk.dim(" · thinking…\n"));

    let r: CycleOutput | null = null;
    let caughtError: Error | null = null;
    try {
      const recent = history.slice(-HISTORY_LIMIT - 1, -1);
      r = await runCycle({
        profile: opts.profile,
        task: input,
        modelOverride,
        sessionHistory: recent,
      });
    } catch (e) {
      caughtError = e as Error;
    }

    // Replace the "thinking…" line in place. `\x1b[1A\x1b[2K` =
    // cursor up one, erase in line (no `\r` so readline doesn't
    // re-draw a phantom prompt).
    stdout.write("\x1b[1A\x1b[2K");

    if (caughtError) {
      stdout.write(chalk.red(` · error · ${caughtError.message}`) + "\n\n");
      stdout.write(chalk.red(` ${agentName} › `) + chalk.red(caughtError.message) + "\n\n");
      history.pop();
      continue;
    }

    if (!r || !r.ok) {
      stdout.write(chalk.red(" · cycle failed") + "\n\n");
      stdout.write(chalk.red(` ${agentName} › `) + chalk.red(formatCycleError(r)) + "\n\n");
      history.pop();
      continue;
    }

    // Meta line directly under the bottom rule. Then a blank line,
    // then the response. Layout matches the screenshot you referenced:
    // rule / prompt / rule / meta / blank / response / blank.
    printStatusLine(r, cfg);
    const responseText = (r.text ?? "").trim() || chalk.dim("(empty response)");
    stdout.write(chalk.green(` ${agentName} › `) + responseText + "\n\n");

    history.push({ role: "assistant", content: r.text ?? "", ts: Date.now() });
    stats.turnCount += 1;
    stats.inputTokens += r.inputTokens ?? 0;
    stats.outputTokens += r.outputTokens ?? 0;
    stats.costUsd += r.costUsd ?? 0;
  }

  rl.close();
  paste.dispose();
  printSessionSummary(stats);
}

// ───────────────────────────────────────────────────────────────
// Bracketed-paste shim
// ───────────────────────────────────────────────────────────────

interface PasteShim {
  input: NodeJS.ReadStream;
  dispose: () => void;
}

function installPasteShim(): PasteShim {
  const proxy = new PassThrough() as unknown as NodeJS.ReadStream & { setRawMode?: (v: boolean) => NodeJS.ReadStream };
  (proxy as { isTTY?: boolean }).isTTY = true;
  (proxy as { isRaw?: boolean }).isRaw = false;
  // Readline calls setRawMode on its input when it's a TTY. Forward
  // to the real stdin so keypresses arrive one-at-a-time.
  (proxy as { setRawMode: (v: boolean) => NodeJS.ReadStream }).setRawMode = (v: boolean) => {
    if (stdin.isTTY) stdin.setRawMode(v);
    (proxy as { isRaw?: boolean }).isRaw = v;
    return proxy;
  };
  // Propagate window size so readline can re-wrap prompts correctly.
  Object.defineProperty(proxy, "columns", { get: () => stdout.columns });
  Object.defineProperty(proxy, "rows", { get: () => stdout.rows });

  // Enable bracketed paste on the terminal. Disabled in dispose().
  stdout.write("\x1b[?2004h");

  const PASTE_BEGIN = "\x1b[200~";
  const PASTE_END = "\x1b[201~";
  const NL_MARKER = "\x16"; // SYN
  let inPaste = false;
  // Leftover bytes when a paste marker sits across chunk boundaries.
  let tail = "";

  const onData = (chunk: Buffer): void => {
    const s = tail + chunk.toString("utf8");
    tail = "";
    let out = "";
    let i = 0;
    while (i < s.length) {
      // Could a paste marker start here? If ESC and we don't have
      // enough bytes yet to decide, stash the rest for the next chunk.
      if (s.charCodeAt(i) === 0x1b && i + PASTE_BEGIN.length > s.length) {
        tail = s.slice(i);
        break;
      }
      if (!inPaste && s.startsWith(PASTE_BEGIN, i)) {
        inPaste = true;
        i += PASTE_BEGIN.length;
        continue;
      }
      if (inPaste && s.startsWith(PASTE_END, i)) {
        inPaste = false;
        i += PASTE_END.length;
        continue;
      }
      const ch = s[i]!;
      if (inPaste && (ch === "\n" || ch === "\r")) {
        out += NL_MARKER;
      } else {
        out += ch;
      }
      i++;
    }
    if (out) (proxy as unknown as PassThrough).write(out);
  };

  stdin.on("data", onData);

  const dispose = (): void => {
    stdin.removeListener("data", onData);
    try { stdout.write("\x1b[?2004l"); } catch { /* ignore */ }
  };

  return { input: proxy, dispose };
}

// ───────────────────────────────────────────────────────────────
// Horizontal rule - spans terminal width, caps at 120 cols so it
// doesn't sprawl on ultra-wide monitors.
// ───────────────────────────────────────────────────────────────

function writeHRule(): void {
  const width = Math.min(stdout.columns || 80, 120);
  stdout.write(chalk.dim("─".repeat(width)) + "\n");
}

// ───────────────────────────────────────────────────────────────
// Error formatting
// ───────────────────────────────────────────────────────────────

function formatCycleError(r: CycleOutput | null): string {
  if (!r) return "no response from backend";
  const raw = (r.error ?? "").trim();
  if (!raw) return "backend returned no output";

  // Max turns - translate claude.ts sentinel into a chat-friendly tip.
  const maxTurnsMatch = raw.match(/^max_turns_hit:(\d+|\?)/);
  if (maxTurnsMatch) {
    const used = maxTurnsMatch[1];
    return `ran out of turns (${used} used this cycle). The task needed more tool calls than the per-cycle budget. Try: (a) break it into smaller asks, (b) "/model opus" for a higher cap, or (c) just send the request again - the agent often finishes on retry.`;
  }

  if (/permission|needs write/i.test(raw)) {
    return `backend wanted to use a tool that needs approval, and BajaClaw closes stdin. Fixed in v0.11.2+ via --dangerously-skip-permissions. If you're seeing this, update: npm install -g bajaclaw@latest`;
  }
  if (/rate[- ]?limit/i.test(raw)) {
    return "rate-limited by Anthropic. Wait a few minutes and retry.";
  }
  if (/credit|quota|billing/i.test(raw)) {
    return `${raw} - check your Anthropic plan at anthropic.com.`;
  }
  if (/^exit \d+$/i.test(raw)) {
    return `backend exited (${raw}) with no detail. Check the profile log: bajaclaw daemon logs`;
  }
  // Fallback: first line + truncate. Never echo multi-KB JSON.
  return raw.split("\n")[0]!.slice(0, 400);
}

// ───────────────────────────────────────────────────────────────
// Header / status / summary
// ───────────────────────────────────────────────────────────────

function printHeader(
  profile: string,
  cfg: AgentConfig,
  agentName: string,
  modelOverride: string | undefined,
): void {
  const modelDisplay = modelOverride ?? cfg.model;
  const tierNote = modelDisplay === AUTO
    ? chalk.dim(" (routes haiku/sonnet/opus per task)")
    : "";
  const tier = tierFor(modelDisplay === AUTO ? SONNET : modelDisplay);
  const ctxTokens = cfg.contextWindow === "1m" ? CTX_TOKENS_1M : CTX_TOKENS_200K[tier];
  const ctxLabel = cfg.contextWindow === "1m"
    ? chalk.green("1M") + chalk.dim(" (beta)")
    : formatNum(ctxTokens);

  const db = openDb(profile);
  let fiveH: UsageWindow;
  let week: UsageWindow;
  try {
    fiveH = usageWindow(db, 5);
    week = usageWindow(db, 24 * 7);
  } finally {
    db.close();
  }

  const title = `BajaClaw chat · ${profile} · v${currentVersion()}`;
  console.log("");
  console.log(chalk.bold.cyan(`╭─ ${title} ` + "─".repeat(Math.max(0, 58 - title.length - 3)) + "╮"));
  console.log(`${chalk.bold("  agent     ")} ${chalk.cyan(agentName)}`);
  console.log(`${chalk.bold("  model     ")} ${chalk.cyan(modelDisplay)}${tierNote}`);
  console.log(`${chalk.bold("  effort    ")} ${chalk.cyan(cfg.effort)}${chalk.dim("  (/effort max for biggest turn budget)")}`);
  console.log(`${chalk.bold("  context   ")} ${ctxLabel} tokens${chalk.dim("  (/context 1m to enable 1M beta)")}`);
  if (cfg.maxBudgetUsd != null) {
    console.log(`${chalk.bold("  budget    ")} $${cfg.maxBudgetUsd.toFixed(2)} per cycle`);
  }
  console.log("");
  console.log(`${chalk.bold("  5h usage  ")} ${formatUsage(fiveH)}`);
  console.log(`${chalk.bold("  week      ")} ${formatUsage(week)}`);
  console.log(chalk.dim("  (advisory counts from your local cycle log - compare to your plan)"));
  console.log("");
  console.log(chalk.dim("  /help for commands · /exit or Ctrl-D to quit"));
  console.log(chalk.bold.cyan("╰" + "─".repeat(58) + "╯"));
  console.log("");
}

function printStatusLine(r: CycleOutput, cfg: AgentConfig): void {
  // Rendered directly under the bottom rule of the input sandwich.
  // One dim line, space-separated bullets, no trailing bullet so
  // the eye stops at the last token.
  const bits: string[] = [];
  if (r.model) bits.push(chalk.magenta(shortModel(r.model)));
  bits.push(chalk.dim(cfg.effort));
  if (r.inputTokens != null || r.outputTokens != null) {
    bits.push(chalk.dim(`${formatNum(r.inputTokens ?? 0)} in / ${formatNum(r.outputTokens ?? 0)} out`));
  }
  bits.push(chalk.dim(`${(r.durationMs / 1000).toFixed(1)}s`));
  if (r.costUsd != null) bits.push(chalk.dim(`$${r.costUsd.toFixed(4)}`));
  bits.push(chalk.dim(`#${r.cycleId}`));
  stdout.write(chalk.dim(" · ") + bits.join(chalk.dim(" · ")) + "\n\n");
}

function printSessionSummary(stats: SessionStats): void {
  if (stats.turnCount === 0) {
    console.log(chalk.dim("\nbye."));
    return;
  }
  const elapsedSec = Math.round((Date.now() - stats.started) / 1000);
  const dur = elapsedSec > 60 ? `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s` : `${elapsedSec}s`;
  console.log("");
  console.log(chalk.dim(`Session: ${stats.turnCount} turns · ${formatNum(stats.inputTokens + stats.outputTokens)} tokens · $${stats.costUsd.toFixed(4)} · ${dur}`));
  console.log("");
}

// ───────────────────────────────────────────────────────────────
// Slash commands
// ───────────────────────────────────────────────────────────────

interface SlashCtx {
  profile: string;
  cfg: AgentConfig;
  agentName: string;
  history: ChatTurn[];
  stats: SessionStats;
  getModel: () => string | undefined;
  setModel: (m: string | undefined) => void;
}

async function handleSlash(input: string, ctx: SlashCtx): Promise<"exit" | "continue"> {
  const [cmd, ...rest] = input.slice(1).split(/\s+/);
  const arg = rest.join(" ").trim();

  switch (cmd) {
    case "help":
    case "?": {
      printHelp();
      return "continue";
    }
    case "exit":
    case "quit":
    case "q": {
      return "exit";
    }
    case "clear": {
      ctx.history.length = 0;
      console.log(chalk.green("✓ session history cleared (memory DB untouched)"));
      console.log("");
      return "continue";
    }
    case "stats": {
      printDetailedStats(ctx);
      return "continue";
    }
    case "context":
    case "ctx": {
      const modelOverride = ctx.getModel();
      const m = modelOverride ?? ctx.cfg.model;
      const tier = tierFor(m === AUTO ? SONNET : m);
      const budget = budgetFor(tier);

      if (!arg) {
        const current = ctx.cfg.contextWindow ?? "200k";
        const ctxTokens = current === "1m" ? CTX_TOKENS_1M : CTX_TOKENS_200K[tier];
        console.log(`${chalk.bold("context window:  ")} ${formatNum(ctxTokens)} tokens (${current})`);
        console.log(`${chalk.bold("per-cycle prompt:")} ${budget.memoryCount} memories · ${budget.skillCount} skills`);
        console.log(chalk.dim("set with: /context 200k | /context 1m  (1m is a beta, API-key auth only)"));
        console.log("");
        return "continue";
      }
      const target = arg.toLowerCase();
      if (target !== "200k" && target !== "1m") {
        console.log(chalk.red("usage: /context 200k | 1m"));
        console.log("");
        return "continue";
      }
      ctx.cfg.contextWindow = target as "200k" | "1m";
      saveConfig(ctx.cfg);
      if (target === "1m") {
        console.log(chalk.green("✓ context window set to 1M (beta)"));
        console.log(chalk.dim("  Requires API-key auth. Subscription users will get a warning + fallback to 200k."));
      } else {
        console.log(chalk.green("✓ context window set to 200k"));
      }
      console.log("");
      return "continue";
    }
    case "model": {
      if (!arg) {
        const current = ctx.getModel() ?? ctx.cfg.model;
        console.log(`current: ${chalk.cyan(current)}`);
        console.log(chalk.dim("set with: /model auto | haiku | sonnet | opus | <full-id>"));
        console.log(chalk.dim("session-only (doesn't touch config.json)"));
        console.log("");
        return "continue";
      }
      const resolved = resolveModelAlias(arg);
      ctx.setModel(resolved);
      console.log(chalk.green(`✓ model for this session: ${resolved}`));
      console.log("");
      return "continue";
    }
    case "effort": {
      if (!arg) {
        console.log(`current: ${chalk.cyan(ctx.cfg.effort)}`);
        console.log(chalk.dim("set with: /effort low | medium | high | xhigh | max"));
        console.log(chalk.dim("higher = more runway (turns/tokens). max = unlimited-ish."));
        console.log("");
        return "continue";
      }
      const level = arg.toLowerCase();
      const allowed = ["low", "medium", "high", "xhigh", "max"];
      if (!allowed.includes(level)) {
        console.log(chalk.red(`must be one of: ${allowed.join(", ")}`));
        console.log("");
        return "continue";
      }
      ctx.cfg.effort = level as "low" | "medium" | "high" | "xhigh" | "max";
      saveConfig(ctx.cfg);
      console.log(chalk.green(`✓ effort set to ${level} (persisted to config.json)`));
      console.log("");
      return "continue";
    }
    case "compact": {
      const { compact, shouldCompact } = await import("../memory/compact.js");
      const db = openDb(ctx.profile);
      try {
        const decision = shouldCompact(db, ctx.cfg.compaction);
        if (!decision.yes) {
          console.log(chalk.dim(`no trigger - ${decision.reason}. Running anyway (--force).`));
        }
        console.log(chalk.cyan("compacting…"));
        const r = await compact(db, ctx.cfg.compaction);
        console.log(chalk.green(`✓ compacted: ${r.memoriesBefore} → ${r.memoriesAfter} memories · ${r.cyclesPruned} cycles pruned · ${r.durationMs}ms`));
      } finally {
        db.close();
      }
      console.log("");
      return "continue";
    }
    case "history": {
      if (ctx.history.length === 0) {
        console.log(chalk.dim("(empty)"));
      } else {
        for (const t of ctx.history) {
          const label = t.role === "user" ? chalk.cyan("you") : chalk.green(ctx.agentName);
          console.log(`${label}: ${t.content.slice(0, 200)}${t.content.length > 200 ? "…" : ""}`);
        }
      }
      console.log("");
      return "continue";
    }
    default:
      console.log(chalk.red(`unknown command: /${cmd}`));
      console.log(chalk.dim("type /help for the list"));
      console.log("");
      return "continue";
  }
}

function printHelp(): void {
  console.log(chalk.bold("commands:"));
  console.log(`  ${chalk.cyan("/help")}                 this list`);
  console.log(`  ${chalk.cyan("/exit")} · ${chalk.cyan("/quit")} · ${chalk.cyan("/q")}   end the session (or Ctrl-D)`);
  console.log(`  ${chalk.cyan("/clear")}                clear session history (DB memory untouched)`);
  console.log(`  ${chalk.cyan("/stats")}                session totals, 5h/weekly usage`);
  console.log(`  ${chalk.cyan("/context")} · ${chalk.cyan("/ctx")}       show context window + per-cycle budget`);
  console.log(`  ${chalk.cyan("/model [id|alias]")}     show or set session model`);
  console.log(`                       ${chalk.dim("aliases: auto, haiku, sonnet, opus")}`);
  console.log(`  ${chalk.cyan("/effort [low|medium|high|xhigh|max]")}   show or set effort`);
  console.log(`  ${chalk.cyan("/context [200k|1m]")}   show or set context window (1m is beta)`);
  console.log(`  ${chalk.cyan("/compact")}              run memory compaction now`);
  console.log(`  ${chalk.cyan("/history")}              dump this session's turns`);
  console.log("");
}

function printDetailedStats(ctx: SlashCtx): void {
  const elapsedSec = Math.round((Date.now() - ctx.stats.started) / 1000);
  const db = openDb(ctx.profile);
  let fiveH: UsageWindow, week: UsageWindow, day: UsageWindow;
  try {
    fiveH = usageWindow(db, 5);
    day = usageWindow(db, 24);
    week = usageWindow(db, 24 * 7);
  } finally {
    db.close();
  }
  console.log(chalk.bold("this session"));
  console.log(`  turns:        ${ctx.stats.turnCount}`);
  console.log(`  tokens:       ${formatNum(ctx.stats.inputTokens)} in · ${formatNum(ctx.stats.outputTokens)} out`);
  console.log(`  cost:         $${ctx.stats.costUsd.toFixed(4)}`);
  console.log(`  elapsed:      ${elapsedSec}s`);
  console.log("");
  console.log(chalk.bold("profile usage (from cycle log)"));
  console.log(`  last 5h:      ${formatUsage(fiveH)}`);
  console.log(`  last 24h:     ${formatUsage(day)}`);
  console.log(`  last 7d:      ${formatUsage(week)}`);
  console.log("");
  console.log(chalk.dim("(counts include heartbeat cycles + other sessions, not just this chat)"));
  console.log("");
}

// ───────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────

function usageWindow(db: DB, hours: number): UsageWindow {
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const row = db.prepare(`
    SELECT
      COUNT(*) AS cycles,
      COALESCE(SUM(input_tokens), 0) AS in_tokens,
      COALESCE(SUM(output_tokens), 0) AS out_tokens,
      COALESCE(SUM(cost_usd), 0) AS cost
    FROM cycles
    WHERE started_at > ? AND status = 'ok'
  `).get(since) as { cycles: number; in_tokens: number; out_tokens: number; cost: number };
  return {
    cycles: Number(row.cycles),
    inputTokens: Number(row.in_tokens),
    outputTokens: Number(row.out_tokens),
    costUsd: Number(row.cost),
  };
}

function formatUsage(w: UsageWindow): string {
  const total = w.inputTokens + w.outputTokens;
  return `${w.cycles} cycles · ${formatNum(total)} tokens · $${w.costUsd.toFixed(4)}`;
}

function formatNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function shortModel(full: string): string {
  if (full.includes("haiku")) return "haiku";
  if (full.includes("sonnet")) return "sonnet";
  if (full.includes("opus")) return "opus";
  return full;
}

function resolveModelAlias(input: string): string {
  const lower = input.toLowerCase();
  if (lower in MODEL_ALIAS) return MODEL_ALIAS[lower]!;
  return input;
}
