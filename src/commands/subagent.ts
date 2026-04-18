// Sub-agent system.
//
// A sub-agent is a separate BajaClaw profile owned by an orchestrator.
// Each has its own config, tools, memory, and skill scopes. Permissions
// isolate naturally: if the orchestrator doesn't have the Read tool on
// the emails MCP but its `mail` sub-agent does, the orchestrator
// physically cannot read emails - it must delegate.
//
// Wiring:
//   - The parent profile's config.json gets `subAgents: ["mail", ...]`
//   - The child profile's config.json gets `parent: "<orchestrator>"`
//   - Commands: `bajaclaw subagent create`, `bajaclaw subagent list`,
//     `bajaclaw delegate <name> "<task>"`
//   - Built-in skill `delegate-to-subagent` teaches the orchestrator
//     when + how to delegate.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import chalk from "chalk";
import { loadConfig, saveConfig } from "../config.js";
import { runCycle } from "../agent.js";
import { runInit } from "./init.js";
import { profileDir, bajaclawHome } from "../paths.js";
import { join } from "node:path";

export interface SubAgentSpec {
  name: string;
  parent: string;
  template?: "outreach" | "research" | "support" | "social" | "code" | "custom";
  model?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  description?: string;
}

export async function cmdCreate(spec: SubAgentSpec): Promise<void> {
  if (!profileExists(spec.parent)) {
    throw new Error(`parent profile "${spec.parent}" not found. Run \`bajaclaw init ${spec.parent}\` or \`bajaclaw setup\` first.`);
  }
  if (profileExists(spec.name)) {
    throw new Error(`profile "${spec.name}" already exists. Pick a different name or run \`bajaclaw profile delete ${spec.name} --yes\` first.`);
  }

  await runInit({
    name: spec.name,
    template: (spec.template ?? "custom") as never,
    model: spec.model as never,
  });

  // Wire the child to its parent.
  const child = loadConfig(spec.name);
  child.parent = spec.parent;
  if (spec.allowedTools) child.allowedTools = spec.allowedTools;
  if (spec.disallowedTools) child.disallowedTools = spec.disallowedTools;
  saveConfig(child);

  // Register on the parent.
  const parent = loadConfig(spec.parent);
  parent.subAgents = Array.from(new Set([...(parent.subAgents ?? []), spec.name]));
  saveConfig(parent);

  if (spec.description) {
    // Seed a purpose line in the sub-agent's SOUL.md so it knows why it
    // exists.
    const soul = join(profileDir(spec.name), "SOUL.md");
    try {
      const current = existsSync(soul) ? readFileSync(soul, "utf8") : "";
      const appended = current +
        `\n\n## Purpose (as sub-agent of ${spec.parent})\n${spec.description}\n`;
      writeFileSync(soul, appended);
    } catch { /* non-fatal */ }
  }

  console.log(chalk.green(`✓ sub-agent ${chalk.bold(spec.name)} created under parent ${chalk.bold(spec.parent)}`));
  if (spec.allowedTools) console.log(chalk.dim(`  allowedTools:    ${spec.allowedTools.join(", ")}`));
  if (spec.disallowedTools) console.log(chalk.dim(`  disallowedTools: ${spec.disallowedTools.join(", ")}`));
  console.log("");
  console.log(chalk.dim("Try it:"));
  console.log(`  bajaclaw delegate ${spec.name} "say hi"`);
  console.log(`  bajaclaw start ${spec.name}    ${chalk.dim("# run the sub-agent directly")}`);
}

export async function cmdList(parent?: string): Promise<void> {
  if (parent) {
    const cfg = loadConfig(parent);
    const subs = cfg.subAgents ?? [];
    if (subs.length === 0) {
      console.log(chalk.dim(`no sub-agents registered on ${parent}.`));
      return;
    }
    console.log(chalk.bold(`sub-agents of ${parent}:`));
    for (const s of subs) {
      const row = summaryLine(s);
      console.log(`  ${row}`);
    }
    return;
  }
  // Show the whole tree across all profiles.
  const all = listAllProfiles();
  const orchestrators = all.filter((p) => (safeLoad(p)?.subAgents ?? []).length > 0);
  const orphans = all.filter((p) => {
    const c = safeLoad(p);
    return c && !c.parent && !(c.subAgents ?? []).length;
  });

  if (orchestrators.length === 0 && orphans.length === all.length) {
    console.log(chalk.dim("no sub-agent relationships. run `bajaclaw subagent create <name> --parent <main>` to start."));
    return;
  }

  for (const o of orchestrators) {
    console.log(chalk.bold(o));
    for (const s of safeLoad(o)?.subAgents ?? []) {
      console.log("  └─ " + summaryLine(s));
    }
  }
  const stray = all.filter((p) => {
    const c = safeLoad(p);
    if (!c) return false;
    if (c.parent && !profileExists(c.parent)) return true;
    return false;
  });
  if (stray.length > 0) {
    console.log("");
    console.log(chalk.yellow("orphaned (parent missing):"));
    for (const s of stray) console.log(`  ${s} -> ${safeLoad(s)?.parent}`);
  }
}

export async function cmdDelegate(sub: string, task: string, opts: { json?: boolean } = {}): Promise<void> {
  if (!profileExists(sub)) {
    throw new Error(`sub-agent "${sub}" not found`);
  }
  if (!task || !task.trim()) {
    throw new Error("task is required");
  }
  const r = await runCycle({ profile: sub, task });

  if (opts.json) {
    process.stdout.write(JSON.stringify({
      ok: r.ok,
      cycleId: r.cycleId,
      text: r.text,
      costUsd: r.costUsd,
      durationMs: r.durationMs,
      error: r.error,
    }) + "\n");
    if (!r.ok) process.exitCode = 1;
    return;
  }

  if (!r.ok) {
    console.error(chalk.red(`sub-agent ${sub} failed: ${r.error ?? "unknown"}`));
    process.exitCode = 1;
    return;
  }
  // Print just the text so a parent agent capturing this with Bash gets a
  // clean pipe.
  process.stdout.write(r.text);
  if (!r.text.endsWith("\n")) process.stdout.write("\n");
}

function summaryLine(name: string): string {
  const c = safeLoad(name);
  if (!c) return `${name} ${chalk.red("(missing)")}`;
  const tools = c.allowedTools?.length ? `allowed=${c.allowedTools.join(",")}` : "";
  const denied = c.disallowedTools?.length ? `denied=${c.disallowedTools.join(",")}` : "";
  return `${chalk.cyan(name.padEnd(20))} ${chalk.dim(`template=${c.template} model=${c.model}`)} ${chalk.dim(tools)} ${chalk.dim(denied)}`.trim();
}

function safeLoad(name: string): ReturnType<typeof loadConfig> | null {
  try { return loadConfig(name); } catch { return null; }
}

function profileExists(name: string): boolean {
  return safeLoad(name) !== null;
}

function listAllProfiles(): string[] {
  const dir = join(bajaclawHome(), "profiles");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => existsSync(join(dir, n, "config.json")));
}
