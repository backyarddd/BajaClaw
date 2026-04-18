import chalk from "chalk";
import { openDb } from "../db.js";
import { read as readBreaker, rateLimit } from "../safety.js";

export async function runHealthCmd(profile: string): Promise<void> {
  const db = openDb(profile);
  try {
    const breaker = readBreaker(db);
    const rl = rateLimit(db);
    const row = db.prepare(
      "SELECT COUNT(*) c, SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) errs, MAX(started_at) last FROM cycles WHERE started_at > datetime('now','-24 hours')"
    ).get() as { c: number; errs: number; last: string | null };
    console.log(`profile:       ${chalk.bold(profile)}`);
    console.log(`cycles (24h):  ${row.c} (${row.errs} errors)`);
    console.log(`last cycle:    ${row.last ?? "-"}`);
    console.log(`breaker:       ${breaker.open ? chalk.red("open") : chalk.green("closed")} (failures=${breaker.failures})`);
    console.log(`rate limit:    ${rl.used}/hr`);
  } finally { db.close(); }
}
