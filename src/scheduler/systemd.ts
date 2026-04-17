import { writeFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execa } from "execa";
import type { ScheduleEntry } from "../types.js";

function unitDir(): string {
  const dir = join(homedir(), ".config", "systemd", "user");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function available(): boolean {
  // Detect user systemd by presence of systemctl and a user bus.
  try {
    const r = require("node:child_process").spawnSync("systemctl", ["--user", "is-system-running"], { encoding: "utf8" });
    return (r.status ?? 1) !== 127;
  } catch { return false; }
}

function unitName(profile: string, label: string): string {
  return `bajaclaw-${profile}-${label}`;
}

export async function install(profile: string, label: string, cronExpr: string, command: string[]): Promise<void> {
  const name = unitName(profile, label);
  const svc = `[Unit]
Description=BajaClaw ${profile}/${label}

[Service]
Type=oneshot
ExecStart=${command.map(shellEscape).join(" ")}
`;
  const timer = `[Unit]
Description=Timer for ${name}

[Timer]
OnCalendar=${toOnCalendar(cronExpr)}
Persistent=true

[Install]
WantedBy=timers.target
`;
  writeFileSync(join(unitDir(), `${name}.service`), svc);
  writeFileSync(join(unitDir(), `${name}.timer`), timer);
  await execa("systemctl", ["--user", "daemon-reload"], { reject: false });
  await execa("systemctl", ["--user", "enable", "--now", `${name}.timer`], { reject: false });
}

export async function uninstall(profile: string, label: string): Promise<void> {
  const name = unitName(profile, label);
  await execa("systemctl", ["--user", "disable", "--now", `${name}.timer`], { reject: false });
  for (const ext of [".service", ".timer"]) {
    const p = join(unitDir(), `${name}${ext}`);
    if (existsSync(p)) unlinkSync(p);
  }
  await execa("systemctl", ["--user", "daemon-reload"], { reject: false });
}

export async function list(profile: string): Promise<ScheduleEntry[]> {
  const r = await execa("systemctl", ["--user", "list-timers", "--all", "--no-pager"], { reject: false });
  const out: ScheduleEntry[] = [];
  if (r.exitCode !== 0) return out;
  for (const line of r.stdout.split(/\r?\n/)) {
    const prefix = `bajaclaw-${profile}-`;
    if (line.includes(prefix)) out.push({ cron: "?", task: line.trim(), enabled: 1 });
  }
  return out;
}

function toOnCalendar(cronExpr: string): string {
  const parts = cronExpr.trim().split(/\s+/);
  const [m = "0", h = "*", dom = "*", mon = "*", dow = "*"] = parts;
  if (m.startsWith("*/")) return `*:0/${m.slice(2)}`;
  if (dow !== "*") return `${dow} ${h}:${m}`;
  if (dom !== "*" || mon !== "*") return `*-${mon}-${dom} ${h}:${m}`;
  if (h === "*") return `*:${m}`;
  return `${h}:${m}`;
}

function shellEscape(s: string): string {
  return /^[A-Za-z0-9_/.:=-]+$/.test(s) ? s : `"${s.replace(/"/g, '\\"')}"`;
}
