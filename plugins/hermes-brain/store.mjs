// Self-improving memory store (Hermes-inspired). Persists task outcomes and
// recalls relevant ones. Local, zero-dep: a lexical relevance score, with an
// in-memory cache so recall (on every agent turn) does not re-read the whole
// log from disk each time.
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { CONFIG_DIR } from "../../src/config/config.mjs";

const MEM = join(CONFIG_DIR, "memory", "brain.jsonl");

let _cache = null;
let _cacheKey = null;

function ensure() {
  const d = join(CONFIG_DIR, "memory");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  if (!existsSync(MEM)) writeFileSync(MEM, "");
}

function statKey() {
  try { const s = statSync(MEM); return `${s.mtimeMs}:${s.size}`; } catch { return "0"; }
}

function tokens(s) {
  return String(s || "").toLowerCase().match(/[a-z0-9]+/g) || [];
}

export function all() {
  ensure();
  const key = statKey();
  if (_cache && _cacheKey === key) return _cache;
  _cache = readFileSync(MEM, "utf8")
    .split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
  _cacheKey = key;
  return _cache;
}

export function remember({ task, outcome, success, tags = [], at } = {}) {
  ensure();
  const rec = {
    id: `m${Date.now().toString(36)}`,
    task: task || "", outcome: outcome || "",
    success: success !== false, tags, at: at || new Date().toISOString(),
  };
  writeFileSync(MEM, JSON.stringify(rec) + "\n", { flag: "a" });
  if (_cache) { _cache.push(rec); _cacheKey = statKey(); } // keep cache warm
  return rec;
}

export function recall(query, { limit = 5 } = {}) {
  const recs = all();
  if (!recs.length) return [];
  const q = new Set(tokens(query));
  const scored = recs.map((r) => {
    const t = tokens(r.task + " " + r.outcome + " " + (r.tags || []).join(" "));
    let overlap = 0;
    for (const w of t) if (q.has(w)) overlap++;
    const recency = 1 / (1 + (Date.now() - Date.parse(r.at)) / 8.64e7); // days decay
    const successBoost = r.success ? 1.15 : 0.9;
    return { rec: r, score: (overlap + recency) * successBoost };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.rec);
}

// Skill synthesis: if the same kind of task succeeded >=N times, propose a skill.
export function synthesizeSkills({ minSuccesses = 3 } = {}) {
  const buckets = new Map();
  for (const r of all()) {
    if (!r.success) continue;
    for (const tag of r.tags.length ? r.tags : [tokens(r.task)[0] || "general"]) {
      const arr = buckets.get(tag) || [];
      arr.push(r);
      buckets.set(tag, arr);
    }
  }
  const skills = [];
  for (const [tag, arr] of buckets) {
    if (arr.length >= minSuccesses) {
      skills.push({
        name: `auto-${tag}`, from: arr.length,
        summary: `Learned from ${arr.length} successful "${tag}" tasks.`,
        examples: arr.slice(-3).map((r) => r.task),
      });
    }
  }
  return skills;
}
