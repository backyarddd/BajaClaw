import { execa } from "execa";
import type { ScheduleEntry } from "../types.js";

function taskName(profile: string, label: string): string {
  return `BajaClaw-${profile}-${label}`;
}

export async function install(profile: string, label: string, cronExpr: string, command: string[]): Promise<void> {
  const name = taskName(profile, label);
  const tr = command.map((c) => (c.includes(" ") ? `"${c}"` : c)).join(" ");
  const schedule = toSchtasks(cronExpr);
  const args = [
    "/Create", "/F",
    "/TN", name,
    "/TR", tr,
    "/SC", schedule.sc,
    ...(schedule.mo ? ["/MO", schedule.mo] : []),
    ...(schedule.st ? ["/ST", schedule.st] : []),
  ];
  await execa("schtasks", args, { reject: false });
}

export async function uninstall(profile: string, label: string): Promise<void> {
  await execa("schtasks", ["/Delete", "/F", "/TN", taskName(profile, label)], { reject: false });
}

export async function list(profile: string): Promise<ScheduleEntry[]> {
  const r = await execa("schtasks", ["/Query", "/FO", "CSV", "/NH"], { reject: false });
  const out: ScheduleEntry[] = [];
  if (r.exitCode !== 0) return out;
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = line.match(/^"([^"]+)"/);
    if (m && m[1]!.startsWith(`BajaClaw-${profile}-`)) {
      out.push({ cron: "?", task: m[1]!, enabled: 1 });
    }
  }
  return out;
}

function toSchtasks(cronExpr: string): { sc: string; mo?: string; st?: string } {
  const parts = cronExpr.trim().split(/\s+/);
  const [m = "0", h = "*"] = parts;
  if (m.startsWith("*/")) return { sc: "MINUTE", mo: m.slice(2) };
  if (h === "*") return { sc: "HOURLY", mo: "1" };
  return { sc: "DAILY", st: `${pad(Number(h))}:${pad(Number(m))}` };
}

function pad(n: number): string { return n.toString().padStart(2, "0"); }
