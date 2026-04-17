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
import { runSetup, autoBootstrapIfNeeded, DEFAULT_PROFILE_NAME } from "./commands/setup.js";
import { runUninstall } from "./commands/uninstall.js";
import { cmdSkillPort, cmdMcpPort, listDesktopServers } from "./commands/port.js";
import { runModel } from "./commands/model.js";
import { runEffort } from "./commands/effort.js";
import { runGuide } from "./commands/guide.js";
import { runServe } from "./commands/serve.js";
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
  .option("--model <id>", "claude-opus-4-5|claude-sonnet-4-5|claude-haiku-4-5", "claude-sonnet-4-5")
  .option("--effort <level>", "low|medium|high", "medium")
  .option("--force", "overwrite existing profile")
  .action(async (name, opts) => {
    const n = name ?? process.env.BAJACLAW_PROFILE;
    if (!n) { console.error("usage: bajaclaw init <name>"); process.exit(2); }
    await runInit({ name: n, template: opts.template, model: opts.model, effort: opts.effort, force: !!opts.force });
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
chanCmd.command("add [profile]").argument("<kind>").requiredOption("--token <t>").option("--channel-id <id>")
  .action(async (p, kind, o) => channel.cmdAdd(defaultProfile(p), kind as "telegram" | "discord", o.token, o.channelId));
chanCmd.command("remove [profile]").argument("<kind>").action(async (p, kind) => channel.cmdRemove(defaultProfile(p), kind as "telegram" | "discord"));
chanCmd.command("list [profile]").action(async (p) => channel.cmdList(defaultProfile(p)));

// Update
program.command("update").description("Check for and install a newer version")
  .option("--check", "only check; don't install")
  .option("--yes", "apply without confirmation")
  .action(async (opts) => runUpdate({ check: !!opts.check, yes: !!opts.yes }));

// Setup — idempotent first-run bootstrap. Safe to rerun.
program.command("setup").description("Idempotent first-run bootstrap (default profile + MCP register + health check)")
  .option("--profile <name>", "profile name (default: 'default')")
  .option("--template <t>", "template: outreach|research|support|social|code|custom", "custom")
  .option("--model <id>", "model id", "claude-sonnet-4-5")
  .option("--skip-mcp-register", "don't touch desktop MCP config")
  .option("--silent", "no output")
  .action(async (opts) => runSetup({
    profile: opts.profile,
    template: opts.template,
    model: opts.model,
    skipMcpRegister: !!opts.skipMcpRegister,
    silent: !!opts.silent,
  }));

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

program.hook("postAction", async () => {
  // Non-blocking notice at the end of any command. Skipped for noisy or
  // self-referential commands.
  const cmd = process.argv[2];
  if (cmd === "update" || cmd === "banner" || cmd === "uninstall" || cmd === "setup") return;
  await maybeNoticeAtExit();
});

program.parseAsync(process.argv).catch((e) => {
  console.error(`error: ${(e as Error).message}`);
  process.exit(1);
});
