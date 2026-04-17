import { appendFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { profileLogDir, ensureDir } from "./paths.js";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export class Logger {
  constructor(private profile: string) {
    ensureDir(profileLogDir(profile));
  }

  private file(): string {
    const d = new Date().toISOString().slice(0, 10);
    return join(profileLogDir(this.profile), `${d}.jsonl`);
  }

  log(level: "info" | "warn" | "error" | "debug", event: string, data?: Record<string, unknown>): void {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      event,
      profile: this.profile,
      ...data,
    });
    try {
      appendFileSync(this.file(), line + "\n");
    } catch {
      // swallow — never crash on log errors
    }
    if (process.env.BAJACLAW_VERBOSE === "1" || level === "error") {
      const out = level === "error" ? process.stderr : process.stdout;
      out.write(`[${level}] ${event} ${data ? JSON.stringify(data) : ""}\n`);
    }
  }

  info(e: string, d?: Record<string, unknown>) { this.log("info", e, d); }
  warn(e: string, d?: Record<string, unknown>) { this.log("warn", e, d); }
  error(e: string, d?: Record<string, unknown>) { this.log("error", e, d); }
  debug(e: string, d?: Record<string, unknown>) { this.log("debug", e, d); }

  rotate(): void {
    const dir = profileLogDir(this.profile);
    const cutoff = Date.now() - THIRTY_DAYS_MS;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".jsonl")) continue;
      const full = join(dir, f);
      try {
        if (statSync(full).mtimeMs < cutoff) unlinkSync(full);
      } catch { /* ignore */ }
    }
  }
}
