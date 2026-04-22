// Expand `@file:path`, `@folder:path`, `@url:...`, `@cycle:id`,
// `@memory:query`, `@screen` references in a chat prompt into a
// "Referenced context" block appended to the task text.
//
// Bare forms supported:
//   @src/foo.ts    -> resolves as a path (file or folder by stat)
//   @http(s)://... -> resolves as url
//   @screen        -> screenshot trigger (wired in F3)
//
// Email-like text (`foo@bar.com`) is not a ref: a negative lookbehind
// on the `@` requires it to be at start-of-string or preceded by
// whitespace.
//
// Files over 50 KB get head + tail, not full content. URLs time out at
// 10 s and truncate at 50 KB. Folders list up to 100 entries.

import { readFileSync, statSync, readdirSync, existsSync } from "node:fs";
import { resolve, extname, relative } from "node:path";
import { openDb } from "./db.js";
import { recall } from "./memory/recall.js";

// Capture `@` + letter-led non-whitespace so any practical path or URL
// survives, including Windows shenanigans (`~`, spaces escaped via
// path-quoting tools, etc.). Trailing prose punctuation (`.,;!?)]`)
// is stripped after the match so `look at @file:foo.ts.` works.
const REF_RE = /(?<!\S)@([a-zA-Z]\S*)/g;
const TRAILING_PROSE = /[.,;!?)\]]+$/;
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".bmp"]);
const MAX_FILE_BYTES = 50 * 1024;
const MAX_FILE_HEAD = 20 * 1024;
const MAX_FILE_TAIL = 20 * 1024;
const MAX_FOLDER_ENTRIES = 100;
const MAX_URL_BYTES = 50 * 1024;
const URL_TIMEOUT_MS = 10_000;

export interface ParsedRef {
  raw: string;      // "file:src/foo.ts"
  kind: string;     // "file" | "folder" | "dir" | "url" | "cycle" | "memory" | "mem" | "screen" | "path"
  arg: string;      // "src/foo.ts"
}

export function parseAtRefs(text: string): ParsedRef[] {
  const out: ParsedRef[] = [];
  REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REF_RE.exec(text)) !== null) {
    let raw = m[1]!.replace(TRAILING_PROSE, "");
    if (!raw) continue;
    // URL check MUST come before the colon split - raw URLs contain colons
    // (`https://...`) and would otherwise be parsed as `kind=https`.
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      out.push({ raw, kind: "url", arg: raw });
      continue;
    }
    const colon = raw.indexOf(":");
    if (colon >= 0) {
      const kind = raw.slice(0, colon);
      const arg = raw.slice(colon + 1);
      if (!arg) continue;
      out.push({ raw, kind, arg });
      continue;
    }
    if (raw === "screen" || raw === "screenshot") {
      out.push({ raw, kind: "screen", arg: "" });
    } else {
      out.push({ raw, kind: "path", arg: raw });
    }
  }
  return out;
}

export interface ExpandResult {
  task: string;
  attachments: string[];
  warnings: string[];
  resolvedRefs: ParsedRef[];
}

export interface ExpandOpts {
  profile: string;
  cwd?: string;
  // Injection hook for @screen. F3 wires this to the screenshot command.
  onScreen?: () => Promise<string | null>;
  // Allow tests to disable network.
  fetchFn?: typeof fetch;
}

export async function expandAtRefs(text: string, opts: ExpandOpts): Promise<ExpandResult> {
  const refs = parseAtRefs(text);
  if (refs.length === 0) {
    return { task: text, attachments: [], warnings: [], resolvedRefs: [] };
  }

  const cwd = opts.cwd ?? process.cwd();
  const blocks: string[] = [];
  const attachments: string[] = [];
  const warnings: string[] = [];
  const resolved: ParsedRef[] = [];
  const seen = new Set<string>();

  for (const ref of refs) {
    if (seen.has(ref.raw)) continue;
    seen.add(ref.raw);
    try {
      const kind = ref.kind.toLowerCase();
      if (kind === "file" || kind === "path") {
        const out = resolveFileOrPath(ref.arg, cwd);
        if (out.error) warnings.push(`@${ref.raw}: ${out.error}`);
        else if (out.attachment) attachments.push(out.attachment);
        else if (out.block) blocks.push(out.block);
        if (!out.error) resolved.push(ref);
      } else if (kind === "folder" || kind === "dir") {
        const out = resolveFolder(ref.arg, cwd);
        if (out.error) warnings.push(`@${ref.raw}: ${out.error}`);
        else if (out.block) blocks.push(out.block);
        if (!out.error) resolved.push(ref);
      } else if (kind === "cycle") {
        const out = resolveCycle(ref.arg, opts.profile);
        if (out.error) warnings.push(`@${ref.raw}: ${out.error}`);
        else if (out.block) blocks.push(out.block);
        if (!out.error) resolved.push(ref);
      } else if (kind === "memory" || kind === "mem") {
        const out = resolveMemory(ref.arg, opts.profile);
        if (out.error) warnings.push(`@${ref.raw}: ${out.error}`);
        else if (out.block) blocks.push(out.block);
        if (!out.error) resolved.push(ref);
      } else if (kind === "url") {
        const out = await resolveUrl(ref.arg, opts.fetchFn);
        if (out.error) warnings.push(`@${ref.raw}: ${out.error}`);
        else if (out.block) blocks.push(out.block);
        if (!out.error) resolved.push(ref);
      } else if (kind === "screen") {
        if (!opts.onScreen) {
          warnings.push(`@${ref.raw}: screen capture not wired in this context`);
          continue;
        }
        const path = await opts.onScreen();
        if (!path) warnings.push(`@${ref.raw}: screen capture returned no image`);
        else { attachments.push(path); resolved.push(ref); }
      } else {
        warnings.push(`@${ref.raw}: unknown ref kind '${ref.kind}'`);
      }
    } catch (e) {
      warnings.push(`@${ref.raw}: ${(e as Error).message}`);
    }
  }

  if (blocks.length === 0 && attachments.length === 0) {
    return { task: text, attachments: [], warnings, resolvedRefs: resolved };
  }

  let outTask = text;
  if (blocks.length > 0) {
    outTask = `${text}\n\n---\n## Referenced context\n\n${blocks.join("\n\n")}`;
  }
  return { task: outTask, attachments, warnings, resolvedRefs: resolved };
}

// --- resolvers ---

interface ResOut {
  block?: string;
  attachment?: string;
  error?: string;
}

function resolveFileOrPath(arg: string, cwd: string): ResOut {
  const abs = resolve(cwd, arg);
  if (!existsSync(abs)) return { error: "no such file or folder" };
  let st: import("node:fs").Stats;
  try { st = statSync(abs); } catch (e) { return { error: (e as Error).message }; }

  if (st.isDirectory()) return resolveFolder(arg, cwd);
  if (!st.isFile()) return { error: "not a regular file" };

  const ext = extname(abs).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return { attachment: abs };

  const size = st.size;
  let content: string;
  if (size <= MAX_FILE_BYTES) {
    content = readFileSync(abs, "utf8");
  } else {
    const head = readFileSync(abs).subarray(0, MAX_FILE_HEAD).toString("utf8");
    const tail = readFileSync(abs).subarray(size - MAX_FILE_TAIL).toString("utf8");
    const skipped = size - MAX_FILE_HEAD - MAX_FILE_TAIL;
    content = `${head}\n\n... [${skipped} bytes truncated] ...\n\n${tail}`;
  }

  const rel = relative(cwd, abs) || abs;
  const lang = extToFence(ext);
  return { block: `### @${rel}\n\`\`\`${lang}\n${content}\n\`\`\`` };
}

function resolveFolder(arg: string, cwd: string): ResOut {
  const abs = resolve(cwd, arg);
  if (!existsSync(abs)) return { error: "no such folder" };
  let st: import("node:fs").Stats;
  try { st = statSync(abs); } catch (e) { return { error: (e as Error).message }; }
  if (!st.isDirectory()) return { error: "not a directory" };

  const entries = readdirSync(abs, { withFileTypes: true }).slice(0, MAX_FOLDER_ENTRIES);
  const lines = entries.map((e) => `${e.isDirectory() ? "d" : "f"}  ${e.name}`);
  const rel = relative(cwd, abs) || abs;
  const total = readdirSync(abs).length;
  const more = total > MAX_FOLDER_ENTRIES ? `\n... (${total - MAX_FOLDER_ENTRIES} more entries)` : "";
  return { block: `### @folder:${rel}\n\`\`\`\n${lines.join("\n")}${more}\n\`\`\`` };
}

function resolveCycle(arg: string, profile: string): ResOut {
  const id = Number(arg);
  if (!Number.isInteger(id) || id <= 0) return { error: "cycle id must be a positive integer" };
  const db = openDb(profile);
  try {
    const row = db.prepare(
      "SELECT id, task, response_preview, model, status, started_at FROM cycles WHERE id = ?",
    ).get(id) as undefined | { id: number; task: string; response_preview: string | null; model: string | null; status: string; started_at: string };
    if (!row) return { error: `cycle #${id} not found` };
    const task = (row.task ?? "").slice(0, 2000);
    const resp = (row.response_preview ?? "").slice(0, 4000);
    return {
      block: `### @cycle:${row.id}  (${row.model ?? "?"} · ${row.status} · ${row.started_at})\n**Task**\n${task}\n\n**Response**\n${resp}`,
    };
  } finally { db.close(); }
}

function resolveMemory(arg: string, profile: string): ResOut {
  const query = arg.trim();
  if (!query) return { error: "empty memory query" };
  const db = openDb(profile);
  try {
    const hits = recall(db, query, 5);
    if (hits.length === 0) return { block: `### @memory:${query}\n(no matches)` };
    const lines = hits.map((m, i) => `${i + 1}. [${m.kind}] ${(m.content ?? "").slice(0, 300)}`);
    return { block: `### @memory:${query}\n${lines.join("\n")}` };
  } finally { db.close(); }
}

async function resolveUrl(url: string, fetchFn?: typeof fetch): Promise<ResOut> {
  const f = fetchFn ?? fetch;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), URL_TIMEOUT_MS);
  try {
    const res = await f(url, { signal: ac.signal });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    const truncated = buf.length > MAX_URL_BYTES;
    const body = buf.subarray(0, MAX_URL_BYTES).toString("utf8");
    const trimmed = truncated ? `${body}\n\n... [${buf.length - MAX_URL_BYTES} bytes truncated] ...` : body;
    return { block: `### @url:${url}\n\`\`\`\n${trimmed}\n\`\`\`` };
  } catch (e) {
    const msg = (e as Error).name === "AbortError" ? "timeout" : (e as Error).message;
    return { error: msg };
  } finally { clearTimeout(timer); }
}

function extToFence(ext: string): string {
  const m: Record<string, string> = {
    ".ts": "ts", ".tsx": "tsx", ".js": "js", ".jsx": "jsx", ".mjs": "js", ".cjs": "js",
    ".py": "python", ".rb": "ruby", ".go": "go", ".rs": "rust", ".java": "java",
    ".c": "c", ".cpp": "cpp", ".h": "c", ".hpp": "cpp", ".cs": "csharp",
    ".sh": "bash", ".bash": "bash", ".zsh": "bash", ".fish": "fish",
    ".md": "markdown", ".html": "html", ".css": "css", ".scss": "scss",
    ".json": "json", ".yaml": "yaml", ".yml": "yaml", ".toml": "toml",
    ".sql": "sql", ".swift": "swift", ".kt": "kotlin", ".lua": "lua",
    ".xml": "xml",
  };
  return m[ext] ?? "";
}
