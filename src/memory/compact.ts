// Memory compaction. Keeps the memory pool lean so recall stays sharp
// and DB size stays bounded as the agent learns over time.
//
// How it works
// - Trigger: threshold (memory pool > fraction of reference context
//   window) OR schedule (daily at UTC time). Cheap check runs before
//   each cycle; the expensive summarization only runs when a trigger
//   fires.
// - Action per kind: keep newest N verbatim; chunk the rest; ask Haiku
//   to collapse each chunk into one dense summary; replace originals
//   with the summary row.
// - Also prunes cycle log rows older than `pruneCycleDays` and VACUUMs
//   the SQLite file to reclaim space.
//
// Why cycle-time triggers work: BajaClaw's cycles are already
// stateless — each cycle rebuilds the prompt from memory + skills +
// task. The model's own context window never "fills up" across cycles.
// The thing that grows unbounded is the memory DB itself. Compaction
// is memory hygiene, not conversation truncation.

import type { DB } from "../db.js";
import type { CompactionConfig } from "../types.js";
import type { Logger } from "../logger.js";

// Reference context window for threshold math. Uses Sonnet's window as
// the baseline because "auto" mode often lands on Sonnet. Conservative:
// Opus with 1M would never hit this, Haiku at 200k sizes the same.
const REFERENCE_CTX_TOKENS = 200_000;
const CHARS_PER_TOKEN = 4;
const REFERENCE_CTX_CHARS = REFERENCE_CTX_TOKENS * CHARS_PER_TOKEN;

export const DEFAULT_COMPACTION: Required<CompactionConfig> = {
  enabled: true,
  threshold: 0.75,
  schedule: "both",
  dailyAtUtc: "00:00",
  keepRecentPerKind: 25,
  pruneCycleDays: 30,
};

export interface CompactionDecision {
  yes: boolean;
  reason: string;
}

export interface CompactionResult {
  ran: boolean;
  reason: string;
  memoriesBefore: number;
  memoriesAfter: number;
  cyclesPruned: number;
  durationMs: number;
}

export function mergeCompactionDefaults(
  partial?: CompactionConfig,
): Required<CompactionConfig> {
  return { ...DEFAULT_COMPACTION, ...(partial ?? {}) };
}

export function shouldCompact(db: DB, partial?: CompactionConfig): CompactionDecision {
  const cfg = mergeCompactionDefaults(partial);
  if (!cfg.enabled || cfg.schedule === "off") {
    return { yes: false, reason: "disabled" };
  }

  if (cfg.schedule === "threshold" || cfg.schedule === "both") {
    const row = db
      .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(content)), 0) AS s FROM memories")
      .get() as { n: number; s: number };
    const cap = cfg.threshold * REFERENCE_CTX_CHARS;
    if (row.s > cap) {
      const pct = Math.round((row.s / REFERENCE_CTX_CHARS) * 100);
      return {
        yes: true,
        reason: `memory ${row.s.toLocaleString()} chars (~${pct}% of ${REFERENCE_CTX_CHARS.toLocaleString()})`,
      };
    }
  }

  if (cfg.schedule === "daily" || cfg.schedule === "both") {
    const last = getLastCompaction(db);
    const now = new Date();
    const target = todayAtUtc(cfg.dailyAtUtc, now);
    if (now.getTime() >= target.getTime()) {
      const lastBeforeToday = !last || last.getTime() < target.getTime();
      if (lastBeforeToday) {
        return { yes: true, reason: `daily schedule past ${cfg.dailyAtUtc} UTC` };
      }
    }
  }

  return { yes: false, reason: "no trigger" };
}

function todayAtUtc(hhmm: string, now: Date): Date {
  const [hStr, mStr] = (hhmm ?? "00:00").split(":");
  const h = Math.max(0, Math.min(23, Number(hStr) || 0));
  const m = Math.max(0, Math.min(59, Number(mStr) || 0));
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    h, m, 0, 0,
  ));
}

function getLastCompaction(db: DB): Date | null {
  const row = db
    .prepare("SELECT value FROM circuit_state WHERE key = 'last_compaction_at'")
    .get() as { value: string } | undefined;
  if (!row) return null;
  const d = new Date(row.value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function setLastCompaction(db: DB, at: Date): void {
  const iso = at.toISOString();
  db.prepare(`
    INSERT INTO circuit_state(key, value, updated_at)
    VALUES ('last_compaction_at', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(iso, iso);
}

export async function compact(
  db: DB,
  partial?: CompactionConfig,
  log?: Logger,
): Promise<CompactionResult> {
  const cfg = mergeCompactionDefaults(partial);
  const started = Date.now();
  const before = countMemories(db);

  const kinds = (db.prepare("SELECT DISTINCT kind FROM memories").all() as { kind: string }[])
    .map((r) => r.kind);
  for (const kind of kinds) {
    await compactKind(db, kind, cfg, log);
  }

  let cyclesPruned = 0;
  if (cfg.pruneCycleDays > 0) {
    const cutoff = new Date(Date.now() - cfg.pruneCycleDays * 86_400_000).toISOString();
    const info = db
      .prepare("DELETE FROM cycles WHERE started_at < ? AND status != 'running'")
      .run(cutoff);
    cyclesPruned = Number(info.changes);
  }

  try { db.exec("VACUUM"); } catch { /* locked; skip */ }

  setLastCompaction(db, new Date());
  const after = countMemories(db);

  return {
    ran: true,
    reason: "",
    memoriesBefore: before,
    memoriesAfter: after,
    cyclesPruned,
    durationMs: Date.now() - started,
  };
}

function countMemories(db: DB): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM memories").get() as { n: number }).n;
}

async function compactKind(
  db: DB,
  kind: string,
  cfg: Required<CompactionConfig>,
  log?: Logger,
): Promise<void> {
  const all = db
    .prepare("SELECT id, content, created_at FROM memories WHERE kind = ? ORDER BY id DESC")
    .all(kind) as { id: number; content: string; created_at: string }[];

  if (all.length <= cfg.keepRecentPerKind) return;
  const toCompact = all.slice(cfg.keepRecentPerKind);

  const BATCH = 40;
  for (let i = 0; i < toCompact.length; i += BATCH) {
    const batch = toCompact.slice(i, i + BATCH);
    if (batch.length < 3) continue;

    let summary: string | null;
    try {
      summary = await summarize(kind, batch.map((b) => b.content));
    } catch (e) {
      log?.warn("compact.summarize.fail", { kind, error: (e as Error).message });
      continue;
    }
    if (!summary) continue;

    const ids = batch.map((b) => b.id);
    const placeholders = ids.map(() => "?").join(",");
    const { insertMemory } = await import("./recall.js");
    db.exec("BEGIN");
    try {
      db.prepare(`DELETE FROM memories WHERE id IN (${placeholders})`).run(...ids);
      insertMemory(db, { kind, content: summary, source: "compacted" });
      db.exec("COMMIT");
      log?.info("compact.batch", { kind, collapsed: ids.length });
    } catch (e) {
      db.exec("ROLLBACK");
      log?.warn("compact.batch.fail", { kind, error: (e as Error).message });
    }
  }
}

async function summarize(kind: string, contents: string[]): Promise<string | null> {
  const joined = contents.map((c, i) => `${i + 1}. ${c.slice(0, 400)}`).join("\n");
  const prompt = `Collapse these ${kind} memories into one or two dense sentences that preserve every load-bearing fact. Drop duplicates. No preamble, no list, plain text only.

${joined}`;

  // Dynamic import keeps the top-level module free of runtime-only deps
  // so unit tests (which type-strip .ts imports) don't choke on the
  // claude.js import chain.
  const { runOnce } = await import("../claude.js");
  const r = await runOnce(prompt, {
    model: "claude-haiku-4-5",
    effort: "low",
    maxTurns: 1,
    printMode: true,
    disallowedTools: ["Bash", "Write", "Edit", "Read", "Grep", "Glob", "WebSearch", "WebFetch"],
  });
  if (!r.ok || !r.text) return null;
  const t = r.text.trim();
  return t.length > 0 ? t.slice(0, 600) : null;
}

// Pure helper so tests can exercise trigger math without a DB.
export function evaluateThreshold(
  totalChars: number,
  threshold: number,
): { over: boolean; cap: number; pct: number } {
  const cap = threshold * REFERENCE_CTX_CHARS;
  return {
    over: totalChars > cap,
    cap,
    pct: Math.round((totalChars / REFERENCE_CTX_CHARS) * 100),
  };
}

export const REFERENCE_CHARS = REFERENCE_CTX_CHARS;
