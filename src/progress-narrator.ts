// Mid-cycle narration.
//
// Watches claude's stream-json event feed and emits short, natural
// progress lines describing what the agent is doing (tool calls,
// skill matches, subagent spawns). Zero prompt cost - the narrator
// runs in the orchestrator and does NOT ask the agent to say
// anything itself.
//
// Two sinks:
//   - "live":    called on every progress update (edit-in-place channels)
//   - "summary": called once at cycle end with a consolidated list
//                (iMessage, dashboard, anywhere edits aren't available)
//
// Verbosity levels:
//   off    - handleEvent returns without doing anything
//   medium - phase changes only: skills, web search, long/named bash
//            (builds, tests, installs), file writes, subagent spawns
//   full   - every tool call, including reads and short bashes

import type { Verbosity } from "./types.js";

export interface NarrationUpdate {
  // Full body for the "progress message" - what the current snapshot
  // of activity looks like. Edit-in-place channels send this verbatim.
  body: string;
  // The most recent single-line event - for adapters that want to show
  // just the latest action (chat REPL status line, e.g.).
  latest: string;
}

export interface NarratorOptions {
  verbosity: Verbosity;
  // Called on every live update. Debounced internally so callers see
  // one event per ~800ms even if a burst of tool_use events lands.
  onUpdate?: (u: NarrationUpdate) => void;
  // Optional debounce window in ms. Defaults to 800.
  debounceMs?: number;
  // Optional hard cap on live-update emissions. Past this, handleEvent
  // still records entries for the summary but stops firing onUpdate.
  // Protects against Telegram/Discord rate limits on pathological runs.
  maxLiveUpdates?: number;
}

interface Entry {
  icon: string;
  text: string;
}

const MEDIUM_NARRATED_TOOLS = new Set([
  "WebSearch",
  "WebFetch",
  "Task",  // subagent
  "Edit",
  "Write",
  "MultiEdit",
]);

// Bash commands worth surfacing at "medium". Anything else falls
// through as a short shell-running line. This list is intentionally
// narrow - we're not trying to narrate every `ls` or `cat`.
const MEDIUM_BASH_PATTERNS: RegExp[] = [
  /\b(npm|pnpm|yarn|bun)\s+(install|ci|test|run|build|publish|audit)\b/,
  /\b(cargo|go|mvn|gradle|make|dotnet)\s+(test|build|run|install|publish)\b/,
  /\b(pytest|jest|vitest|mocha|playwright)\b/,
  /\b(git\s+(clone|pull|push|fetch|rebase|merge|bisect))\b/,
  /\b(docker|kubectl|terraform|ansible)\b/,
  /\b(tsc|eslint|prettier|ruff|mypy)\b/,
];

export class ProgressNarrator {
  private readonly entries: Entry[] = [];
  private readonly verbosity: Verbosity;
  private readonly onUpdate?: (u: NarrationUpdate) => void;
  private readonly debounceMs: number;
  private readonly maxLiveUpdates: number;
  private liveUpdateCount = 0;
  private timer: NodeJS.Timeout | null = null;
  private dirty = false;

  constructor(opts: NarratorOptions) {
    this.verbosity = opts.verbosity;
    this.onUpdate = opts.onUpdate;
    this.debounceMs = opts.debounceMs ?? 800;
    this.maxLiveUpdates = opts.maxLiveUpdates ?? 40;
  }

  /** Seed the narrator with a line before the cycle runs. Used for
   *  skill matches, which are detected at prompt-assembly time, not
   *  from the stream. Fires an immediate live update (no debounce)
   *  so the first visible narration lands fast. */
  addSkill(name: string): void {
    if (this.verbosity === "off") return;
    this.push({ icon: "🎯", text: `using skill: ${name}` }, { immediate: true });
  }

  /** Seed with an arbitrary line. Used for things like "learned new skill"
   *  mid-cycle. Honors verbosity (off silences). */
  addNote(text: string, icon = "•"): void {
    if (this.verbosity === "off") return;
    this.push({ icon, text }, { immediate: true });
  }

  /** Ingest one NDJSON event from `runStream`. Silently ignores
   *  anything it doesn't recognize - the stream schema drifts across
   *  claude CLI versions and we'd rather miss narration than crash. */
  handleEvent(ev: Record<string, unknown>): void {
    if (this.verbosity === "off") return;

    // Tool_use blocks can arrive in a few shapes depending on CLI version.
    // The shapes we care about:
    //   {type:"assistant", message:{content:[{type:"tool_use",name,input}]}}
    //   {type:"content_block_start", content_block:{type:"tool_use",name,input}}
    //   {type:"stream_event", event:{type:"content_block_start", content_block:{...}}}
    const toolUses = extractToolUses(ev);
    for (const tu of toolUses) this.ingestToolUse(tu);
  }

  private ingestToolUse(tu: { name: string; input: Record<string, unknown> }): void {
    const entry = formatToolUse(tu, this.verbosity);
    if (!entry) return;
    this.push(entry, { immediate: false });
  }

  private push(entry: Entry, opts: { immediate: boolean }): void {
    // Dedupe consecutive duplicates (e.g. two reads of the same file
    // emitted back-to-back). Keeps the message short.
    const last = this.entries[this.entries.length - 1];
    if (last && last.icon === entry.icon && last.text === entry.text) return;
    this.entries.push(entry);
    this.dirty = true;
    if (opts.immediate) this.flushNow();
    else this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flushNow(), this.debounceMs);
  }

  private flushNow(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.dirty) return;
    this.dirty = false;
    if (!this.onUpdate) return;
    if (this.liveUpdateCount >= this.maxLiveUpdates) return;
    this.liveUpdateCount += 1;
    const update = this.snapshot();
    try { this.onUpdate(update); }
    catch { /* sinks must not kill the run */ }
  }

  /** Force-flush pending debounced update. Called at cycle end. */
  finalize(): NarrationUpdate {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    return this.snapshot();
  }

  /** Build a compact one-line summary for adapters that cannot edit
   *  in place (iMessage). Stays under ~140 chars so it sits cleanly
   *  above the final reply. */
  summary(): string {
    if (this.entries.length === 0) return "";
    // Collapse repeats and cap the shown count. Keep icons so the
    // summary matches the style of the live updates.
    const shown = this.entries.slice(0, 8);
    const extra = this.entries.length - shown.length;
    const lines = shown.map((e) => `${e.icon} ${e.text}`);
    if (extra > 0) lines.push(`… and ${extra} more`);
    return lines.join("\n");
  }

  /** Full list, newest last. For the live edit-in-place body. */
  snapshot(): NarrationUpdate {
    const lines = this.entries.map((e) => `${e.icon} ${e.text}`);
    const body = lines.join("\n");
    const latest = lines[lines.length - 1] ?? "";
    return { body, latest };
  }

  /** Whether anything has been recorded. */
  get hasContent(): boolean { return this.entries.length > 0; }
}

function formatToolUse(
  tu: { name: string; input: Record<string, unknown> },
  verbosity: Verbosity,
): Entry | null {
  const { name, input } = tu;

  // Subagents.
  if (name === "Task") {
    if (verbosity === "off") return null;
    const desc = typeof input.description === "string" ? input.description : "";
    const short = truncate(desc, 60) || "sub-task";
    return { icon: "🤖", text: `delegating to subagent: ${short}` };
  }

  // Web.
  if (name === "WebSearch") {
    const q = typeof input.query === "string" ? input.query : "";
    return { icon: "🌐", text: `searching the web: ${truncate(q, 60)}` };
  }
  if (name === "WebFetch") {
    const url = typeof input.url === "string" ? input.url : "";
    return { icon: "🌐", text: `opening ${prettifyUrl(url)}` };
  }

  // File ops.
  if (name === "Read") {
    if (verbosity !== "full") return null;
    const fp = typeof input.file_path === "string" ? input.file_path : "";
    return { icon: "📖", text: `reading ${baseName(fp)}` };
  }
  if (name === "Write") {
    const fp = typeof input.file_path === "string" ? input.file_path : "";
    return { icon: "📝", text: `writing ${baseName(fp)}` };
  }
  if (name === "Edit" || name === "MultiEdit") {
    const fp = typeof input.file_path === "string" ? input.file_path : "";
    return { icon: "✏️", text: `editing ${baseName(fp)}` };
  }
  if (name === "Glob" || name === "Grep") {
    if (verbosity !== "full") return null;
    const pat = typeof input.pattern === "string" ? input.pattern : "";
    return { icon: "🔎", text: `${name === "Glob" ? "finding files" : "searching code"}: ${truncate(pat, 50)}` };
  }

  // Bash.
  if (name === "Bash") {
    const cmd = typeof input.command === "string" ? input.command : "";
    const trimmed = cmd.trim();
    if (!trimmed) return null;
    const firstLine = trimmed.split("\n")[0]!;
    if (verbosity === "medium") {
      const summary = summarizeBash(firstLine);
      if (!summary) return null;
      return { icon: summary.icon, text: summary.text };
    }
    // Full: narrate every bash, but keep it short.
    const summary = summarizeBash(firstLine);
    if (summary) return { icon: summary.icon, text: summary.text };
    return { icon: "⚙️", text: `running \`${truncate(firstLine, 60)}\`` };
  }

  // MCP / other tools. At "full", surface the tool name. At "medium",
  // only if we recognize it.
  if (verbosity === "full") {
    return { icon: "🔧", text: `${name}` };
  }
  if (MEDIUM_NARRATED_TOOLS.has(name)) {
    return { icon: "🔧", text: `${name}` };
  }
  return null;
}

function summarizeBash(cmd: string): Entry | null {
  if (/\b(npm|pnpm|yarn|bun)\s+(install|ci)\b/.test(cmd)) {
    return { icon: "📦", text: "installing dependencies" };
  }
  if (/\b(npm|pnpm|yarn|bun)\s+(test)\b|\b(pytest|jest|vitest|mocha|playwright)\b/.test(cmd)) {
    return { icon: "🧪", text: "running tests" };
  }
  if (/\b(npm|pnpm|yarn|bun)\s+(run\s+)?build\b|\b(tsc|cargo\s+build|go\s+build)\b/.test(cmd)) {
    return { icon: "🔨", text: "building" };
  }
  if (/\b(npm|pnpm|yarn|bun)\s+(run\s+)?(publish|release)\b/.test(cmd)) {
    return { icon: "🚀", text: "publishing" };
  }
  if (/\bgit\s+(clone|pull|fetch)\b/.test(cmd)) {
    return { icon: "⬇️", text: "syncing from git" };
  }
  if (/\bgit\s+push\b/.test(cmd)) {
    return { icon: "⬆️", text: "pushing to git" };
  }
  if (/\bgit\s+commit\b/.test(cmd)) {
    return { icon: "📌", text: "committing" };
  }
  if (MEDIUM_BASH_PATTERNS.some((p) => p.test(cmd))) {
    return { icon: "⚙️", text: `running \`${truncate(cmd, 60)}\`` };
  }
  return null;
}

function extractToolUses(ev: Record<string, unknown>): { name: string; input: Record<string, unknown> }[] {
  const out: { name: string; input: Record<string, unknown> }[] = [];

  const inner = (ev.event ?? ev) as Record<string, unknown>;
  const innerType = inner.type;

  // {type:"content_block_start", content_block:{type:"tool_use", name, input}}
  if (innerType === "content_block_start") {
    const block = inner.content_block as Record<string, unknown> | undefined;
    if (block && block.type === "tool_use" && typeof block.name === "string") {
      out.push({
        name: block.name,
        input: (block.input as Record<string, unknown>) ?? {},
      });
    }
  }

  // {type:"assistant", message:{content:[{type:"tool_use", name, input}]}}
  const msg = (ev.message ?? inner.message) as Record<string, unknown> | undefined;
  const content = msg?.content as unknown[] | undefined;
  if (Array.isArray(content)) {
    for (const c of content) {
      const cc = c as Record<string, unknown>;
      if (cc?.type === "tool_use" && typeof cc.name === "string") {
        out.push({
          name: cc.name,
          input: (cc.input as Record<string, unknown>) ?? {},
        });
      }
    }
  }

  return out;
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)) + "…";
}

function baseName(fp: string): string {
  if (!fp) return "";
  const parts = fp.split(/[/\\]+/);
  return parts[parts.length - 1] || fp;
}

function prettifyUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname && u.pathname !== "/" ? truncate(u.pathname, 40) : "");
  } catch {
    return truncate(url, 60);
  }
}
