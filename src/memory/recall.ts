import type { DB } from "../db.js";
import type { Memory } from "../types.js";

export function recall(db: DB, query: string, limit = 10): Memory[] {
  const terms = query
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3)
    .slice(0, 8);

  if (terms.length === 0) {
    return db.prepare("SELECT * FROM memories ORDER BY id DESC LIMIT ?").all(limit) as Memory[];
  }

  const match = terms.map((t) => `${t}*`).join(" OR ");
  try {
    const rows = db.prepare(`
      SELECT m.* FROM memories_fts f
      JOIN memories m ON m.id = f.memory_id
      WHERE memories_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(match, limit) as Memory[];
    if (rows.length > 0) return rows;
  } catch { /* FTS may reject — fall through */ }

  return db.prepare("SELECT * FROM memories ORDER BY id DESC LIMIT ?").all(limit) as Memory[];
}

export function listRecent(db: DB, limit = 50): Memory[] {
  return db.prepare("SELECT * FROM memories ORDER BY id DESC LIMIT ?").all(limit) as Memory[];
}

export function insertMemory(db: DB, m: Omit<Memory, "id" | "created_at">): number {
  const info = db.prepare(
    "INSERT INTO memories(kind,content,source,source_cycle_id,created_at) VALUES(?,?,?,?,?)"
  ).run(m.kind, m.content, m.source, m.source_cycle_id ?? null, new Date().toISOString());
  return info.lastInsertRowid as number;
}
