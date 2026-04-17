import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { profileDir, ensureDir } from "../paths.js";
import { openDb } from "../db.js";
import { insertMemory } from "../memory/recall.js";

// Import from a YonderClaw directory. QIS/Hive artifacts are skipped.
export async function runMigrate(profile: string, fromDir: string): Promise<void> {
  if (!existsSync(fromDir)) throw new Error(`source not found: ${fromDir}`);
  ensureDir(profileDir(profile));
  const db = openDb(profile);
  try {
    let imported = 0;
    for (const name of ["CLAUDE.md", "SOUL.md", "HEARTBEAT.md"]) {
      const src = join(fromDir, name);
      if (!existsSync(src)) continue;
      const body = scrubYonderArtifacts(readFileSync(src, "utf8"));
      const dst = join(profileDir(profile), name);
      require("node:fs").writeFileSync(dst, body);
      console.log(chalk.green(`✓ ${name} (${body.length} bytes)`));
      imported++;
    }
    // Memories: YonderClaw commonly stored notes in <dir>/memory/*.md
    const memDir = join(fromDir, "memory");
    if (existsSync(memDir)) {
      for (const f of require("node:fs").readdirSync(memDir)) {
        if (!f.endsWith(".md")) continue;
        const body = scrubYonderArtifacts(readFileSync(join(memDir, f), "utf8"));
        if (!body.trim()) continue;
        insertMemory(db, { kind: "imported", content: `${f}: ${body.slice(0, 2000)}`, source: "yonderclaw" });
        imported++;
      }
    }
    console.log(chalk.green(`✓ imported ${imported} files/memories (QIS/Hive entries skipped)`));
  } finally { db.close(); }
}

const SKIP_PATTERNS = [
  /\bQIS\b/gi,
  /\bHive\b/gi,
  /hyperswarm/gi,
  /dht-local\.db/gi,
  /yonder ?zenith/gi,
  /64\.23\.192\.227/g,
];

function scrubYonderArtifacts(body: string): string {
  let out = body;
  for (const p of SKIP_PATTERNS) out = out.replace(p, "[removed]");
  return out;
}
