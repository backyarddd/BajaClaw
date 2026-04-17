// Two-way bridge between BajaClaw FTS memories and ~/.claude/memory/.
// Opt-in per profile via memorySync: true.
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { claudeMemoryDir, ensureDir } from "../paths.js";
import type { DB } from "../db.js";
import { insertMemory, listRecent } from "./recall.js";
import type { Logger } from "../logger.js";

export function syncFromClaude(db: DB, log?: Logger): number {
  const dir = claudeMemoryDir();
  if (!existsSync(dir)) return 0;

  const seenKey = "claude-compat:last_sync";
  const row = db.prepare("SELECT value FROM circuit_state WHERE key=?").get(seenKey) as { value: string } | undefined;
  const last = row ? Date.parse(row.value) : 0;
  let imported = 0;

  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md")) continue;
    const full = join(dir, name);
    let s; try { s = statSync(full); } catch { continue; }
    if (s.mtimeMs <= last) continue;
    const body = readFileSync(full, "utf8").trim();
    if (!body) continue;
    insertMemory(db, {
      kind: "claude-code",
      content: `${name}: ${body.slice(0, 2000)}`,
      source: "claude-code",
    });
    imported++;
  }

  db.prepare(
    "INSERT INTO circuit_state(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at"
  ).run(seenKey, new Date().toISOString(), new Date().toISOString());

  if (log) log.info("memory.sync.from-claude", { imported });
  return imported;
}

export function writeClaudeMemoryFile(profile: string, db: DB): string {
  const dir = ensureDir(claudeMemoryDir());
  const path = join(dir, `bajaclaw-${profile}.md`);
  const mems = listRecent(db, 50);
  const lines = [
    `# BajaClaw memories for profile: ${profile}`,
    `Generated ${new Date().toISOString()}`,
    "",
    ...mems.map((m) => `- [${m.kind}] ${m.content}`),
  ];
  writeFileSync(path, lines.join("\n"));
  return path;
}
