// `bajaclaw chat [profile]` — interactive REPL for conversing with an
// agent turn-by-turn. Each user message runs one BajaClaw cycle.
// Session history is injected into the next prompt's "Recent Chat"
// section so the agent remembers within the session.
//
// Uses event-based readline (`on('line')`) rather than the promise
// `.question()` API because the promise form had a habit of resolving
// the outer chain in a way that let Node exit unexpectedly between
// turns. The event-based loop explicitly keeps the interface live
// until the user types /exit or hits Ctrl-D.

import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import chalk from "chalk";
import { runCycle } from "../agent.js";
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

const CTX_TOKENS: Record<"haiku" | "sonnet" | "opus", number> = {
  haiku: 200_000,
  sonnet: 200_000,
  opus: 200_000,
};

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

  const rl = createInterface({
    input: stdin,
    output: stdout,
    terminal: true,
    prompt: chalk.cyan("you › "),
  });
  rl.prompt();

  // Serial line processing: while a turn is running, incoming "line"
  // events are ignored (they just print another prompt). Prevents
  // stomping on an in-flight cycle.
  let busy = false;

  // Wrap the whole REPL in a promise that resolves on rl 'close'.
  // runChat awaits this promise, which keeps the Node event loop
  // alive for the duration of the chat session.
  await new Promise<void>((resolve) => {
    const handleLine = async (line: string): Promise<void> => {
      if (busy) {
        rl.prompt();
        return;
      }
      busy = true;

      const input = line.trim();
      if (!input) {
        busy = false;
        rl.prompt();
        return;
      }

      try {
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
          if (action === "exit") {
            rl.close();
            return;
          }
          busy = false;
          rl.prompt();
          return;
        }

        history.push({ role: "user", content: input, ts: Date.now() });
        const stopThinking = startThinking(agentName);

        let r;
        try {
          const recent = history.slice(-HISTORY_LIMIT - 1, -1);
          r = await runCycle({
            profile: opts.profile,
            task: input,
            modelOverride,
            sessionHistory: recent,
          });
        } finally {
          stopThinking();
        }

        if (!r.ok) {
          console.log(chalk.red(`${agentName} › `) + chalk.red(r.error ?? "(error)"));
          console.log("");
          history.pop();
        } else {
          console.log(chalk.green(`${agentName} › `) + r.text);
          console.log("");
          history.push({ role: "assistant", content: r.text, ts: Date.now() });
          stats.turnCount += 1;
          stats.inputTokens += r.inputTokens ?? 0;
          stats.outputTokens += r.outputTokens ?? 0;
          stats.costUsd += r.costUsd ?? 0;
          printStatusLine(r, cfg);
        }
      } catch (e) {
        console.log(chalk.red("error: ") + (e as Error).message);
        console.log("");
      } finally {
        busy = false;
        rl.prompt();
      }
    };

    rl.on("line", (line) => {
      // fire-and-forget; errors are caught inside handleLine
      void handleLine(line);
    });

    rl.on("close", () => {
      printSessionSummary(stats);
      resolve();
    });
  });
}

// ───────────────────────────────────────────────────────────────
// "thinking…" animation — plain-text interval, no ora
// ───────────────────────────────────────────────────────────────

function startThinking(agentName: string): () => void {
  let dots = 0;
  const render = () => {
    // clear line + move cursor to column 0, then write status
    const bar = ".".repeat((dots % 3) + 1).padEnd(3, " ");
    stdout.write(`\r\x1b[2K${chalk.dim(`${agentName} is thinking${bar}`)}`);
    dots += 1;
  };
  render();
  const timer = setInterval(render, 400);
  return () => {
    clearInterval(timer);
    // clear the line so the response starts clean
    stdout.write("\r\x1b[2K");
  };
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
  const ctx = CTX_TOKENS[tier];
  const budget = budgetFor(tier);

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
  console.log(`${chalk.bold("  effort    ")} ${cfg.effort}`);
  console.log(`${chalk.bold("  context   ")} ${formatNum(ctx)} tokens · ${budget.maxTurns}-turn cap per cycle`);
  console.log("");
  console.log(`${chalk.bold("  5h usage  ")} ${formatUsage(fiveH)}`);
  console.log(`${chalk.bold("  week      ")} ${formatUsage(week)}`);
  console.log(chalk.dim("  (advisory counts from your local cycle log — compare to your plan)"));
  console.log("");
  console.log(chalk.dim("  /help for commands · /exit or Ctrl-D to quit"));
  console.log(chalk.bold.cyan("╰" + "─".repeat(58) + "╯"));
  console.log("");
}

function printStatusLine(r: Awaited<ReturnType<typeof runCycle>>, cfg: AgentConfig): void {
  const bits: string[] = [];
  if (r.model) bits.push(chalk.magenta(shortModel(r.model)));
  bits.push(chalk.dim(cfg.effort));
  if (r.inputTokens != null || r.outputTokens != null) {
    bits.push(chalk.dim(`${formatNum(r.inputTokens ?? 0)} in / ${formatNum(r.outputTokens ?? 0)} out`));
  }
  bits.push(chalk.dim(`${(r.durationMs / 1000).toFixed(1)}s`));
  if (r.costUsd != null) bits.push(chalk.dim(`$${r.costUsd.toFixed(4)}`));
  bits.push(chalk.dim(`#${r.cycleId}`));
  console.log(chalk.dim("· ") + bits.join(chalk.dim(" · ")) + chalk.dim(" ·"));
  console.log("");
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
      console.log(`${chalk.bold("context window:  ")} ${formatNum(CTX_TOKENS[tier])} tokens (${tier})`);
      console.log(`${chalk.bold("per-cycle budget:")} ${budget.memoryCount} memories · ${budget.skillCount} skills · ${budget.maxTurns} turns`);
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
        console.log(chalk.dim("set with: /effort low | medium | high"));
        console.log("");
        return "continue";
      }
      const level = arg.toLowerCase();
      if (level !== "low" && level !== "medium" && level !== "high") {
        console.log(chalk.red("must be one of: low, medium, high"));
        console.log("");
        return "continue";
      }
      ctx.cfg.effort = level;
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
          console.log(chalk.dim(`no trigger — ${decision.reason}. Running anyway (--force).`));
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
  console.log(`  ${chalk.cyan("/effort [low|medium|high]")}   show or set effort`);
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
