// Phase 4: reflection cycle. Every N cycles, ask claude to review recent runs and
// (optionally) emit a candidate SKILL.md. Candidates land in ~/.bajaclaw/skills/auto/
// pending `bajaclaw skill review`.
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runOnce } from "./claude.js";
import { openDb, type DB } from "./db.js";
import { bajaclawHome } from "./paths.js";
import type { Logger } from "./logger.js";

const DEFAULT_N = 15;

export async function maybeReflect(profile: string, log: Logger, every = DEFAULT_N): Promise<string | null> {
  const db = openDb(profile);
  try {
    const row = db.prepare("SELECT COUNT(*) as c FROM cycles WHERE status='ok'").get() as { c: number };
    if (row.c === 0 || row.c % every !== 0) return null;
    return await reflect(db, profile, log);
  } finally { db.close(); }
}

export async function reflect(db: DB, profile: string, log: Logger): Promise<string | null> {
  const recent = db.prepare(
    "SELECT task, response_preview FROM cycles WHERE status='ok' ORDER BY id DESC LIMIT 20"
  ).all() as { task: string; response_preview: string }[];

  const summary = recent.map((r, i) => `${i + 1}. ${r.task.slice(0, 200)} -> ${(r.response_preview ?? "").slice(0, 200)}`).join("\n");

  const prompt = `You are reviewing the last ${recent.length} cycles of an autonomous agent.
If there is a recurring pattern worth capturing as a reusable skill, return a SKILL.md verbatim (starting with '---' frontmatter block with name, description, version 0.1.0). Otherwise return the single word NONE.

Recent cycles:
${summary}`;

  const r = await runOnce(prompt, { model: "claude-sonnet-4-5", effort: "high", maxTurns: 2, printMode: true });
  if (!r.ok || !r.text || r.text.trim() === "NONE") return null;

  if (!r.text.includes("---")) return null;
  const m = r.text.match(/name:\s*([\w-]+)/);
  const name = m?.[1] ?? `auto-${Date.now()}`;
  const dir = join(bajaclawHome(), "skills", "auto");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const skillDir = join(dir, name);
  if (!existsSync(skillDir)) mkdirSync(skillDir, { recursive: true });
  const path = join(skillDir, "SKILL.md");
  writeFileSync(path, r.text);
  log.info("self-improve.candidate", { profile, name, path });
  return path;
}
