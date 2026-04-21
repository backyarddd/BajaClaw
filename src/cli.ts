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
import { loadPersona } from "./persona-io.js";
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
import { cmdEnsure, cmdEnsureList } from "./commands/ensure.js";
import { runWatch } from "./commands/watch.js";
import { runScreenshotCommand } from "./commands/screenshot.js";
import { cmdBrowserEnable, cmdBrowserDisable, cmdBrowserStatus } from "./commands/browser.js";
import { cmdImage } from "./commands/image.js";
import { cmdAttach } from "./commands/attach.js";
import { cmdTranscribe, cmdTts } from "./commands/voice.js";
import { cmdPlan, cmdPlanList, cmdPlanShow, cmdPlanApprove, cmdPlanCancel } from "./commands/plan.js";

const pkg = { name: "bajaclaw", version: currentVersion() };

function defaultProfile(explicit?: string): string {
  return explicit ?? process.env.BAJACLAW_PROFILE ?? DEFAULT_PROFILE_NAME;
}

const program = new Command();
program.name(pkg.name).description("BajaClaw - autonomous agents on your terms").version(pkg.version);

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
  .description("Interactive chat REPL - converse with the agent turn-by-turn")
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
skillCmd.command("install").argument("<source>")
  .description("Install a skill: clawhub:<slug>[@version], <slug>, URL (zip/tar.gz/SKILL.md), or local path")
  .option("--scope <s>", "user|profile", "user")
  .option("--profile <p>")
  .option("--yes", "skip confirmation")
  .option("--registry <url>", "override ClawHub registry (env: CLAWHUB_REGISTRY)")
  .action(async (source, opts) => skill.cmdInstall(source, {
    scope: opts.scope, profile: opts.profile, yes: !!opts.yes, registry: opts.registry,
  }));
skillCmd.command("search").argument("<query...>")
  .description("Search ClawHub for skills")
  .option("--registry <url>")
  .action(async (query: string[], opts) => skill.cmdSearch(query.join(" "), { registry: opts.registry }));
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
chanCmd.command("add [profile]")
  .argument("<kind>", "telegram | discord | imessage")
  .option("--token <t>", "bot token (telegram/discord)")
  .option("--channel-id <id>", "discord channel id, or telegram user id")
  .option("--user-id <id>", "allowlist user id (discord)")
  .option("--contact <handle...>", "iMessage contact to allow (phone or email); repeatable")
  .action(async (p, kind, o) => channel.cmdAdd(defaultProfile(p), kind as "telegram" | "discord" | "imessage", {
    token: o.token,
    channelId: o.channelId,
    userId: o.userId,
    contact: o.contact,
  }));
chanCmd.command("remove [profile]").argument("<kind>").action(async (p, kind) => channel.cmdRemove(defaultProfile(p), kind as "telegram" | "discord" | "imessage"));
chanCmd.command("list [profile]").action(async (p) => channel.cmdList(defaultProfile(p)));

// Ensure - fluid tool bootstrap. Skills and internal paths call this
// to make sure a CLI tool is installed and (optionally) authenticated
// before they depend on it. Cross-platform; detects package managers
// automatically; idempotent.
program.command("ensure <tool>")
  .description("Install and optionally authenticate a system tool (gh, vercel, supabase, ffmpeg, yt-dlp, tesseract, poppler)")
  .option("--auth", "also kick off the tool's login flow if needed")
  .option("--quiet", "suppress progress output; exit code still meaningful")
  .option("--json", "emit a structured JSON outcome on stdout")
  .option("--check-only", "check install state without modifying the system")
  .action(async (tool: string, opts) => cmdEnsure(tool, {
    auth: !!opts.auth,
    quiet: !!opts.quiet,
    json: !!opts.json,
    checkOnly: !!opts.checkOnly,
  }));

// Image - generate an image and save it to disk. Provider auto-selects
// from OPENAI_API_KEY (default gpt-image-1) or FAL_KEY (default
// fal-ai/flux/schnell). With --attach the image is also pushed to the
// originating channel via the same path as `bajaclaw attach`.
program.command("image <prompt>")
  .description("Generate an image from a text prompt (OpenAI or FAL)")
  .option("--profile <name>", "profile for default output dir")
  .option("--out <path>", "output path")
  .option("--provider <name>", "openai | fal (default: auto based on env keys)")
  .option("--model <id>", "override provider default model")
  .option("--size <dims>", "e.g. 1024x1024 (openai), landscape_4_3 (fal)")
  .option("--attach", "push the generated image to the originating channel (requires BAJACLAW_SOURCE or a recent chat)")
  .option("--caption <text>", "caption used on --attach; defaults to the prompt")
  .option("--quiet", "print only the output path")
  .action(async (prompt, opts) => cmdImage({
    profile: opts.profile,
    prompt,
    out: opts.out,
    provider: opts.provider,
    model: opts.model,
    size: opts.size,
    attach: !!opts.attach,
    caption: opts.caption,
    quiet: !!opts.quiet,
  }));

// Plan mode - the agent writes a structured plan instead of executing.
// Persists to the plans table with status=pending. User reviews then
// approves (enqueues a real task with the plan attached) or cancels.
const planCmd = program.command("plan").description("Plan mode: review the agent's plan before executing");
planCmd.command("create [profile]")
  .description("Generate a plan for a task and store it for review")
  .requiredOption("--task <text>", "task description")
  .option("--model <id>", "override model for the planning cycle")
  .action(async (p, opts) => cmdPlan({
    profile: defaultProfile(p),
    task: opts.task,
    modelOverride: opts.model,
  }));
planCmd.command("list [profile]")
  .description("List pending plans (--all for all statuses)")
  .option("--all", "include approved + cancelled")
  .action(async (p, opts) => cmdPlanList(defaultProfile(p), { all: !!opts.all }));
planCmd.command("show [profile]")
  .description("Show a stored plan in full")
  .requiredOption("--id <n>", "plan id")
  .action(async (p, opts) => cmdPlanShow(defaultProfile(p), Number(opts.id)));
planCmd.command("approve [profile]")
  .description("Approve a plan; enqueues a high-priority task with the plan attached")
  .requiredOption("--id <n>", "plan id")
  .option("--edited <text>", "use this text as the final plan instead of the stored one")
  .action(async (p, opts) => cmdPlanApprove(defaultProfile(p), Number(opts.id), { edited: opts.edited }));
planCmd.command("cancel [profile]")
  .description("Cancel a pending plan")
  .requiredOption("--id <n>", "plan id")
  .action(async (p, opts) => cmdPlanCancel(defaultProfile(p), Number(opts.id)));

// Transcribe - speech-to-text via OpenAI Whisper.
program.command("transcribe <path>")
  .description("Transcribe an audio file (requires OPENAI_API_KEY)")
  .option("--profile <name>")
  .option("--provider <name>", "openai (default)")
  .option("--model <id>", "override model (default: whisper-1)")
  .option("--language <code>", "BCP-47 language hint, e.g. en, es, ja")
  .option("--quiet", "print only the transcript")
  .action(async (path, opts) => cmdTranscribe({
    profile: opts.profile,
    path,
    provider: opts.provider,
    model: opts.model,
    language: opts.language,
    quiet: !!opts.quiet,
  }));

// TTS - text-to-speech. Picks OpenAI > ElevenLabs > macOS `say` fallback.
program.command("tts <text>")
  .description("Generate speech from text (OpenAI / ElevenLabs / macOS `say`)")
  .option("--profile <name>", "profile for default output dir")
  .option("--out <path>", "output path (default: <profileDir>/audio/<ts>.mp3)")
  .option("--provider <name>", "openai | elevenlabs | system (default: auto)")
  .option("--voice <name>", "voice id (openai: alloy/echo/fable/onyx/nova/shimmer; elevenlabs: voice id)")
  .option("--model <id>", "override provider default model")
  .option("--attach", "push the generated audio to the originating channel")
  .option("--caption <text>", "caption used on --attach")
  .option("--quiet", "print only the output path")
  .action(async (text, opts) => cmdTts({
    profile: opts.profile,
    text,
    out: opts.out,
    provider: opts.provider,
    voice: opts.voice,
    model: opts.model,
    attach: !!opts.attach,
    caption: opts.caption,
    quiet: !!opts.quiet,
  }));

// Attach - push a file attachment (image, document, etc.) to the
// originating channel of a running cycle. Analogue to `bajaclaw say`
// but for files. Reads BAJACLAW_SOURCE + BAJACLAW_DASHBOARD_PORT.
program.command("attach <path>")
  .description("Attach a file to the originating channel (used from inside a cycle)")
  .option("--caption <text>", "optional caption; shown inline on Telegram/Discord, as a follow-up on iMessage")
  .action(async (path, opts) => cmdAttach(path, { caption: opts.caption }));

// Browser - enable browser automation via @playwright/mcp. Adds an
// MCP server entry to the profile's mcp-config.json and runs
// `npx playwright install chromium` to pre-download the browser. The
// next cycle auto-discovers browser_* tools via MCP.
const browserCmd = program.command("browser").description("Browser automation via @playwright/mcp");
browserCmd.command("enable [profile]")
  .description("Enable browser tools for this profile (adds MCP server + installs chromium)")
  .option("--no-install", "skip chromium install (assumes playwright already set up)")
  .action(async (p, opts) => cmdBrowserEnable(defaultProfile(p), { install: opts.install !== false }));
browserCmd.command("disable [profile]")
  .description("Remove the browser MCP server from this profile")
  .action(async (p) => cmdBrowserDisable(defaultProfile(p)));
browserCmd.command("status [profile]")
  .description("Show whether the browser MCP server is enabled")
  .action(async (p) => cmdBrowserStatus(defaultProfile(p)));

// Screenshot - capture the screen (primary display) to a PNG.
// macOS uses screencapture, linux tries grim/scrot/maim/import,
// windows uses an inline PowerShell snippet. With --profile, saves
// to <profileDir>/screenshots/<timestamp>.png.
program.command("screenshot [output]")
  .description("Capture a screenshot (macOS/Linux/Windows). Default output: <profileDir>/screenshots/<ts>.png")
  .option("--profile <name>", "profile for default output dir")
  .option("-i, --interactive", "macOS: interactive selection (click window or drag region)")
  .option("--region <xywh>", "macOS: capture region x,y,w,h (e.g. 0,0,800,600)")
  .option("--display <n>", "macOS: 1-indexed display to capture")
  .option("--quiet", "print only the output path")
  .action(async (output, opts) => runScreenshotCommand({
    profile: opts.profile,
    output,
    interactive: !!opts.interactive,
    region: opts.region,
    display: opts.display ? Number(opts.display) : undefined,
    quiet: !!opts.quiet,
  }));

// Watch - file watcher that turns `// AI:` / `# AI:` / `<!-- AI: -->`
// markers in source files into tasks on the profile's queue. On first
// run per profile it seeds the dedup state without enqueuing, so the
// existing tree doesn't flood the queue.
program.command("watch [paths...]")
  .description("Watch files for `AI:` comments and enqueue them as tasks")
  .option("--profile <name>", "profile (default: $BAJACLAW_PROFILE or 'default')")
  .option("--purge", "clear dedup state before starting (forces re-seed)")
  .option("--once", "scan once and exit (no live watch)")
  .option("--dry-run", "print matches, do not enqueue")
  .action(async (paths: string[], opts) => runWatch({
    profile: defaultProfile(opts.profile),
    paths,
    purge: !!opts.purge,
    once: !!opts.once,
    dryRun: !!opts.dryRun,
  }));

program.command("ensure-list")
  .description("List every tool bajaclaw knows how to install on this platform")
  .option("--json", "emit a JSON array")
  .action(async (opts) => cmdEnsureList({ json: !!opts.json }));

// Update
program.command("update").description("Check for and install a newer version")
  .option("--check", "only check; don't install")
  .option("--yes", "apply without confirmation")
  .action(async (opts) => runUpdate({ check: !!opts.check, yes: !!opts.yes }));

// Setup - idempotent first-run bootstrap. Safe to rerun. Interactive
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

// Compact - run memory compaction (or show what would run)
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

// Persona - view or re-run the wizard
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

// Delegate - orchestrators call this via Bash to hand off a task
program.command("delegate <subagent> <task>")
  .description("Run one cycle on a sub-agent and stream its response text to stdout")
  .option("--json", "output full CycleOutput JSON instead of just text")
  .action(async (sub, task, opts) => subagent.cmdDelegate(sub, task, { json: !!opts.json }));

// Uninstall - full teardown.
program.command("uninstall").description("Remove all BajaClaw state (profiles, scheduler, MCP, memory sync)")
  .option("--yes", "actually perform the teardown")
  .option("--keep-data", "keep ~/.bajaclaw/ data; only remove integrations")
  .action(async (opts) => runUninstall({ yes: !!opts.yes, keepData: !!opts.keepData }));

// Model - show or set per profile
program.command("model [value] [profile]")
  .description("Show or set the model for a profile (no value: lists known models)")
  .action(async (value, p) => runModel(value, { profile: p }));

// Effort - show or set per profile
program.command("effort [value] [profile]")
  .description("Show or set the effort level (low/medium/high) for a profile")
  .action(async (value, p) => runEffort(value, { profile: p }));

// Guide - print a self-setup walkthrough
program.command("guide [topic]")
  .description("Print a self-setup walkthrough, or list available guides")
  .option("--profile <name>", "profile to use for skill lookup")
  .action(async (topic, opts) => runGuide(topic, { profile: opts.profile }));

// Serve - OpenAI-compatible HTTP endpoint
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
// Progress-ping for running cycles. Invoked from inside a spawned
// `claude` subprocess via the Bash tool. Reads context from the env
// vars injected by runCycleInner (BAJACLAW_PROFILE, BAJACLAW_SOURCE,
// BAJACLAW_DASHBOARD_PORT) and POSTs to the dashboard's /api/progress
// endpoint. Fails silent: a failed progress ping must never surface
// as a subprocess error to the agent.
program.command("say")
  .description("Send a progress update to the originating channel (used from inside cycles)")
  .argument("<text>")
  .action(async (text: string) => {
    const port = process.env.BAJACLAW_DASHBOARD_PORT ?? "7337";
    const source = process.env.BAJACLAW_SOURCE;
    try {
      await fetch(`http://127.0.0.1:${port}/api/progress`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, source }),
      });
    } catch { /* silent */ }
  });

program.command("banner").description("Print the ASCII banner").action(() => {
  printBanner(pkg.version, { force: true });
});

// Welcome - first-run greeting; also callable anytime
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
  console.log(`  ${chalk.cyan("bajaclaw chat")}                   ${chalk.dim("# interactive REPL - talk to your agent")}`);
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

// First-run hook: on the user's first interactive invocation, run the
// full interactive setup wizard if one hasn't been completed yet.
// Marks done so it only fires once per install.
async function maybeShowWelcome(): Promise<void> {
  if (!isFirstRun()) return;
  // Only fire when stdout+stdin are a TTY. npm captures postinstall
  // output, and non-interactive shells can't answer prompts. Non-TTY:
  // silent no-op; don't even mark done so the next interactive run
  // still gets the wizard.
  if (!process.stdout.isTTY || !process.stdin.isTTY) return;
  const cmd = process.argv[2];
  const skip = new Set([
    "uninstall", "update", "banner", "welcome", "setup", "init",
    "--version", "-V", "--help", "-h",
  ]);
  if (cmd && skip.has(cmd)) { markFirstRunDone(); return; }
  // If the user already completed the persona wizard (e.g. via `bajaclaw
  // setup` during postinstall on a TTY-capable unix system), just show
  // the welcome screen. Otherwise run the full interactive wizard so
  // they get agent name, tone, compaction, model, effort, and channels
  // in one pass.
  const personaDone = !!loadPersona(DEFAULT_PROFILE_NAME);
  if (personaDone) {
    await printWelcome();
  } else {
    await runSetup({ interactive: true });
  }
  markFirstRunDone();
}

program.hook("postAction", async () => {
  // Non-blocking notice at the end of any command. Skipped for noisy or
  // self-referential commands.
  const cmd = process.argv[2];
  if (cmd === "update" || cmd === "banner" || cmd === "uninstall" || cmd === "setup") return;
  await maybeNoticeAtExit();
});

// Run the first-run welcome before command dispatch. Non-blocking -
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
