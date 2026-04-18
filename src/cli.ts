#!/usr/bin/env node
import { Command } from "commander";
import { runInit } from "./commands/init.js";
import { runStart } from "./commands/start.js";
import { runDoctor } from "./commands/doctor.js";
import { runDryRun } from "./commands/dry-run.js";
import { runStatus } from "./commands/status.js";
import { runHealthCmd } from "./commands/health.js";
import { runMigrate } from "./commands/migrate.js";
import { runDashboard } from "./commands/dashboard.js";
import { runTrigger } from "./commands/trigger.js";
import { runUpdate, maybeNoticeAtExit } from "./commands/update.js";
import { runSetup, autoBootstrapIfNeeded, DEFAULT_PROFILE_NAME, isFirstRun, markFirstRunDone } from "./commands/setup.js";
import { runHealth } from "./health-check.js";
import chalk from "chalk";
import { runUninstall } from "./commands/uninstall.js";
import { cmdSkillPort, cmdMcpPort, listDesktopServers } from "./commands/port.js";
import { runModel } from "./commands/model.js";
import { runEffort } from "./commands/effort.js";
import { runGuide } from "./commands/guide.js";
import { runServe } from "./commands/serve.js";
import { runPersonaCmd } from "./commands/persona.js";
import { runCompact } from "./commands/compact.js";
import { runChat } from "./commands/chat.js";
import * as subagent from "./commands/subagent.js";
import { currentVersion } from "./updater.js";
import { printBanner } from "./banner.js";
import * as mcp from "./commands/mcp.js";
import * as skill from "./commands/skill.js";
import * as profile from "./commands/profile.js";
import * as daemon from "./commands/daemon.js";
import * as channel from "./commands/channel.js";

const pkg = { name: "bajaclaw", version: currentVersion() };

function defaultProfile(explicit?: string): string {
  return explicit ?? process.env.BAJACLAW_PROFILE ?? DEFAULT_PROFILE_NAME;
}

const program = new Command();
program.name(pkg.name).description("BajaClaw — autonomous agents on your terms").version(pkg.version);

program
  .command("init [name]")
  .description("Scaffold a new agent profile")
  .option("--template <name>", "outreach|research|support|social|code|custom", "custom")
  .option("--model <id>", "auto|claude-opus-4-7|claude-sonnet-4-6|claude-haiku-4-5", "auto")
  .option("--effort <level>", "low|medium|high", "medium")
  .option("--force", "overwrite existing profile")
  .action(async (name, opts) => {
    const n = name ?? process.env.BAJACLAW_PROFILE;
    if (!n) { console.error("usage: bajaclaw init <name>"); process.exit(2); }
    await runInit({ name: n, template: opts.template, model: opts.model, effort: opts.effort, force: !!opts.force });
  });

program
  .command("chat [profile]")
  .description("Interactive chat REPL — converse with the agent turn-by-turn")
  .option("--model <id>", "model or alias (auto|haiku|sonnet|opus|<full-id>)")
  .action(async (p, opts) => {
    const target = defaultProfile(p);
    if (target === DEFAULT_PROFILE_NAME) await autoBootstrapIfNeeded();
    await runChat({ profile: target, model: opts.model });
  });

program
  .command("start [profile]")
  .description("Run one cycle (auto-bootstraps the default profile on first run)")
  .option("--task <text>", "override task")
  .option("--dry-run", "assemble prompt and print, no exec")
  .action(async (p, opts) => {
    const target = defaultProfile(p);
    if (target === DEFAULT_PROFILE_NAME) await autoBootstrapIfNeeded();
    await runStart({ profile: target, task: opts.task, dryRun: !!opts.dryRun });
  });

program.command("dry-run [profile]").description("Show assembled prompt without executing")
  .option("--task <text>")
  .action(async (p, opts) => runDryRun(defaultProfile(p), opts.task));

program.command("doctor").description("Check toolchain + backend").action(runDoctor);
program.command("status [profile]").description("Summary stats").action(async (p) => runStatus(p));
program.command("health [profile]").description("Breaker + rate limit + recent cycles").action(async (p) => runHealthCmd(defaultProfile(p)));
program.command("dashboard [profile]").description("Serve dashboard HTML").action(async (p) => runDashboard(defaultProfile(p)));

program.command("migrate [profile]").description("Import from a foreign profile directory (strips legacy artifacts)")
  .requiredOption("--from-yonderclaw <dir>", "path to yonderclaw directory")
  .action(async (p, opts) => runMigrate(defaultProfile(p), opts.fromYonderclaw));

program.command("trigger [profile]")
  .description("Enqueue an event/task")
  .argument("<event>")
  .option("--body <text>")
  .action(async (p, event, opts) => runTrigger(defaultProfile(p), event, opts.body));

// MCP group
const mcpCmd = program.command("mcp").description("MCP consume + serve");
mcpCmd.command("list [profile]").action(async (p) => mcp.cmdList(defaultProfile(p)));
mcpCmd.command("add [profile]").requiredOption("--command <cmd>").option("--args <args...>", "").option("--env <kv...>", "")
  .argument("<name>")
  .action(async (p, name, opts) => {
    const env: Record<string, string> = {};
    for (const pair of (opts.env ?? [])) {
      const [k, ...rest] = pair.split("=");
      if (k) env[k] = rest.join("=");
    }
    await mcp.cmdAdd(defaultProfile(p), name, opts.command, opts.args ?? [], env);
  });
mcpCmd.command("remove [profile]").argument("<name>").action(async (p, name) => mcp.cmdRemove(defaultProfile(p), name));
mcpCmd.command("serve").option("--stdio").option("--port <n>").option("--profile <name>")
  .action(async (opts) => mcp.cmdServe({ profile: opts.profile, port: opts.port ? Number(opts.port) : undefined, stdio: !!opts.stdio }));
mcpCmd.command("register [profile]").action(async (p) => mcp.cmdRegister(p));
mcpCmd.command("port")
  .description("Port MCP servers from the desktop config into BajaClaw's user MCP config")
  .option("--names <names...>", "specific server name(s) (default: all non-self)")
  .option("--force", "overwrite existing entries")
  .option("--list", "list available desktop servers without porting")
  .action(async (opts) => {
    if (opts.list) {
      const names = listDesktopServers();
      if (names.length === 0) console.log("(none)");
      else for (const n of names) console.log(n);
      return;
    }
    await cmdMcpPort({ names: opts.names, force: !!opts.force });
  });

// Skills group
const skillCmd = program.command("skill").description("Skills across scopes");
skillCmd.command("list [profile]").action(async (p) => skill.cmdList(defaultProfile(p)));
skillCmd.command("new").argument("<name>").option("--profile <p>").option("--scope <s>", "user|profile", "user")
  .action(async (name, opts) => skill.cmdNew(name, opts.scope, opts.profile));
skillCmd.command("install").argument("<source>").option("--scope <s>", "user|profile", "user").option("--profile <p>")
  .action(async (source, opts) => skill.cmdInstall(source, opts.scope, opts.profile));
skillCmd.command("review").action(skill.cmdReview);
skillCmd.command("promote")
  .description("Move an auto-generated skill from review into the user scope")
  .argument("<name>")
  .option("--force", "overwrite existing skill with the same name")
  .action(async (name, opts) => skill.cmdPromote(name, { force: !!opts.force }));
skillCmd.command("port")
  .description("Port skills from the desktop CLI scope into BajaClaw's scope")
  .option("--source <dir>", "source dir (default: ~/.claude/skills)")
  .option("--scope <s>", "destination scope: user|profile|agent", "user")
  .option("--profile <p>", "profile name (required for scope=profile|agent)")
  .option("--link", "symlink instead of copy (live reflects upstream)")
  .option("--force", "overwrite existing skills")
  .option("--names <names...>", "specific skill name(s) to port (default: all)")
  .action(async (opts) => cmdSkillPort({
    source: opts.source,
    scope: opts.scope,
    profile: opts.profile,
    link: !!opts.link,
    force: !!opts.force,
    names: opts.names,
  }));

// Profile group
const profCmd = program.command("profile").description("Manage profiles");
profCmd.command("list").action(profile.cmdList);
profCmd.command("create").argument("<name>").option("--template <t>", "", "custom").action(async (n, o) => profile.cmdCreate(n, o.template));
profCmd.command("switch").argument("<name>").action(profile.cmdSwitch);
profCmd.command("delete").argument("<name>").option("--yes").action(async (n, o) => profile.cmdDelete(n, !!o.yes));

// Daemon group
const daemonCmd = program.command("daemon").description("Heartbeat daemon");
daemonCmd.command("start [profile]").option("--fg").action(async (p, o) => daemon.cmdStart(defaultProfile(p), !!o.fg));
daemonCmd.command("stop [profile]").action(async (p) => daemon.cmdStop(defaultProfile(p)));
daemonCmd.command("status [profile]").action(async (p) => daemon.cmdStatus(defaultProfile(p)));
daemonCmd.command("logs [profile]").option("--lines <n>", "", "50").action(async (p, o) => daemon.cmdLogs(defaultProfile(p), Number(o.lines)));
daemonCmd.command("restart [profile]").action(async (p) => daemon.cmdRestart(defaultProfile(p)));
daemonCmd.command("install [profile]").action(async (p) => daemon.cmdInstall(defaultProfile(p)));
daemonCmd.command("run [profile]").action(async (p) => daemon.cmdRun(defaultProfile(p)));

// Channel group
const chanCmd = program.command("channel").description("Messaging channels");
chanCmd.command("add [profile]").argument("<kind>").requiredOption("--token <t>").option("--channel-id <id>").option("--user-id <id>")
  .action(async (p, kind, o) => channel.cmdAdd(defaultProfile(p), kind as "telegram" | "discord", o.token, o.channelId, o.userId));
chanCmd.command("remove [profile]").argument("<kind>").action(async (p, kind) => channel.cmdRemove(defaultProfile(p), kind as "telegram" | "discord"));
chanCmd.command("list [profile]").action(async (p) => channel.cmdList(defaultProfile(p)));

// Update
program.command("update").description("Check for and install a newer version")
  .option("--check", "only check; don't install")
  .option("--yes", "apply without confirmation")
  .action(async (opts) => runUpdate({ check: !!opts.check, yes: !!opts.yes }));

// Setup — idempotent first-run bootstrap. Safe to rerun. Interactive
// persona wizard on a TTY the first time; non-interactive otherwise.
program.command("setup").description("Idempotent first-run bootstrap (profile, MCP register, persona wizard, health check)")
  .option("--profile <name>", "profile name (default: 'default')")
  .option("--template <t>", "template: outreach|research|support|social|code|custom", "custom")
  .option("--model <id>", "model id (default: auto)", "auto")
  .option("--skip-mcp-register", "don't touch desktop MCP config")
  .option("--silent", "no output")
  .option("--interactive", "force interactive wizard even if persona exists")
  .option("--non-interactive", "skip the wizard; just scaffold with defaults")
  .action(async (opts) => runSetup({
    profile: opts.profile,
    template: opts.template,
    model: opts.model,
    skipMcpRegister: !!opts.skipMcpRegister,
    silent: !!opts.silent,
    interactive: !!opts.interactive,
    nonInteractive: !!opts.nonInteractive,
  }));

// Compact — run memory compaction (or show what would run)
program.command("compact [profile]")
  .description("Compact memory (summarize old entries, prune stale cycle rows)")
  .option("--dry-run", "show trigger state and policy without running")
  .option("--force", "run even if no trigger fired")
  .option("--schedule <mode>", "set schedule mode: threshold|daily|both|off")
  .option("--threshold <frac>", "set threshold fraction (0-1), e.g. 0.75")
  .option("--daily-at <HH:MM>", "set daily UTC time, e.g. 00:00")
  .option("--keep <n>", "set keepRecentPerKind (int)")
  .option("--prune-days <n>", "set pruneCycleDays (int, 0 disables)")
  .option("--enable", "enable compaction")
  .option("--disable", "disable compaction")
  .action(async (p, opts) => {
    const set: Record<string, unknown> = {};
    if (opts.schedule) set.schedule = opts.schedule;
    if (opts.threshold) set.threshold = Number(opts.threshold);
    if (opts.dailyAt) set.dailyAtUtc = String(opts.dailyAt);
    if (opts.keep) set.keepRecentPerKind = Number(opts.keep);
    if (opts.pruneDays) set.pruneCycleDays = Number(opts.pruneDays);
    if (opts.enable) set.enabled = true;
    if (opts.disable) set.enabled = false;
    await runCompact({
      profile: defaultProfile(p),
      force: !!opts.force,
      dryRun: !!opts.dryRun,
      set: Object.keys(set).length > 0 ? (set as never) : undefined,
    });
  });

// Persona — view or re-run the wizard
program.command("persona [profile]")
  .description("Show or edit the agent's persona (name, tone, user name, focus)")
  .option("--edit", "re-run the interactive wizard")
  .option("--reset", "discard current persona and start fresh")
  .action(async (p, opts) => runPersonaCmd({ profile: p, edit: !!opts.edit, reset: !!opts.reset }));

// Sub-agent group
const subCmd = program.command("subagent").description("Sub-agent management (orchestrator + scoped helpers)");
subCmd.command("create <name>")
  .description("Scaffold a sub-agent under a parent profile")
  .requiredOption("--parent <p>", "parent profile (orchestrator)")
  .option("--template <t>", "template (default: custom)", "custom")
  .option("--model <id>", "model (default: auto)")
  .option("--allowed-tools <list>", "comma-separated allowed tools")
  .option("--disallowed-tools <list>", "comma-separated disallowed tools")
  .option("--description <text>", "one-line purpose (seeded into SOUL.md)")
  .action(async (name, opts) => subagent.cmdCreate({
    name,
    parent: opts.parent,
    template: opts.template,
    model: opts.model,
    allowedTools: opts.allowedTools ? String(opts.allowedTools).split(",").map((s: string) => s.trim()).filter(Boolean) : undefined,
    disallowedTools: opts.disallowedTools ? String(opts.disallowedTools).split(",").map((s: string) => s.trim()).filter(Boolean) : undefined,
    description: opts.description,
  }));
subCmd.command("list [parent]")
  .description("List sub-agents under a parent (or the whole tree if omitted)")
  .action(async (p) => subagent.cmdList(p));

// Delegate — orchestrators call this via Bash to hand off a task
program.command("delegate <subagent> <task>")
  .description("Run one cycle on a sub-agent and stream its response text to stdout")
  .option("--json", "output full CycleOutput JSON instead of just text")
  .action(async (sub, task, opts) => subagent.cmdDelegate(sub, task, { json: !!opts.json }));

// Uninstall — full teardown.
program.command("uninstall").description("Remove all BajaClaw state (profiles, scheduler, MCP, memory sync)")
  .option("--yes", "actually perform the teardown")
  .option("--keep-data", "keep ~/.bajaclaw/ data; only remove integrations")
  .action(async (opts) => runUninstall({ yes: !!opts.yes, keepData: !!opts.keepData }));

// Model — show or set per profile
program.command("model [value] [profile]")
  .description("Show or set the model for a profile (no value: lists known models)")
  .action(async (value, p) => runModel(value, { profile: p }));

// Effort — show or set per profile
program.command("effort [value] [profile]")
  .description("Show or set the effort level (low/medium/high) for a profile")
  .action(async (value, p) => runEffort(value, { profile: p }));

// Guide — print a self-setup walkthrough
program.command("guide [topic]")
  .description("Print a self-setup walkthrough, or list available guides")
  .option("--profile <name>", "profile to use for skill lookup")
  .action(async (topic, opts) => runGuide(topic, { profile: opts.profile }));

// Serve — OpenAI-compatible HTTP endpoint
program.command("serve")
  .description("Serve BajaClaw over an OpenAI-compatible HTTP API")
  .option("--host <host>", "bind host (default 127.0.0.1)")
  .option("--port <n>", "bind port (default 8765)")
  .option("--api-key <key>", "require this bearer token (required for non-localhost bind)")
  .option("--expose <names...>", "allowlist of profile names (default: all)")
  .option("--stream-delay <ms>", "delay between streamed chunks (default 20)")
  .action(async (opts) => runServe({
    host: opts.host,
    port: opts.port ? Number(opts.port) : undefined,
    apiKey: opts.apiKey,
    exposedProfiles: opts.expose,
    streamDelayMs: opts.streamDelay ? Number(opts.streamDelay) : undefined,
  }));

// Banner
program.command("banner").description("Print the ASCII banner").action(() => {
  printBanner(pkg.version, { force: true });
});

// Welcome — first-run greeting; also callable anytime
program.command("welcome").description("Print the welcome banner + next steps")
  .action(async () => {
    await printWelcome({ force: true });
  });

async function printWelcome(opts: { force?: boolean } = {}): Promise<void> {
  printBanner(pkg.version, { force: true });
  console.log("");
  console.log(chalk.bold.green("Welcome to BajaClaw."));
  console.log("");
  console.log(chalk.dim("Your default profile is ready at ~/.bajaclaw/profiles/default/"));
  console.log("");

  try {
    const checks = await runHealth();
    const backend = checks.find((c) => c.name === "cli backend");
    if (!backend?.ok) {
      console.log(chalk.yellow("!  `claude` CLI backend not on your PATH"));
      console.log(chalk.dim("   BajaClaw drives it as a subprocess. Install from:"));
      console.log(chalk.dim("   https://docs.claude.com/en/docs/claude-code/setup"));
      console.log(chalk.dim("   Without it, only `--dry-run` cycles work."));
      console.log("");
    } else {
      console.log(chalk.green("✓ ") + chalk.dim(`claude backend: ${backend.detail}`));
      console.log("");
    }
  } catch { /* health check optional */ }

  console.log(chalk.bold("Start chatting:"));
  console.log(`  ${chalk.cyan("bajaclaw chat")}                   ${chalk.dim("# interactive REPL — talk to your agent")}`);
  console.log("");
  console.log(chalk.bold("First-time setup:"));
  console.log(`  ${chalk.cyan("bajaclaw setup --interactive")}    ${chalk.dim("# name your agent, set tone, topics, don'ts")}`);
  console.log(`  ${chalk.cyan("bajaclaw doctor")}                 ${chalk.dim("# full toolchain check")}`);
  console.log(`  ${chalk.cyan("bajaclaw start")}                  ${chalk.dim("# one scheduled cycle (non-interactive)")}`);
  console.log("");
  console.log(chalk.bold("Common commands:"));
  console.log(`  ${chalk.cyan("bajaclaw dashboard")}              ${chalk.dim("# http://localhost:7337")}`);
  console.log(`  ${chalk.cyan("bajaclaw daemon install")}         ${chalk.dim("# schedule heartbeat cycles")}`);
  console.log(`  ${chalk.cyan("bajaclaw serve")}                  ${chalk.dim("# OpenAI-compatible HTTP API")}`);
  console.log(`  ${chalk.cyan("bajaclaw guide")}                  ${chalk.dim("# built-in setup walkthroughs")}`);
  console.log(`  ${chalk.cyan("bajaclaw compact")}                ${chalk.dim("# keep memory lean as the agent learns")}`);
  console.log(`  ${chalk.cyan("bajaclaw persona --edit")}         ${chalk.dim("# change your agent's personality")}`);
  console.log("");
  console.log(chalk.dim("Docs: https://github.com/backyarddd/BajaClaw"));
  console.log(chalk.dim("See `bajaclaw --help` for the full command list."));
  console.log("");
  void opts.force;
}

// First-run hook: show the welcome before the user's first command.
// Marks done so it only fires once per install.
async function maybeShowWelcome(): Promise<void> {
  if (!isFirstRun()) return;
  // Only show when stdout is a TTY. npm captures postinstall output,
  // so firing the welcome during `npm install` prints to the void and
  // then marks done — defeating the point. Non-TTY: silent no-op, don't
  // even mark done, so the next interactive run still gets the welcome.
  if (!process.stdout.isTTY) return;
  const cmd = process.argv[2];
  const skip = new Set([
    "uninstall", "update", "banner", "welcome", "setup", "init",
    "--version", "-V", "--help", "-h",
  ]);
  if (cmd && skip.has(cmd)) { markFirstRunDone(); return; }
  await printWelcome();
  markFirstRunDone();
}

program.hook("postAction", async () => {
  // Non-blocking notice at the end of any command. Skipped for noisy or
  // self-referential commands.
  const cmd = process.argv[2];
  if (cmd === "update" || cmd === "banner" || cmd === "uninstall" || cmd === "setup") return;
  await maybeNoticeAtExit();
});

// Run the first-run welcome before command dispatch. Non-blocking —
// a failure here should never prevent the user's command from running.
await maybeShowWelcome().catch(() => { /* silent */ });

// Await the parse so long-running interactive commands (like `chat`)
// keep the event loop alive until they finish. Without the await, the
// top-level module completes synchronously and Node may exit before
// the command's action runs to completion.
try {
  await program.parseAsync(process.argv);
} catch (e) {
  console.error(`error: ${(e as Error).message}`);
  process.exit(1);
}
