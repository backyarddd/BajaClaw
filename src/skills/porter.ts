// Port skills from the desktop CLI scope into BajaClaw's scope. By default
// BajaClaw does not read ~/.claude/skills — use this to opt in per skill.
import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { bajaclawHome, claudeSkillsDir, profileDir, ensureDir } from "../paths.js";
import { parseSkill } from "./loader.js";

export type PortDestination =
  | { scope: "user" }
  | { scope: "profile"; profile: string }
  | { scope: "agent"; profile: string };

export type PortMode = "copy" | "link";

export interface PortOptions {
  source?: string;          // default: ~/.claude/skills
  destination?: PortDestination;
  mode?: PortMode;
  names?: string[];         // specific skill names; empty = all
  force?: boolean;          // overwrite existing
}

export interface PortReport {
  ported: string[];
  skipped: { name: string; reason: string }[];
  destinationDir: string;
}

export async function portSkills(opts: PortOptions = {}): Promise<PortReport> {
  const src = opts.source ?? claudeSkillsDir();
  const dst = opts.destination ?? { scope: "user" };
  const mode: PortMode = opts.mode ?? "copy";
  const destDir = destinationDir(dst);

  const report: PortReport = { ported: [], skipped: [], destinationDir: destDir };

  if (!existsSync(src)) {
    report.skipped.push({ name: "(source)", reason: `not found: ${src}` });
    return report;
  }

  ensureDir(destDir);

  const candidates = listSkillDirs(src);
  const want = opts.names && opts.names.length > 0 ? new Set(opts.names) : null;

  for (const name of candidates) {
    if (want && !want.has(name)) continue;
    const from = join(src, name);
    const to = join(destDir, name);
    const skillFile = join(from, "SKILL.md");

    if (!existsSync(skillFile)) {
      report.skipped.push({ name, reason: "no SKILL.md" });
      continue;
    }
    const parsed = parseSkill(readFileSync(skillFile, "utf8"), from, "bajaclaw-user");
    if (!parsed) {
      report.skipped.push({ name, reason: "unparseable frontmatter" });
      continue;
    }

    if (existsSync(to) && !opts.force) {
      report.skipped.push({ name, reason: "already present (use --force to overwrite)" });
      continue;
    }

    if (existsSync(to)) {
      removeRecursive(to);
    }

    if (mode === "link") {
      symlinkSync(from, to, "dir");
    } else {
      copyDir(from, to);
    }
    report.ported.push(name);
  }

  return report;
}

export function printPortReport(report: PortReport, mode: PortMode): void {
  console.log(chalk.dim(`destination: ${report.destinationDir}  (${mode})`));
  for (const name of report.ported) console.log(chalk.green(`✓ ${name}`));
  for (const s of report.skipped) console.log(chalk.yellow(`- ${s.name}: ${s.reason}`));
  if (report.ported.length === 0 && report.skipped.length === 0) {
    console.log(chalk.dim("(no skills found)"));
  }
}

function destinationDir(dst: PortDestination): string {
  if (dst.scope === "user") return join(bajaclawHome(), "skills");
  if (dst.scope === "profile") return join(profileDir(dst.profile), "skills");
  return join(profileDir(dst.profile), "skills");
}

function listSkillDirs(dir: string): string[] {
  return readdirSync(dir).filter((name) => {
    try {
      return statSync(join(dir, name)).isDirectory();
    } catch { return false; }
  });
}

function copyDir(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    const src = join(from, entry);
    const dst = join(to, entry);
    const s = statSync(src);
    if (s.isDirectory()) copyDir(src, dst);
    else writeFileSync(dst, readFileSync(src));
  }
}

function removeRecursive(path: string): void {
  try {
    const s = statSync(path);
    if (s.isDirectory()) {
      for (const entry of readdirSync(path)) removeRecursive(join(path, entry));
      try { unlinkSync(path); } catch { /* dir */ }
    } else {
      unlinkSync(path);
    }
  } catch { /* swallow */ }
}
