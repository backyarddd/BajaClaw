import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, unlinkSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { profileDir, ensureDir } from "../paths.js";
import { Logger } from "../logger.js";
import { pickAdapter } from "../scheduler/index.js";
import { runCycle } from "../agent.js";
import { openDb } from "../db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// __dirname is <repo>/src/commands (tsx) or <repo>/dist/commands (built).
const LAUNCHER = join(__dirname, "..", "..", "bin", "bajaclaw.js");

function pidPath(profile: string): string {
  return join(profileDir(profile), "daemon.pid");
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
  ensureDir(profileDir(profile));

  if (foreground) return runLoop(profile);

  const bin = process.execPath;
  const out = openSync(logPath(profile), "a");
  const child = spawn(bin, [LAUNCHER, "daemon", "run", profile], {
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env, BAJACLAW_DAEMON: "1" },
  });
  writeFileSync(pidFile, String(child.pid));
  child.unref();
  console.log(chalk.green(`✓ daemon started (pid ${child.pid}). logs: ${logPath(profile)}`));
}

export async function cmdStop(profile: string): Promise<void> {
  const pidFile = pidPath(profile);
  if (!existsSync(pidFile)) { console.log(chalk.dim("no pid file — daemon not running?")); return; }
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

  // Simple loop: check for due schedules + pending tasks every 30s.
  while (true) {
    try {
      const db = openDb(profile);
      const pending = db.prepare("SELECT COUNT(*) c FROM tasks WHERE status='pending'").get() as { c: number };
      db.close();
      if (pending.c > 0) {
        await runCycle({ profile });
      }
      backoff = 1000;
    } catch (e) {
      log.error("daemon.loop.err", { error: (e as Error).message });
      await sleep(backoff);
      backoff = Math.min(backoff * 2, maxBackoff);
    }
    await sleep(30_000);
  }
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

function isRunning(pid: number): boolean {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}
