import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, renameSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { loadAllSkills, parseSkill } from "../skills/loader.js";
import { bajaclawHome } from "../paths.js";

export async function cmdList(profile: string): Promise<void> {
  const skills = loadAllSkills(profile);
  if (skills.length === 0) {
    console.log(chalk.dim("no skills found. try `bajaclaw skill new <name>`."));
    return;
  }
  for (const s of skills) {
    console.log(`${chalk.bold(s.name.padEnd(28))} ${chalk.dim(`[${s.scope}]`)}  ${s.description}`);
  }
}

export async function cmdNew(name: string, scope: "user" | "profile" = "user", profile?: string): Promise<void> {
  const root = scope === "profile"
    ? join(bajaclawHome(), "profiles", profile!, "skills")
    : join(bajaclawHome(), "skills");
  const dir = join(root, name);
  if (existsSync(dir)) throw new Error(`skill already exists: ${dir}`);
  mkdirSync(dir, { recursive: true });
  const body = `---
name: ${name}
description: Describe what this skill does in one sentence
version: 0.1.0
tools: [Read]
triggers: ["${name.replace(/-/g, " ")}"]
effort: medium
---

## Instructions

Write detailed instructions here. These are injected verbatim into the agent's
system prompt whenever this skill is matched.
`;
  writeFileSync(join(dir, "SKILL.md"), body);
  console.log(chalk.green(`✓ created ${join(dir, "SKILL.md")}`));
}

export async function cmdInstall(source: string, scope: "user" | "profile" = "user", profile?: string): Promise<void> {
  let raw: string;
  let srcPath: string;
  if (/^https?:/.test(source)) {
    const r = await fetch(source);
    if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
    raw = await r.text();
    srcPath = source;
  } else {
    const target = existsSync(source) && statSync(source).isDirectory() ? join(source, "SKILL.md") : source;
    raw = readFileSync(target, "utf8");
    srcPath = target;
  }
  const parsed = parseSkill(raw, srcPath, "bajaclaw-user");
  if (!parsed) throw new Error("could not parse SKILL.md — missing frontmatter or name");

  console.log(chalk.bold(`About to install: ${parsed.name}`));
  console.log(chalk.dim(parsed.description));
  console.log("");
  console.log(raw.slice(0, 2000));
  if (raw.length > 2000) console.log(chalk.dim(`… (${raw.length - 2000} more chars)`));

  if (process.env.BAJACLAW_CONFIRM !== "yes") {
    console.log("");
    console.log(chalk.yellow("Set BAJACLAW_CONFIRM=yes to install, or run again with that env var."));
    return;
  }

  const root = scope === "profile"
    ? join(bajaclawHome(), "profiles", profile!, "skills")
    : join(bajaclawHome(), "skills");
  const dir = join(root, parsed.name);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), raw);
  console.log(chalk.green(`✓ installed ${parsed.name} to ${dir}`));
}

export async function cmdReview(): Promise<void> {
  const auto = join(bajaclawHome(), "skills", "auto");
  if (!existsSync(auto)) { console.log(chalk.dim("no auto-generated skills to review.")); return; }
  const names = readdirSync(auto).filter((n) => {
    try { return statSync(join(auto, n, "SKILL.md")).isFile(); } catch { return false; }
  });
  if (names.length === 0) { console.log(chalk.dim("no auto-generated skills to review.")); return; }
  for (const name of names) {
    const path = join(auto, name, "SKILL.md");
    console.log(chalk.bold(`── ${name} ──`));
    console.log(readFileSync(path, "utf8").slice(0, 3000));
    console.log("");
  }
  console.log(chalk.dim(`To promote: bajaclaw skill promote <name>`));
  console.log(chalk.dim(`To discard: rm -rf ${auto}/<name>`));
}

export async function cmdPromote(name: string, opts: { force?: boolean } = {}): Promise<void> {
  const from = join(bajaclawHome(), "skills", "auto", name);
  const to = join(bajaclawHome(), "skills", name);
  if (!existsSync(from)) throw new Error(`no auto-skill named ${name} (looked in ${from})`);
  if (existsSync(to) && !opts.force) throw new Error(`user skill ${name} already exists. Use --force to overwrite.`);
  if (existsSync(to) && opts.force) {
    // Replace the existing directory.
    removeRecursive(to);
  }
  renameSync(from, to);
  console.log(chalk.green(`✓ promoted ${name} -> ${to}`));
}

function removeRecursive(path: string): void {
  try {
    const s = statSync(path);
    if (s.isDirectory()) {
      for (const entry of readdirSync(path)) removeRecursive(join(path, entry));
      try { require("node:fs").rmdirSync(path); } catch { /* ignore */ }
    } else {
      require("node:fs").unlinkSync(path);
    }
  } catch { /* swallow */ }
}
