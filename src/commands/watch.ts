// File-watcher that turns `// AI:` / `# AI:` / `<!-- AI: -->` comments
// into tasks on the profile's queue. The daemon (or any other consumer
// of the tasks table) picks them up.
//
// Detection is dedup'd by a sha1 of (path + line + instruction) so
// saving the same file repeatedly won't re-enqueue the same comment.
// On first start we *seed* the dedup state by scanning every watched
// file without enqueuing, so existing `AI:` markers in the tree don't
// flood the queue. After the seed, any new or changed marker fires.
//
// The watcher runs in the foreground. Ctrl-C stops it. Longer-term the
// daemon could own this, but the CLI entry point is simple enough to
// exist on its own.

import { watch, readFileSync, writeFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, resolve, sep, relative } from "node:path";
import { createHash } from "node:crypto";
import chalk from "chalk";
import { openDb } from "../db.js";
import { profileDir, ensureDir } from "../paths.js";

export interface AiComment {
  line: number;
  col: number;
  marker: string;
  instruction: string;
}

// Patterns for the comment styles we accept. Order matters only for
// dedup when the same text could match two patterns (we dedup by
// (line,col,instruction) so that's handled).
// Patterns use horizontal-only whitespace ([ \t]) internally so `\s*`
// doesn't consume a newline and gobble text from the following line.
const PATTERNS: { re: RegExp; kind: string }[] = [
  { re: /\/\/[ \t]*AI:[ \t]*(.+?)[ \t]*$/gm, kind: "slash" },
  { re: /\/\*[ \t]*AI:[ \t]*(.+?)[ \t]*\*\//g, kind: "cblock" },
  { re: /<!--[ \t]*AI:[ \t]*(.+?)[ \t]*-->/g, kind: "html" },
  { re: /(?:^|[ \t])#[ \t]*AI:[ \t]*(.+?)[ \t]*$/gm, kind: "hash" },
  { re: /(?:^|[ \t])--[ \t]*AI:[ \t]*(.+?)[ \t]*$/gm, kind: "dash" },
];

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "coverage",
  "target", "__pycache__", ".venv", "venv",
  ".cache", ".turbo", ".nuxt", "out", ".output", ".idea", ".vscode",
  ".bajaclaw",
]);

const IGNORE_EXTS = [
  ".lock", ".map", ".min.js", ".min.css",
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".heic",
  ".pdf", ".zip", ".tar", ".gz", ".tgz",
  ".mp3", ".mp4", ".mov", ".m4a", ".wav", ".ogg",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".exe", ".bin", ".so", ".dylib", ".dll", ".a", ".o",
  ".jar", ".class",
];

const MAX_BYTES = 5 * 1024 * 1024;

export function scanForAiComments(text: string): AiComment[] {
  const found: AiComment[] = [];
  const seen = new Set<string>();
  for (const { re, kind } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const instruction = m[1]?.trim();
      if (!instruction) continue;
      const hit = m[0];
      const hitStart = m.index + hit.indexOf(instruction);
      const before = text.slice(0, hitStart);
      const line = before.split("\n").length;
      const col = hitStart - (before.lastIndexOf("\n") + 1);
      const key = `${line}:${col}:${instruction}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ line, col, marker: kind, instruction });
    }
  }
  return found.sort((a, b) => a.line - b.line || a.col - b.col);
}

export function shouldIgnorePath(filePath: string): boolean {
  const parts = filePath.split(sep).filter(Boolean);
  for (const p of parts) if (IGNORE_DIRS.has(p)) return true;
  const name = parts[parts.length - 1] ?? "";
  const lower = name.toLowerCase();
  for (const ext of IGNORE_EXTS) if (lower.endsWith(ext)) return true;
  return false;
}

export function hashComment(filePath: string, c: AiComment): string {
  return createHash("sha1")
    .update(`${filePath}\n${c.line}\n${c.instruction}`)
    .digest("hex");
}

// State: dedup record keyed by hash.
interface WatchState {
  seeded: boolean;
  hashes: Record<string, { path: string; line: number; instruction: string; enqueuedAt: string }>;
}

function statePath(profile: string): string {
  return join(profileDir(profile), "watch.state.json");
}

function loadState(profile: string): WatchState {
  const p = statePath(profile);
  if (!existsSync(p)) return { seeded: false, hashes: {} };
  try { return JSON.parse(readFileSync(p, "utf8")) as WatchState; }
  catch { return { seeded: false, hashes: {} }; }
}

function saveState(profile: string, s: WatchState): void {
  ensureDir(profileDir(profile));
  writeFileSync(statePath(profile), JSON.stringify(s, null, 2));
}

function readTextSafe(path: string): string | null {
  try {
    const s = statSync(path);
    if (!s.isFile() || s.size > MAX_BYTES) return null;
    const buf = readFileSync(path);
    // Quick binary sniff: NUL byte in the first 4 KB.
    const sniff = buf.subarray(0, Math.min(4096, buf.length));
    for (const b of sniff) if (b === 0) return null;
    return buf.toString("utf8");
  } catch { return null; }
}

// Enumerate every regular file under `root` that survives shouldIgnorePath.
// Used by the seed pass and by watch events that report a directory.
export function enumerateFiles(root: string, limit = 50000): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0 && out.length < limit) {
    const cur = stack.pop();
    if (!cur) break;
    let entries: import("node:fs").Dirent[];
    try { entries = readdirSync(cur, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      const full = join(cur, e.name);
      if (shouldIgnorePath(full)) continue;
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) out.push(full);
    }
  }
  return out;
}

function enqueue(
  profile: string,
  filePath: string,
  c: AiComment,
  state: WatchState,
  dryRun: boolean,
): boolean {
  const hash = hashComment(filePath, c);
  if (state.hashes[hash]) return false;
  if (!dryRun) {
    const db = openDb(profile);
    try {
      const body = `File: ${filePath}\nLine ${c.line}: ${c.instruction}\n\nPlease complete the task described in the AI comment. Read the surrounding context, make the edit, and remove the AI comment line (or replace it with a brief comment explaining the change).`;
      db.prepare(
        "INSERT INTO tasks(created_at, priority, status, body, source) VALUES(?,?,?,?,?)",
      ).run(new Date().toISOString(), "normal", "pending", body, `watch:${filePath}:${c.line}`);
    } finally { db.close(); }
  }
  state.hashes[hash] = {
    path: filePath,
    line: c.line,
    instruction: c.instruction,
    enqueuedAt: new Date().toISOString(),
  };
  return true;
}

export interface WatchOpts {
  profile: string;
  paths?: string[];
  purge?: boolean;
  once?: boolean;
  dryRun?: boolean;
}

export async function runWatch(opts: WatchOpts): Promise<void> {
  const roots = (opts.paths && opts.paths.length > 0)
    ? opts.paths.map((p) => resolve(p))
    : [process.cwd()];

  for (const r of roots) {
    if (!existsSync(r)) {
      console.error(chalk.red(`watch: path does not exist: ${r}`));
      process.exit(2);
    }
  }

  const state = opts.purge ? { seeded: false, hashes: {} } : loadState(opts.profile);

  // Seed pass: enumerate every file, record hashes, never enqueue. Prevents
  // the first `watch` invocation on an existing tree from flooding the queue.
  // --once runs this and exits (useful for tests + one-shot scans).
  if (!state.seeded || opts.once) {
    let scanned = 0;
    let markers = 0;
    let enqueued = 0;
    for (const r of roots) {
      for (const f of enumerateFiles(r)) {
        const text = readTextSafe(f);
        if (text === null) continue;
        scanned++;
        for (const c of scanForAiComments(text)) {
          markers++;
          const doEnqueue = state.seeded;
          if (doEnqueue && enqueue(opts.profile, f, c, state, !!opts.dryRun)) enqueued++;
          else if (!doEnqueue) {
            state.hashes[hashComment(f, c)] = {
              path: f, line: c.line, instruction: c.instruction,
              enqueuedAt: new Date().toISOString(),
            };
          }
        }
      }
    }
    if (!state.seeded) {
      state.seeded = true;
      console.log(chalk.dim(`seeded: ${scanned} files scanned, ${markers} existing markers recorded (none enqueued)`));
    } else {
      const verb = opts.dryRun ? "would enqueue" : "enqueued";
      console.log(chalk.green(`scan complete: ${scanned} files, ${enqueued} new task(s) ${verb}`));
    }
    if (!opts.dryRun) saveState(opts.profile, state);
    if (opts.once) return;
  }

  console.log(chalk.bold(`watching for AI: comments in ${roots.length} path(s):`));
  for (const r of roots) console.log(chalk.dim(`  ${r}`));
  console.log(chalk.dim("press Ctrl-C to stop"));

  // Debounce per-file so a flurry of saves collapses to one scan.
  const pending = new Map<string, NodeJS.Timeout>();
  const DEBOUNCE_MS = 300;

  const handleFile = (full: string): void => {
    const existing = pending.get(full);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      pending.delete(full);
      if (shouldIgnorePath(full)) return;
      const text = readTextSafe(full);
      if (text === null) return;
      const comments = scanForAiComments(text);
      let count = 0;
      for (const c of comments) {
        if (enqueue(opts.profile, full, c, state, !!opts.dryRun)) {
          count++;
          const rel = relative(process.cwd(), full);
          const prefix = opts.dryRun ? "?" : "+";
          console.log(chalk.green(`${prefix} ${rel}:${c.line}  `) + chalk.dim(c.instruction));
        }
      }
      if (count > 0 && !opts.dryRun) saveState(opts.profile, state);
    }, DEBOUNCE_MS);
    pending.set(full, timer);
  };

  for (const r of roots) {
    try {
      const w = watch(r, { recursive: true }, (_evt, filename) => {
        if (!filename) return;
        const full = resolve(r, String(filename));
        handleFile(full);
      });
      w.on("error", (e) => console.error(chalk.red(`watch error on ${r}: ${e.message}`)));
    } catch (e) {
      console.error(chalk.red(`failed to watch ${r}: ${(e as Error).message}`));
      process.exit(1);
    }
  }

  // Keep the process alive. Ctrl-C handled by default.
  await new Promise<void>(() => { /* never resolves */ });
}
