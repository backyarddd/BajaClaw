import { test } from "node:test";
import assert from "node:assert/strict";

test("mergeCompactionDefaults: fills in missing fields", async () => {
  const { mergeCompactionDefaults } = await import("../src/memory/compact.ts");
  const merged = mergeCompactionDefaults({ threshold: 0.5 });
  assert.equal(merged.threshold, 0.5);
  assert.equal(merged.enabled, true);
  assert.equal(merged.schedule, "both");
  assert.equal(merged.dailyAtUtc, "00:00");
  assert.equal(merged.keepRecentPerKind, 25);
  assert.equal(merged.pruneCycleDays, 30);
});

test("mergeCompactionDefaults: undefined returns full defaults", async () => {
  const { mergeCompactionDefaults } = await import("../src/memory/compact.ts");
  const merged = mergeCompactionDefaults(undefined);
  assert.equal(merged.enabled, true);
  assert.equal(merged.schedule, "both");
});

test("evaluateThreshold: returns over=false below cap", async () => {
  const { evaluateThreshold, REFERENCE_CHARS } = await import("../src/memory/compact.ts");
  const r = evaluateThreshold(100_000, 0.75);
  assert.equal(r.over, false);
  assert.equal(r.cap, 0.75 * REFERENCE_CHARS);
  assert.ok(r.pct >= 0 && r.pct < 50);
});

test("evaluateThreshold: returns over=true above cap", async () => {
  const { evaluateThreshold, REFERENCE_CHARS } = await import("../src/memory/compact.ts");
  const oversized = Math.round(REFERENCE_CHARS * 0.8);
  const r = evaluateThreshold(oversized, 0.75);
  assert.equal(r.over, true);
});

test("shouldCompact: disabled returns no", async () => {
  const Database = (await import("better-sqlite3")).default;
  const { shouldCompact } = await import("../src/memory/compact.ts");
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE memories (id INTEGER PRIMARY KEY, content TEXT);
    CREATE TABLE circuit_state (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
  `);
  const r = shouldCompact(db, { enabled: false });
  assert.equal(r.yes, false);
  assert.match(r.reason, /disabled/);
  db.close();
});

test("shouldCompact: schedule=off returns no", async () => {
  const Database = (await import("better-sqlite3")).default;
  const { shouldCompact } = await import("../src/memory/compact.ts");
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE memories (id INTEGER PRIMARY KEY, content TEXT);
    CREATE TABLE circuit_state (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
  `);
  const r = shouldCompact(db, { enabled: true, schedule: "off" });
  assert.equal(r.yes, false);
  db.close();
});

test("shouldCompact: threshold trigger fires on oversized pool", async () => {
  const Database = (await import("better-sqlite3")).default;
  const { shouldCompact, REFERENCE_CHARS } = await import("../src/memory/compact.ts");
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE memories (id INTEGER PRIMARY KEY, content TEXT);
    CREATE TABLE circuit_state (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
  `);
  const bigContent = "x".repeat(Math.ceil(REFERENCE_CHARS * 0.8));
  db.prepare("INSERT INTO memories(content) VALUES(?)").run(bigContent);
  const r = shouldCompact(db, { enabled: true, schedule: "threshold", threshold: 0.75 });
  assert.equal(r.yes, true);
  assert.match(r.reason, /chars/);
  db.close();
});

test("shouldCompact: threshold under cap returns no", async () => {
  const Database = (await import("better-sqlite3")).default;
  const { shouldCompact } = await import("../src/memory/compact.ts");
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE memories (id INTEGER PRIMARY KEY, content TEXT);
    CREATE TABLE circuit_state (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
  `);
  db.prepare("INSERT INTO memories(content) VALUES(?)").run("short");
  const r = shouldCompact(db, { enabled: true, schedule: "threshold", threshold: 0.75 });
  assert.equal(r.yes, false);
  db.close();
});

test("shouldCompact: daily with recent compaction returns no", async () => {
  const Database = (await import("better-sqlite3")).default;
  const { shouldCompact } = await import("../src/memory/compact.ts");
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE memories (id INTEGER PRIMARY KEY, content TEXT);
    CREATE TABLE circuit_state (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
  `);
  const inFuture = new Date(Date.now() + 86400000).toISOString();
  db.prepare("INSERT INTO circuit_state(key,value,updated_at) VALUES(?,?,?)")
    .run("last_compaction_at", inFuture, inFuture);
  const r = shouldCompact(db, { enabled: true, schedule: "daily", dailyAtUtc: "00:00" });
  assert.equal(r.yes, false);
  db.close();
});

test("DEFAULT_COMPACTION matches spec", async () => {
  const { DEFAULT_COMPACTION } = await import("../src/memory/compact.ts");
  assert.equal(DEFAULT_COMPACTION.enabled, true);
  assert.equal(DEFAULT_COMPACTION.threshold, 0.75);
  assert.equal(DEFAULT_COMPACTION.schedule, "both");
  assert.equal(DEFAULT_COMPACTION.dailyAtUtc, "00:00");
  assert.equal(DEFAULT_COMPACTION.keepRecentPerKind, 25);
  assert.equal(DEFAULT_COMPACTION.pruneCycleDays, 30);
});
