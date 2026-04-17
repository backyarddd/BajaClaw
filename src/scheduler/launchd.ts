import { writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execa } from "execa";
import type { ScheduleEntry } from "../types.js";

function plistPath(profile: string, label: string): string {
  return join(homedir(), "Library", "LaunchAgents", `com.bajaclaw.${profile}.${label}.plist`);
}

export async function install(profile: string, label: string, cronExpr: string, command: string[]): Promise<void> {
  const { hour, minute } = parseHM(cronExpr);
  const xml = buildPlist(`com.bajaclaw.${profile}.${label}`, command, hour, minute);
  const path = plistPath(profile, label);
  writeFileSync(path, xml);
  await execa("launchctl", ["load", "-w", path], { reject: false });
}

export async function uninstall(profile: string, label: string): Promise<void> {
  const path = plistPath(profile, label);
  if (existsSync(path)) {
    await execa("launchctl", ["unload", "-w", path], { reject: false });
    unlinkSync(path);
  }
}

export async function list(profile: string): Promise<ScheduleEntry[]> {
  // Parse installed labels via launchctl list.
  const r = await execa("launchctl", ["list"], { reject: false });
  const out: ScheduleEntry[] = [];
  if (r.exitCode !== 0) return out;
  for (const line of r.stdout.split(/\r?\n/)) {
    const parts = line.split(/\s+/);
    const label = parts[parts.length - 1];
    if (label?.startsWith(`com.bajaclaw.${profile}.`)) {
      out.push({ cron: "?", task: label, enabled: 1 });
    }
  }
  return out;
}

function parseHM(cronExpr: string): { hour: number; minute: number } {
  // Minimal support: "M H * * *" and "*/N * * * *" (picks first run).
  const parts = cronExpr.trim().split(/\s+/);
  const minute = parts[0] ?? "0";
  const hour = parts[1] ?? "*";
  const m = minute.startsWith("*/") ? 0 : Number(minute);
  const h = hour === "*" ? 0 : Number(hour);
  return { hour: isNaN(h) ? 0 : h, minute: isNaN(m) ? 0 : m };
}

function buildPlist(label: string, command: string[], hour: number, minute: number): string {
  const args = command.map((c) => `    <string>${escapeXml(c)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>${hour}</integer>
    <key>Minute</key><integer>${minute}</integer>
  </dict>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>/tmp/${label}.out</string>
  <key>StandardErrorPath</key><string>/tmp/${label}.err</string>
</dict>
</plist>
`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
