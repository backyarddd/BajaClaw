// Auto-update check. Runs at most once per 24h, never blocks the CLI.
// Channels:
//   1. npm registry (primary once published)
//   2. GitHub raw package.json (fallback, URL from package.json "bajaclaw.updateUrl")
// Cache: ~/.bajaclaw/.update-check.json
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import chalk from "chalk";
import { bajaclawHome, ensureDir } from "./paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// __dirname is either .../src or .../dist; package.json lives one level up.
const PKG_PATH = join(__dirname, "..", "package.json");
const CACHE_PATH = () => join(bajaclawHome(), ".update-check.json");
const TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT = 3000;

export interface UpdateInfo {
  current: string;
  latest: string | null;
  channel: "npm" | "github" | "cache" | "none";
  checkedAt: string;
  url?: string;
}

export function currentVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8"));
    return String(pkg.version ?? "0.0.0");
  } catch {
    return "0.0.0";
  }
}

function readPkg(): Record<string, unknown> {
  try { return JSON.parse(readFileSync(PKG_PATH, "utf8")); } catch { return {}; }
}

export async function check(opts: { force?: boolean } = {}): Promise<UpdateInfo | null> {
  const current = currentVersion();
  const cachePath = CACHE_PATH();
  if (!opts.force && existsSync(cachePath)) {
    try {
      const cached = JSON.parse(readFileSync(cachePath, "utf8")) as UpdateInfo;
      if (Date.now() - Date.parse(cached.checkedAt) < TTL_MS) {
        return { ...cached, channel: "cache" };
      }
    } catch { /* fall through */ }
  }

  const result = await fetchLatest();
  const info: UpdateInfo = {
    current,
    latest: result?.version ?? null,
    channel: result?.channel ?? "none",
    checkedAt: new Date().toISOString(),
    url: result?.url,
  };
  try {
    ensureDir(bajaclawHome());
    writeFileSync(cachePath, JSON.stringify(info, null, 2));
  } catch { /* silent */ }
  return info;
}

async function fetchLatest(): Promise<{ version: string; channel: "npm" | "github"; url: string } | null> {
  const pkg = readPkg();
  const npmName = String(pkg.name ?? "bajaclaw");
  const cfg = (pkg as { bajaclaw?: { updateUrl?: string; npmName?: string } }).bajaclaw ?? {};
  const overrideUrl = cfg.updateUrl;

  const npmUrl = `https://registry.npmjs.org/${cfg.npmName ?? npmName}/latest`;
  try {
    const r = await fetchWithTimeout(npmUrl);
    if (r?.ok) {
      const data = await r.json() as { version?: string };
      if (data.version && typeof data.version === "string") {
        return { version: data.version, channel: "npm", url: npmUrl };
      }
    }
  } catch { /* silent */ }

  if (overrideUrl) {
    try {
      const r = await fetchWithTimeout(overrideUrl);
      if (r?.ok) {
        const text = await r.text();
        try {
          const parsed = JSON.parse(text) as { version?: string };
          if (parsed.version) return { version: parsed.version, channel: "github", url: overrideUrl };
        } catch { /* not JSON */ }
      }
    } catch { /* silent */ }
  }
  return null;
}

async function fetchWithTimeout(url: string): Promise<Response | null> {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT);
    const r = await fetch(url, { signal: ac.signal });
    clearTimeout(timer);
    return r;
  } catch { return null; }
}

export function compareSemver(a: string, b: string): number {
  const pa = parse(a); const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const diff = pa[i]! - pb[i]!;
    if (diff !== 0) return diff;
  }
  return 0;
}

function parse(v: string): number[] {
  return v.replace(/^v/, "").split("-")[0]!.split(".").slice(0, 3).map((n) => Number(n) || 0);
}

export function newerAvailable(info: UpdateInfo | null): boolean {
  if (!info || !info.latest) return false;
  return compareSemver(info.latest, info.current) > 0;
}

export function printNotice(info: UpdateInfo): void {
  if (!newerAvailable(info)) return;
  if (!process.stdout.isTTY) return;
  if (process.env.BAJACLAW_NO_UPDATE_NOTICE === "1") return;
  const label = "update available";
  const versions = `${info.current} → ${info.latest!}`;
  const hint = "run: bajaclaw update";
  const plain = `  ${label}   ${versions}   ·   ${hint}  `;
  const colored = `  ${chalk.bold.yellow(label)}   ${chalk.cyan(info.current)} → ${chalk.green(info.latest!)}   ·   ${chalk.dim("run:")} ${chalk.bold("bajaclaw update")}  `;
  const width = plain.length;
  const pad = colored.length - plain.length;
  const top = "╭" + "─".repeat(width) + "╮";
  const mid = "│" + colored.padEnd(width + pad) + "│";
  const bot = "╰" + "─".repeat(width) + "╯";
  process.stdout.write("\n" + chalk.dim(top) + "\n" + chalk.dim(mid) + "\n" + chalk.dim(bot) + "\n");
}

export interface InstallLocation {
  kind: "npm-global" | "npm-local" | "git" | "unknown";
  path: string;
}

export function detectInstall(): InstallLocation {
  const root = join(__dirname, "..", "..");
  if (existsSync(join(root, ".git"))) return { kind: "git", path: root };
  // Heuristic: npm global usually has parent that is node_modules + .bin
  const rootUp = join(root, "..", "..");
  if (/node_modules[/\\](bajaclaw|create-bajaclaw)/.test(root) || existsSync(join(rootUp, ".package-lock.json"))) {
    return { kind: "npm-global", path: root };
  }
  return { kind: "unknown", path: root };
}

export interface UpdateResult {
  ok: boolean;
  method: string;
  message: string;
}

export async function performUpdate(info: UpdateInfo | null): Promise<UpdateResult> {
  const loc = detectInstall();
  if (loc.kind === "git") {
    const pull = spawnSync("git", ["pull", "--ff-only"], { cwd: loc.path, encoding: "utf8" });
    if (pull.status !== 0) return { ok: false, method: "git pull", message: pull.stderr || pull.stdout || "git pull failed" };
    const install = spawnSync("npm", ["install", "--no-audit", "--no-fund"], { cwd: loc.path, encoding: "utf8" });
    if (install.status !== 0) return { ok: false, method: "npm install", message: install.stderr || install.stdout };
    const build = spawnSync("npm", ["run", "build"], { cwd: loc.path, encoding: "utf8" });
    return {
      ok: build.status === 0,
      method: "git pull + npm install + npm run build",
      message: build.status === 0 ? `updated to ${info?.latest ?? "HEAD"}` : (build.stderr || build.stdout),
    };
  }
  // npm path
  const pkg = readPkg();
  const npmName = String((pkg as { bajaclaw?: { npmName?: string } }).bajaclaw?.npmName ?? pkg.name ?? "bajaclaw");
  const install = spawnSync("npm", ["install", "-g", `${npmName}@latest`], { encoding: "utf8" });
  return {
    ok: install.status === 0,
    method: "npm install -g",
    message: install.status === 0 ? `updated to ${info?.latest ?? "latest"}` : (install.stderr || install.stdout),
  };
}
