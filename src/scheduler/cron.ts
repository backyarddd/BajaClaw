import { execa } from "execa";
import type { ScheduleEntry } from "../types.js";

const MARKER_BEGIN = "# BEGIN BAJACLAW";
const MARKER_END = "# END BAJACLAW";

async function readCrontab(): Promise<string> {
  const r = await execa("crontab", ["-l"], { reject: false });
  return r.exitCode === 0 ? r.stdout : "";
}

async function writeCrontab(body: string): Promise<void> {
  await execa("crontab", ["-"], { input: body });
}

function lineTag(profile: string, label: string): string {
  return `# bajaclaw:${profile}:${label}`;
}

export async function install(profile: string, label: string, cronExpr: string, command: string[]): Promise<void> {
  const entry = `${cronExpr} ${command.map((c) => (c.includes(" ") ? `"${c}"` : c)).join(" ")}  ${lineTag(profile, label)}`;
  const current = await readCrontab();
  const lines = current.split(/\r?\n/).filter((l) => !l.includes(lineTag(profile, label)));
  ensureBlock(lines);
  const idxEnd = lines.findIndex((l) => l === MARKER_END);
  lines.splice(idxEnd, 0, entry);
  await writeCrontab(lines.join("\n") + "\n");
}

export async function uninstall(profile: string, label: string): Promise<void> {
  const current = await readCrontab();
  const lines = current.split(/\r?\n/).filter((l) => !l.includes(lineTag(profile, label)));
  await writeCrontab(lines.join("\n"));
}

export async function list(profile: string): Promise<ScheduleEntry[]> {
  const current = await readCrontab();
  const out: ScheduleEntry[] = [];
  for (const l of current.split(/\r?\n/)) {
    const m = l.match(new RegExp(`^(\\S+\\s+\\S+\\s+\\S+\\s+\\S+\\s+\\S+)\\s+.*#\\s*bajaclaw:${profile}:(\\S+)`));
    if (m) out.push({ cron: m[1]!, task: m[2]!, enabled: 1 });
  }
  return out;
}

function ensureBlock(lines: string[]): void {
  if (!lines.includes(MARKER_BEGIN)) lines.push(MARKER_BEGIN);
  if (!lines.includes(MARKER_END)) lines.push(MARKER_END);
}
