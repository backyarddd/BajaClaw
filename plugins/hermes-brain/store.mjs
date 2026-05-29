// Self-improving memory store (Hermes-inspired). Persists task outcomes and
// recalls relevant ones. Local, zero-dep: a lexical relevance score now, with a
// drop-in embedding upgrade path (set an embedder via setEmbedder()).
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const HOME = homedir();
const DIR = process.env.BAJACLAW_HOME || join(HOME, ".bajaclaw");
const MEM = join(DIR, "memory", "brain.jsonl");

let _embedder = null; // optional: (text)=>number[]; wired by openclaw provider later.
export function setEmbedder(fn) { _embedder = fn; }

function ensure() {
  const d = join(DIR, "memory");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  if (!existsSync(MEM)) writeFileSync(MEM, "");
}

function tokens(s) {
  return String(s || "").toLowerCase().match(/[a-z0-9]+/g) || [];
}

export function remember({ task, outcome, success, tags = [], at } = {}) {
  ensure();
  const rec = {
    id: `m${Date.now().toString(36)}`,
    task: task || "",
    outcome: outcome || "",
    success: success !== false,
    tags,
    at: at || new Date().toISOString(),
  };
  writeFileSync(MEM, JSON.stringify(rec) + "\n", { flag: "a" });
  return rec;
}

export function all() {
  ensure();
  return readFileSync(MEM, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
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
        name: `auto-${tag}`,
        from: arr.length,
        summary: `Learned from ${arr.length} successful "${tag}" tasks.`,
        examples: arr.slice(-3).map((r) => r.task),
      });
    }
  }
  return skills;
}

export const MEM_PATH = MEM;
