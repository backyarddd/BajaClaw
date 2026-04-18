// Idempotent first-run bootstrap. Safe to re-run.
//
// Interactive by default on a TTY: asks the user to name their agent,
// pick a tone, set their own preferred name, timezone, focus area,
// any topics the agent should know, and any hard "don't" rules.
// Non-interactive (--silent, postinstall, pipes) falls back to sane
// defaults — nothing blocks.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import {
  bajaclawHome,
  profileDir,
  claudeAgentsDir,
  ensureDir,
} from "../paths.js";
import { runInit } from "./init.js";
import { runHealth } from "../health-check.js";
import { printBanner } from "../banner.js";
import { currentVersion } from "../updater.js";
import { cmdRegister } from "./mcp.js";
import { ask, askChoice, askList, detectTimezone, isInteractive } from "../prompt.js";
import { loadPersona, savePersona } from "../persona-io.js";
import { TONE_OPTIONS, type Persona } from "../persona.js";
import { loadConfig, saveConfig } from "../config.js";
import { mergeCompactionDefaults } from "../memory/compact.js";
import type { CompactionConfig } from "../types.js";

export const DEFAULT_PROFILE_NAME =
  process.env.BAJACLAW_DEFAULT_PROFILE ?? "default";

export interface SetupOptions {
  profile?: string;
  template?: string;
  model?: string;
  skipMcpRegister?: boolean;
  skipBanner?: boolean;
  silent?: boolean;
  // Force the interactive wizard even on a non-TTY (for testing).
  interactive?: boolean;
  // Skip the interactive wizard entirely and just scaffold.
  nonInteractive?: boolean;
}

export async function runSetup(opts: SetupOptions = {}): Promise<void> {
  const name = opts.profile ?? DEFAULT_PROFILE_NAME;
  const template = (opts.template ?? "custom") as
    | "outreach" | "research" | "support" | "social" | "code" | "custom";
  const model = opts.model ?? "auto";

  if (!opts.skipBanner && !opts.silent) printBanner(currentVersion(), { force: true });

  const profileExisted = existsSync(profileDir(name)) && existsSync(join(profileDir(name), "config.json"));

  if (!profileExisted) {
    if (!opts.silent) console.log(chalk.cyan(`Creating profile "${name}"…`));
    await runInit({ name, template, model: model as never });
  } else if (!opts.silent) {
    console.log(chalk.dim(`✓ profile "${name}" already exists`));
  }

  ensureAgentDescriptor(name);

  // Interactive persona wizard on first setup (or re-ask on explicit --interactive).
  const wantWizard = !opts.silent && !opts.nonInteractive && (opts.interactive || (isInteractive() && !loadPersona(name)));
  if (wantWizard) {
    console.log("");
    console.log(chalk.bold("Let's set up your agent's personality."));
    console.log(chalk.dim("This is an agent, not a chatbot. These answers tell it who it is and how to work for you."));
    console.log("");
    try {
      const persona = await promptPersona(name);
      savePersona(name, persona);
      console.log("");
      console.log(chalk.green(`✓ persona saved to ${profileDir(name)}/SOUL.md`));
    } catch (e) {
      console.log(chalk.yellow(`(skipped persona wizard: ${(e as Error).message})`));
    }
  } else if (!opts.silent && loadPersona(name)) {
    console.log(chalk.dim(`✓ persona already set — run \`bajaclaw persona\` to change`));
  }

  if (wantWizard) {
    try {
      const comp = await promptCompaction(name);
      const cfg = loadConfig(name);
      cfg.compaction = comp;
      saveConfig(cfg);
      console.log(chalk.green(`✓ compaction policy saved`));
    } catch (e) {
      if (!opts.silent) console.log(chalk.yellow(`(skipped compaction setup: ${(e as Error).message})`));
    }
  }

  if (!opts.skipMcpRegister) {
    try { await cmdRegister(name); }
    catch (e) { if (!opts.silent) console.log(chalk.yellow(`mcp register: ${(e as Error).message}`)); }
  }

  if (!opts.silent) {
    console.log("");
    console.log(chalk.bold("Toolchain check:"));
    const checks = await runHealth();
    for (const c of checks) {
      const mark = c.ok ? chalk.green("✓") : chalk.yellow("!");
      console.log(`  ${mark} ${c.name.padEnd(22)} ${chalk.dim(c.detail)}`);
    }
    const backend = checks.find((c) => c.name === "cli backend");
    if (!backend?.ok) {
      console.log("");
      console.log(chalk.yellow("Note: the `claude` CLI backend is not on your PATH."));
      console.log(chalk.yellow("BajaClaw drives it as a subprocess — install it to run live cycles."));
      console.log(chalk.dim("Dry-run still works: `bajaclaw start --dry-run`"));
    }
    console.log("");
    console.log(chalk.green.bold("BajaClaw is set up."));
    console.log("");
    console.log("Try:");
    console.log(`  ${chalk.cyan("bajaclaw start --dry-run")}       ${chalk.dim("# see the assembled prompt")}`);
    console.log(`  ${chalk.cyan("bajaclaw start")}                  ${chalk.dim("# run a cycle")}`);
    console.log(`  ${chalk.cyan("bajaclaw dashboard")}              ${chalk.dim("# http://localhost:7337")}`);
    console.log(`  ${chalk.cyan("bajaclaw daemon install")}         ${chalk.dim("# schedule recurring heartbeat")}`);
    console.log(`  ${chalk.cyan("bajaclaw subagent create mail --parent " + name)} ${chalk.dim("# scoped helper agent")}`);
    console.log("");
  }
}

async function promptPersona(profile: string): Promise<Persona> {
  const existing = loadPersona(profile) ?? undefined;

  const agentName = await ask(
    chalk.bold("What should your agent call itself?"),
    existing?.agentName ?? "Baja",
  );

  const userName = await ask(
    chalk.bold("What should it call you?"),
    existing?.userName ?? "",
  );

  const tone = (await askChoice(
    chalk.bold("How should it talk to you?"),
    TONE_OPTIONS as string[],
    existing?.tone ?? "concise",
  )) as Persona["tone"];

  const tz = await ask(
    chalk.bold("What's your timezone?"),
    existing?.timezone ?? detectTimezone() ?? "",
  );

  console.log("");
  console.log(chalk.dim("Give your agent a purpose. One or two sentences — what is it here to do?"));
  const focus = await ask(chalk.bold("Focus:"), existing?.focus ?? "Help me get things done. Triage, drafts, and research on request.");

  console.log("");
  console.log(chalk.dim("Any topics, domains, or projects it should be aware of?"));
  const interests = await askList(chalk.bold("Interests:"));

  console.log("");
  console.log(chalk.dim("Any hard rules? Things it should never do. e.g. \"send email without approval\""));
  const doNots = await askList(chalk.bold("Don'ts:"));

  return {
    agentName: agentName || "Baja",
    userName: userName || undefined,
    tone,
    timezone: tz || undefined,
    focus: focus || undefined,
    interests: interests.length > 0 ? interests : (existing?.interests ?? undefined),
    doNots: doNots.length > 0 ? doNots : (existing?.doNots ?? undefined),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
}

async function promptCompaction(profile: string): Promise<CompactionConfig> {
  const existing = (() => {
    try { return loadConfig(profile).compaction; }
    catch { return undefined; }
  })();
  const base = mergeCompactionDefaults(existing);

  console.log("");
  console.log(chalk.dim("Agents learn over time. BajaClaw auto-compacts the memory pool so recall stays sharp."));
  console.log(chalk.dim("Default: when memory hits 75% of the 200k-token reference context, or daily at 00:00 UTC."));
  console.log("");

  const schedule = (await askChoice(
    chalk.bold("When should it compact?"),
    ["both (threshold + daily) — recommended", "threshold only", "daily only", "off"],
    "both (threshold + daily) — recommended",
  ));
  const mode: CompactionConfig["schedule"] =
    schedule.startsWith("both") ? "both"
    : schedule.startsWith("threshold") ? "threshold"
    : schedule.startsWith("daily") ? "daily"
    : "off";

  if (mode === "off") {
    return { ...base, enabled: false, schedule: "off" };
  }

  let threshold = base.threshold!;
  if (mode === "threshold" || mode === "both") {
    const raw = await ask(
      chalk.bold("Trigger at what fraction of context window? (0.5–0.95)"),
      String(base.threshold),
    );
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0.1 && n <= 0.99) threshold = n;
  }

  let dailyAtUtc = base.dailyAtUtc!;
  if (mode === "daily" || mode === "both") {
    const raw = await ask(
      chalk.bold("Daily time in UTC (HH:MM)?"),
      base.dailyAtUtc,
    );
    if (/^\d{2}:\d{2}$/.test(raw)) dailyAtUtc = raw;
  }

  return {
    enabled: true,
    schedule: mode,
    threshold,
    dailyAtUtc,
    keepRecentPerKind: base.keepRecentPerKind,
    pruneCycleDays: base.pruneCycleDays,
  };
}

function ensureAgentDescriptor(profile: string): void {
  const dir = ensureDir(claudeAgentsDir(profile));
  const path = join(dir, `${profile}.md`);
  if (existsSync(path)) return;
  const cfgPath = join(profileDir(profile), "config.json");
  if (!existsSync(cfgPath)) return;
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as {
    name: string; template: string; model: string; effort: string; maxTurns: number;
    disallowedTools?: string[];
  };
  const body = `---
name: ${cfg.name}
description: BajaClaw agent (${cfg.template}) — autonomous, runs on heartbeat
model: ${cfg.model}
effort: ${cfg.effort}
maxTurns: ${cfg.maxTurns}
${cfg.disallowedTools?.length ? `disallowedTools: [${cfg.disallowedTools.join(", ")}]\n` : ""}isolation: worktree
background: true
---

# ${cfg.name}

Paired BajaClaw profile: ~/.bajaclaw/profiles/${cfg.name}/
Template: ${cfg.template}

Operating guide lives in AGENT.md of the profile directory.
`;
  writeFileSync(path, body);
}

export function defaultProfileName(): string {
  return DEFAULT_PROFILE_NAME;
}

export function firstRunMarkerPath(): string {
  ensureDir(bajaclawHome());
  return join(bajaclawHome(), ".first-run-done");
}

export function isFirstRun(): boolean {
  return !existsSync(firstRunMarkerPath());
}

export function markFirstRunDone(): void {
  try { writeFileSync(firstRunMarkerPath(), new Date().toISOString()); } catch { /* silent */ }
}

export async function autoBootstrapIfNeeded(): Promise<void> {
  const p = join(bajaclawHome(), "profiles", DEFAULT_PROFILE_NAME, "config.json");
  if (existsSync(p)) return;
  await runSetup({ silent: true, skipMcpRegister: true, nonInteractive: true });
}
