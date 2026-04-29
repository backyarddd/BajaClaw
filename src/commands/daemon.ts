import { spawn, spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, unlinkSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { profileDir, ensureDir } from "../paths.js";
import { Logger } from "../logger.js";
import { pickAdapter } from "../scheduler/index.js";
import { runCycle } from "../agent.js";
import { openDb } from "../db.js";
import { startAllGateways, replyToSource, endTyping } from "../channels/gateway.js";
import { startDashboardInProcess } from "./dashboard.js";
import { loadConfig } from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// __dirname is <repo>/src/commands (tsx) or <repo>/dist/commands (built).
const LAUNCHER = join(__dirname, "..", "..", "bin", "bajaclaw.js");

function pidPath(profile: string): string {
  return join(profileDir(profile), "daemon.pid");
}

// Cross-module probe: is the daemon for this profile currently alive?
// Reads the profile's pidfile and checks with `kill(pid, 0)`. Returns
// false for missing pidfile, stale pidfile, or any error. Used by the
// dashboard to light the "running" badge on each agent card.
export function isDaemonRunning(profile: string): boolean {
  const pid = readReferencedPid(profile);
  return pid > 0 && isRunning(pid);
}
function logPath(profile: string): string {
  return join(profileDir(profile), "daemon.log");
}

export async function cmdStart(profile: string, foreground = false): Promise<void> {
  const pidFile = pidPath(profile);
  if (existsSync(pidFile)) {
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    if (pid && isRunning(pid)) {
      console.log(chalk.yellow(`daemon already running (pid ${pid})`));
      return;
    }
    unlinkSync(pidFile);
  }

  // Sweep unreferenced stale daemons - processes running `daemon run
  // <profile>` that our pidfile doesn't point to. A daemon can orphan
  // if the previous `daemon stop` killed the pidfile's launcher but
  // not the detached child, or if the process was SIGKILLed without
  // cleanup. Left alone, they all poll the same DB and (worse) all
  // long-poll the telegram/discord gateways, causing duplicate replies.
  const stale = findStaleDaemons(profile);
  if (stale.length > 0) {
    console.log(chalk.yellow(`sweeping ${stale.length} stale daemon process(es): ${stale.join(", ")}`));
    for (const pid of stale) {
      try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
    }
    // Give them ~1s to exit cleanly, then SIGKILL anything still alive.
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) {
      if (stale.every((p) => !isRunning(p))) break;
      spawnSync("sleep", ["0.1"]);
    }
    for (const pid of stale) {
      if (isRunning(pid)) {
        try { process.kill(pid, "SIGKILL"); } catch { /* gone */ }
      }
    }
  }

  ensureDir(profileDir(profile));

  if (foreground) return runLoop(profile);

  const bin = process.execPath;
  const out = openSync(logPath(profile), "a");
  // Strip env vars injected by Claude Desktop into any process it
  // launches. If `bajaclaw daemon start` is run from a desktop-spawned
  // shell, these would poison every `claude` subprocess the daemon
  // later spawns - the Desktop-managed OAuth token overrides on-disk
  // credentials and breaks with 401 when it rotates. Scrubbing once
  // here prevents them from ever entering the daemon's environment.
  const daemonEnv: NodeJS.ProcessEnv = { ...process.env, BAJACLAW_DAEMON: "1" };
  for (const k of [
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_EXECPATH",
    "CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH",
    "CLAUDECODE",
  ]) delete daemonEnv[k];
  const child = spawn(bin, [LAUNCHER, "daemon", "run", profile], {
    detached: true,
    stdio: ["ignore", out, out],
    env: daemonEnv,
  });
  if (!child.pid) {
    console.error(chalk.red(`daemon spawn failed - check ${logPath(profile)} for details`));
    return;
  }
  writeFileSync(pidFile, String(child.pid));
  child.unref();
  console.log(chalk.green(`✓ daemon started (pid ${child.pid}). logs: ${logPath(profile)}`));
}

export async function cmdStop(profile: string): Promise<void> {
  const pidFile = pidPath(profile);
  if (!existsSync(pidFile)) { console.log(chalk.dim("no pid file - daemon not running?")); return; }
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
  unlinkSync(pidFile);
  console.log(chalk.green(`✓ stopped pid ${pid}`));
}

export async function cmdStatus(profile: string): Promise<void> {
  const pidFile = pidPath(profile);
  if (!existsSync(pidFile)) { console.log(chalk.dim("stopped")); return; }
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  console.log(isRunning(pid) ? chalk.green(`running (pid ${pid})`) : chalk.yellow(`stale pid ${pid}`));
}

export async function cmdLogs(profile: string, lines = 50): Promise<void> {
  const p = logPath(profile);
  if (!existsSync(p)) { console.log(chalk.dim("no logs yet.")); return; }
  const body = readFileSync(p, "utf8");
  const split = body.split(/\r?\n/);
  console.log(split.slice(-lines).join("\n"));
}

export async function cmdRestart(profile: string): Promise<void> {
  await cmdStop(profile).catch(() => undefined);
  await cmdStart(profile);
}

export async function cmdInstall(profile: string): Promise<void> {
  const adapter = pickAdapter();
  await adapter.install(profile, "heartbeat", "*/15 * * * *", [process.execPath, LAUNCHER, "start", profile]);
  console.log(chalk.green(`✓ installed heartbeat for ${profile}`));
}

export async function cmdRun(profile: string): Promise<void> {
  // Foreground supervisor: runs loop, restarts on crash with exponential backoff.
  await runLoop(profile);
}

async function runLoop(profile: string): Promise<void> {
  const log = new Logger(profile);
  let backoff = 1000;
  const maxBackoff = 5 * 60 * 1000;
  log.info("daemon.start", { pid: process.pid });
  process.on("SIGTERM", () => { log.info("daemon.sigterm"); process.exit(0); });
  process.on("SIGINT", () => { log.info("daemon.sigint"); process.exit(0); });
  // SIGUSR1: wake the poll loop early (fired by wakeAgent from task-insertion callers).
  let wakeResolve: (() => void) | null = null;
  if (process.platform !== "win32") {
    process.on("SIGUSR1", () => { log.info("daemon.wake"); wakeResolve?.(); });
  }

  // Start channel gateways (telegram/discord) if any are configured.
  // Adapters run in the background; inbound messages enqueue tasks,
  // and replyToSource routes cycle outputs back.
  try { await startAllGateways(profile); }
  catch (e) { log.error("daemon.gateway.start.err", { error: (e as Error).message }); }

  // Auto-start the dashboard unless explicitly disabled. Runs in
  // this process so its lifetime matches the daemon - no orphan HTTP
  // servers to chase down. Port conflicts are logged but non-fatal.
  const cfgForDash = loadConfig(profile);
  if (cfgForDash.dashboardAutostart !== false) {
    const r = await startDashboardInProcess(profile);
    if (r.ok) log.info("daemon.dashboard.ready", { port: r.port });
    else log.warn("daemon.dashboard.skip", { port: r.port, error: r.error });
  }

  // Channel-sourced tasks need a shorter poll - 60s would feel like
  // the bot is asleep. 3s when a gateway is wired, 60s otherwise.
  const hasChannels = await hasAnyChannel(profile);
  const pollMs = hasChannels ? 3_000 : 60_000;

  while (true) {
    try {
      const db = openDb(profile);
      const pending = db.prepare("SELECT COUNT(*) c FROM tasks WHERE status='pending'").get() as { c: number };
      db.close();
      if (pending.c > 0) {
        const out = await runCycle({ profile });
        if (out.source) {
          // Always clear the typing indicator, even on the empty-text
          // path - the gateway started one when the inbound message
          // arrived and expects someone to end it.
          try {
            if (out.ok && out.text) {
              await replyToSource(profile, out.source, out.text);
            } else if (!out.ok) {
              await replyToSource(profile, out.source, `⚠️ cycle failed: ${out.error ?? "unknown error"}`);
            } else {
              endTyping(out.source);
            }
          } catch (e) {
            endTyping(out.source);
            log.warn("daemon.reply.fail", { error: (e as Error).message, source: out.source });
          }
        }
      }
      backoff = 1000;
    } catch (e) {
      log.error("daemon.loop.err", { error: (e as Error).message });
      await sleep(backoff);
      backoff = Math.min(backoff * 2, maxBackoff);
    }
    await new Promise<void>((resolve) => { wakeResolve = resolve; setTimeout(resolve, pollMs); });
    wakeResolve = null;
  }
}

async function hasAnyChannel(profile: string): Promise<boolean> {
  try {
    const { loadConfig } = await import("../config.js");
    const cfg = loadConfig(profile);
    return (cfg.channels ?? []).length > 0;
  } catch { return false; }
}

// Send SIGUSR1 to the daemon for `profile` to skip its current sleep and poll immediately.
// No-op if the daemon is not running or the platform doesn't support SIGUSR1 (Windows).
export function wakeAgent(profile: string): void {
  if (process.platform === "win32") return;
  const pid = readReferencedPid(profile);
  if (pid > 0 && isRunning(pid)) {
    try { process.kill(pid, "SIGUSR1"); } catch { /* daemon gone */ }
  }
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

function isRunning(pid: number): boolean {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// Find running processes whose command line contains `daemon run <profile>`.
// Skip our own pid and any pid stored in the pidfile (stop before
// calling this if you want to sweep the referenced daemon too).
//
// Cross-platform: unix uses `ps -axo`; Windows uses PowerShell's
// Get-CimInstance Win32_Process (wmic is deprecated in Win11).
function findStaleDaemons(profile: string): number[] {
  const ownPid = process.pid;
  const referenced = readReferencedPid(profile);
  // Defensive: profile names are validated upstream but sanitize the
  // PowerShell -like pattern too so a literal `*` or `'` in a profile
  // name can't escape the wildcard match.
  const safeProfile = profile.replace(/[^a-zA-Z0-9 _-]/g, "");
  const needle = `daemon run ${safeProfile}`;

  if (process.platform === "win32") {
    // Single-quoted strings in PowerShell don't interpolate, but the
    // pattern still needs balanced quotes. `-like '*...*'` with sanitized
    // input is safe.
    const script = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${needle}*' -and $_.CommandLine -like '*bajaclaw*' } | Select-Object -ExpandProperty ProcessId`;
    const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
    if (r.status !== 0 || !r.stdout) return [];
    const out: number[] = [];
    for (const line of r.stdout.split(/\r?\n/)) {
      const pid = Number(line.trim());
      if (!Number.isFinite(pid) || pid <= 0) continue;
      if (pid === ownPid || pid === referenced) continue;
      out.push(pid);
    }
    return out;
  }

  const r = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  if (r.status !== 0 || !r.stdout) return [];
  const out: number[] = [];
  for (const line of r.stdout.split("\n")) {
    if (!line.includes(needle)) continue;
    const m = line.match(/^\s*(\d+)\s/);
    if (!m) continue;
    const pid = Number(m[1]);
    if (!pid || pid === ownPid || pid === referenced) continue;
    // Exclude our own `ps` and anything not actually a bajaclaw daemon
    // (e.g. a grep someone typed). Require "bajaclaw" to appear too.
    if (!/bajaclaw/.test(line)) continue;
    out.push(pid);
  }
  return out;
}

function readReferencedPid(profile: string): number {
  try {
    const p = Number(readFileSync(pidPath(profile), "utf8").trim());
    return Number.isFinite(p) ? p : 0;
  } catch { return 0; }
}
