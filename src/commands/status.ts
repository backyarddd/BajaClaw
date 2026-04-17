import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { bajaclawHome } from "../paths.js";
import { openDb } from "../db.js";

export async function runStatus(profile?: string): Promise<void> {
  const profiles = profile ? [profile] : listProfiles();
  if (profiles.length === 0) {
    console.log(chalk.dim("no profiles yet. run `bajaclaw init <name>`."));
    return;
  }
  for (const p of profiles) {
    const db = openDb(p);
    try {
      const c = db.prepare("SELECT COUNT(*) c FROM cycles").get() as { c: number };
      const last = db.prepare("SELECT started_at FROM cycles ORDER BY id DESC LIMIT 1").get() as { started_at: string } | undefined;
      const mem = db.prepare("SELECT COUNT(*) c FROM memories").get() as { c: number };
      const tasks = db.prepare("SELECT COUNT(*) c FROM tasks WHERE status='pending'").get() as { c: number };
      console.log(chalk.bold(p));
      console.log(`  cycles:  ${c.c}${last ? `  last=${last.started_at}` : ""}`);
      console.log(`  memories: ${mem.c}`);
      console.log(`  pending tasks: ${tasks.c}`);
    } finally { db.close(); }
  }
}

function listProfiles(): string[] {
  const dir = join(bajaclawHome(), "profiles");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => existsSync(join(dir, n, "config.json")));
}
