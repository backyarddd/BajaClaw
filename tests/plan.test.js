import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("migration v3 creates the plans table", async () => {
  const home = mkdtempSync(join(tmpdir(), "bajaclaw-plan-"));
  process.env.BAJACLAW_HOME = home;
  try {
    const { openDb } = await import("../dist/db.js");
    const db = openDb("test-profile");
    try {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='plans'").get();
      assert.ok(row, "plans table missing");
      // Insert + read round-trip.
      db.prepare(
        "INSERT INTO plans(created_at, status, task, plan_text) VALUES(?,?,?,?)",
      ).run(new Date().toISOString(), "pending", "test task", "## Goal\nDo X");
      const r = db.prepare("SELECT id, status, task FROM plans LIMIT 1").get();
      assert.equal(r.status, "pending");
      assert.equal(r.task, "test task");
    } finally { db.close(); }
  } finally {
    delete process.env.BAJACLAW_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});

test("cmdPlanList prints (no-throw) on empty profile", async () => {
  const home = mkdtempSync(join(tmpdir(), "bajaclaw-plan-"));
  process.env.BAJACLAW_HOME = home;
  try {
    const { cmdPlanList } = await import("../dist/commands/plan.js");
    // Just verify the function runs without throwing on a fresh profile.
    await cmdPlanList("test-profile");
    assert.ok(true);
  } finally {
    delete process.env.BAJACLAW_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});
