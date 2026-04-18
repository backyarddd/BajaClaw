import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, renameSync, rmSync, cpSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";
import { loadAllSkillsRaw, parseSkill, runtimeSkipReason } from "../skills/loader.js";
import { bajaclawHome } from "../paths.js";
import type { Skill } from "../types.js";

export async function cmdList(profile: string): Promise<void> {
  const skills = loadAllSkillsRaw(profile);
  if (skills.length === 0) {
    console.log(chalk.dim("no skills found. try `bajaclaw skill new <name>`."));
    return;
  }
  for (const s of skills) {
    const reason = runtimeSkipReason(s);
    const origin = s.origin && s.origin !== "bajaclaw" ? chalk.yellow(` (${s.origin})`) : "";
    const status = reason ? chalk.red(" ✗") : "";
    const line = `${chalk.bold(s.name.padEnd(28))} ${chalk.dim(`[${s.scope}]`)}${origin}${status}  ${s.description}`;
    console.log(line);
    if (reason) console.log(`${" ".repeat(30)}${chalk.red("└─ inactive: " + reason)}`);
  }
  console.log("");
  const active = skills.length - skills.filter((s) => runtimeSkipReason(s)).length;
  console.log(chalk.dim(`${active}/${skills.length} active on this machine`));
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

export interface InstallOptions {
  scope?: "user" | "profile";
  profile?: string;
  yes?: boolean;
  registry?: string; // override ClawHub registry URL
}

const CLAWHUB_DEFAULT = "https://clawhub.ai";

// Install from one of:
//   - clawhub:<slug>[@version]        — fetch from ClawHub registry
//   - <slug>                          — shorthand for clawhub:<slug>
//   - https?://...(.zip|.tar.gz)      — download archive + extract
//   - https?://.../SKILL.md           — single-file skill
//   - <local-dir>                     — copy directory
//   - <local-SKILL.md>                — single-file skill
export async function cmdInstall(source: string, opts: InstallOptions = {}): Promise<void> {
  const dest = installRoot(opts);
  const src = parseSource(source);

  if (src.kind === "clawhub") {
    await installFromClawhub(src.slug, src.version, dest, opts);
    return;
  }
  if (src.kind === "archive-url") {
    await installFromArchiveUrl(src.url, dest, opts);
    return;
  }
  if (src.kind === "url-md") {
    const r = await fetch(src.url);
    if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
    await installSingleFile(await r.text(), src.url, dest, opts);
    return;
  }
  if (src.kind === "local-dir") {
    await installFromLocalDir(src.path, dest, opts);
    return;
  }
  // Single-file local.
  const raw = readFileSync(src.path, "utf8");
  await installSingleFile(raw, src.path, dest, opts);
}

type ParsedSource =
  | { kind: "clawhub"; slug: string; version?: string }
  | { kind: "archive-url"; url: string }
  | { kind: "url-md"; url: string }
  | { kind: "local-dir"; path: string }
  | { kind: "local-file"; path: string };

function parseSource(source: string): ParsedSource {
  if (source.startsWith("clawhub:")) {
    const rest = source.slice("clawhub:".length);
    const [slug, version] = rest.split("@");
    return { kind: "clawhub", slug: slug!, version: version || undefined };
  }
  if (/^https?:\/\//.test(source)) {
    if (/\.zip(\?.*)?$/i.test(source) || /\.tar\.gz(\?.*)?$/i.test(source)) {
      return { kind: "archive-url", url: source };
    }
    return { kind: "url-md", url: source };
  }
  if (existsSync(source)) {
    return statSync(source).isDirectory()
      ? { kind: "local-dir", path: source }
      : { kind: "local-file", path: source };
  }
  // Bare slug → treat as ClawHub slug.
  if (/^[a-z0-9][a-z0-9-]*$/.test(source)) {
    return { kind: "clawhub", slug: source };
  }
  throw new Error(`could not resolve source: ${source}`);
}

async function installFromClawhub(
  slug: string,
  version: string | undefined,
  dest: string,
  opts: InstallOptions,
): Promise<void> {
  const registry = (opts.registry ?? process.env.CLAWHUB_REGISTRY ?? CLAWHUB_DEFAULT).replace(/\/+$/, "");
  console.log(chalk.dim(`resolving ${slug} from ${registry}…`));

  const metaRes = await fetch(`${registry}/api/v1/skills/${encodeURIComponent(slug)}`);
  if (!metaRes.ok) throw new Error(`ClawHub: skill "${slug}" not found (${metaRes.status})`);
  const meta = await metaRes.json() as {
    skill?: { slug: string; displayName?: string; summary?: string };
    latestVersion?: { version?: string };
  };
  const resolved = version ?? meta.latestVersion?.version;
  if (!resolved) throw new Error(`ClawHub: no version resolved for ${slug}`);

  const url = `${registry}/api/v1/download?slug=${encodeURIComponent(slug)}&version=${encodeURIComponent(resolved)}`;
  console.log(chalk.dim(`downloading ${slug}@${resolved}…`));
  await installFromArchiveUrl(url, dest, opts, slug, resolved);
}

async function installFromArchiveUrl(
  url: string,
  dest: string,
  opts: InstallOptions,
  presetName?: string,
  presetVersion?: string,
): Promise<void> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download failed: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());

  const tmp = join(tmpdir(), `bajaclaw-skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(tmp, { recursive: true });
  const archivePath = join(tmp, /\.tar\.gz(\?.*)?$/i.test(url) ? "archive.tar.gz" : "archive.zip");
  writeFileSync(archivePath, buf);

  extractArchive(archivePath, tmp);
  rmSync(archivePath);

  // If the archive put everything in a single top-level dir, unwrap it.
  const root = autoUnwrap(tmp);
  try {
    await installFromLocalDir(root, dest, opts, { presetName, presetVersion });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function extractArchive(archivePath: string, dest: string): void {
  const isZip = archivePath.endsWith(".zip");
  const cmd = isZip ? "unzip" : "tar";
  const args = isZip ? ["-q", "-o", archivePath, "-d", dest] : ["-xzf", archivePath, "-C", dest];
  const r = spawnSync(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
  if (r.status !== 0) {
    const err = r.stderr?.toString() ?? "";
    throw new Error(`${cmd} failed: ${err.trim() || `exit ${r.status}`}`);
  }
}

function autoUnwrap(dir: string): string {
  const entries = readdirSync(dir);
  if (entries.length !== 1) return dir;
  const solo = join(dir, entries[0]!);
  try {
    if (statSync(solo).isDirectory() && !existsSync(join(dir, "SKILL.md")) && !existsSync(join(dir, "skill.md"))) {
      return solo;
    }
  } catch { /* fallthrough */ }
  return dir;
}

async function installFromLocalDir(
  srcDir: string,
  dest: string,
  opts: InstallOptions,
  overrides: { presetName?: string; presetVersion?: string } = {},
): Promise<void> {
  const skillFile = existsSync(join(srcDir, "SKILL.md"))
    ? join(srcDir, "SKILL.md")
    : existsSync(join(srcDir, "skill.md"))
      ? join(srcDir, "skill.md")
      : null;
  if (!skillFile) throw new Error(`no SKILL.md found in ${srcDir}`);

  const raw = readFileSync(skillFile, "utf8");
  const parsed = parseSkill(raw, skillFile, "bajaclaw-user");
  if (!parsed) throw new Error("could not parse SKILL.md — missing frontmatter or name");

  printPreview(parsed, raw, overrides);
  if (!opts.yes && process.env.BAJACLAW_CONFIRM !== "yes") {
    console.log("");
    console.log(chalk.yellow("Pass --yes (or set BAJACLAW_CONFIRM=yes) to proceed with install."));
    return;
  }

  const targetName = overrides.presetName ?? parsed.name;
  const target = join(dest, targetName);
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  cpSync(srcDir, target, { recursive: true });
  console.log(chalk.green(`✓ installed ${targetName} → ${target}`));
  surfaceInstallHints(parsed);
}

async function installSingleFile(raw: string, srcPath: string, dest: string, opts: InstallOptions): Promise<void> {
  const parsed = parseSkill(raw, srcPath, "bajaclaw-user");
  if (!parsed) throw new Error("could not parse SKILL.md — missing frontmatter or name");
  printPreview(parsed, raw, {});
  if (!opts.yes && process.env.BAJACLAW_CONFIRM !== "yes") {
    console.log("");
    console.log(chalk.yellow("Pass --yes (or set BAJACLAW_CONFIRM=yes) to proceed with install."));
    return;
  }
  const dir = join(dest, parsed.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), raw);
  console.log(chalk.green(`✓ installed ${parsed.name} → ${dir}`));
  surfaceInstallHints(parsed);
}

function printPreview(parsed: Skill, raw: string, overrides: { presetName?: string; presetVersion?: string }): void {
  const nameLabel = overrides.presetName && overrides.presetName !== parsed.name
    ? `${parsed.name} (install as ${overrides.presetName})`
    : parsed.name;
  console.log(chalk.bold(`About to install: ${nameLabel}`));
  if (parsed.origin && parsed.origin !== "bajaclaw") {
    console.log(chalk.dim(`origin: ${parsed.origin}`));
  }
  console.log(chalk.dim(parsed.description));
  if (parsed.homepage) console.log(chalk.dim(`homepage: ${parsed.homepage}`));
  if (parsed.platforms && parsed.platforms.length) {
    console.log(chalk.dim(`platforms: ${parsed.platforms.join(", ")}`));
  }
  if (parsed.requiredBins?.length) {
    console.log(chalk.dim(`requires bins: ${parsed.requiredBins.join(", ")}`));
  }
  if (parsed.anyBins?.length) {
    console.log(chalk.dim(`requires any of: ${parsed.anyBins.join(", ")}`));
  }
  if (parsed.requiredEnv?.length) {
    console.log(chalk.dim(`requires env: ${parsed.requiredEnv.join(", ")}`));
  }
  console.log("");
  console.log(raw.slice(0, 2000));
  if (raw.length > 2000) console.log(chalk.dim(`… (${raw.length - 2000} more chars)`));
}

function surfaceInstallHints(parsed: Skill): void {
  if (!parsed.install?.length) return;
  console.log("");
  console.log(chalk.yellow("This skill declared install steps (openclaw):"));
  for (const step of parsed.install) {
    const id = step.label ?? step.formula ?? step.package ?? step.module ?? step.kind;
    const bins = step.bins?.length ? chalk.dim(` [${step.bins.join(", ")}]`) : "";
    console.log(`  - ${step.kind}: ${id}${bins}`);
  }
  console.log(chalk.dim("  BajaClaw does not run installs automatically. Run these yourself"));
  console.log(chalk.dim("  (or let the agent run them via Bash when it loads the skill)."));
}

function installRoot(opts: InstallOptions): string {
  const scope = opts.scope ?? "user";
  const root = scope === "profile"
    ? join(bajaclawHome(), "profiles", opts.profile!, "skills")
    : join(bajaclawHome(), "skills");
  mkdirSync(root, { recursive: true });
  return root;
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
  if (existsSync(to) && opts.force) rmSync(to, { recursive: true, force: true });
  renameSync(from, to);
  console.log(chalk.green(`✓ promoted ${name} -> ${to}`));
}

export async function cmdSearch(query: string, opts: InstallOptions = {}): Promise<void> {
  const registry = (opts.registry ?? process.env.CLAWHUB_REGISTRY ?? CLAWHUB_DEFAULT).replace(/\/+$/, "");
  const r = await fetch(`${registry}/api/v1/search?q=${encodeURIComponent(query)}`);
  if (!r.ok) throw new Error(`search failed: ${r.status}`);
  const body = await r.json() as { results?: Array<{ slug: string; displayName?: string; summary?: string; score?: number }> };
  const results = body.results ?? [];
  if (results.length === 0) { console.log(chalk.dim("no matches.")); return; }
  for (const item of results.slice(0, 15)) {
    console.log(`${chalk.bold(item.slug.padEnd(30))} ${chalk.dim((item.summary ?? "").slice(0, 72))}`);
  }
  console.log("");
  console.log(chalk.dim("install with: bajaclaw skill install clawhub:<slug>"));
}
