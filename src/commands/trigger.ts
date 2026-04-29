import chalk from "chalk";
import { openDb } from "../db.js";
import { wakeAgent } from "./daemon.js";

export async function runTrigger(profile: string, event: string, body?: string): Promise<void> {
  const db = openDb(profile);
  try {
    db.prepare("INSERT INTO tasks(created_at, priority, status, body, source) VALUES(?,?,?,?,?)").run(
      new Date().toISOString(), "normal", "pending", body ?? event, `trigger:${event}`,
    );
    wakeAgent(profile);
    console.log(chalk.green(`✓ enqueued ${event}`));
  } finally { db.close(); }
}
