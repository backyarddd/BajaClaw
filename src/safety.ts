import type { DB } from "./db.js";

export interface CircuitState {
  open: boolean;
  failures: number;
  opened_at?: string;
}

const KEY = "claude.breaker";
const FAIL_THRESHOLD = 5;
const COOLDOWN_MS = 15 * 60 * 1000;

export function read(db: DB): CircuitState {
  const row = db.prepare("SELECT value FROM circuit_state WHERE key=?").get(KEY) as { value: string } | undefined;
  if (!row) return { open: false, failures: 0 };
  try { return JSON.parse(row.value) as CircuitState; } catch { return { open: false, failures: 0 }; }
}

function write(db: DB, state: CircuitState): void {
  db.prepare(
    "INSERT INTO circuit_state(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at"
  ).run(KEY, JSON.stringify(state), new Date().toISOString());
}

export function shouldAllow(db: DB): { allow: boolean; reason?: string } {
  const s = read(db);
  if (!s.open) return { allow: true };
  if (s.opened_at && Date.now() - Date.parse(s.opened_at) > COOLDOWN_MS) {
    write(db, { open: false, failures: 0 });
    return { allow: true };
  }
  return { allow: false, reason: `circuit-breaker open (failures=${s.failures})` };
}

export function recordSuccess(db: DB): void {
  write(db, { open: false, failures: 0 });
}

export function recordFailure(db: DB): CircuitState {
  const s = read(db);
  const failures = s.failures + 1;
  const open = failures >= FAIL_THRESHOLD;
  const next: CircuitState = { open, failures, opened_at: open ? new Date().toISOString() : s.opened_at };
  write(db, next);
  return next;
}

// Conservative default to stay well under backend fair-use limits.
// Bump via an override if your subscription/plan genuinely supports more.
const DEFAULT_MAX_PER_HOUR = 30;

export function rateLimit(db: DB, maxPerHour = DEFAULT_MAX_PER_HOUR): { allow: boolean; used: number } {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const row = db.prepare("SELECT COUNT(*) as c FROM cycles WHERE started_at > ?").get(cutoff) as { c: number };
  return { allow: row.c < maxPerHour, used: row.c };
}
