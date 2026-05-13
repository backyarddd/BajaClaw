import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

test("rateLimit defaults to 1000 cycles per rolling hour", async () => {
  const { rateLimit } = await import("../src/safety.ts");
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE cycles (started_at TEXT NOT NULL);");
    const insert = db.prepare("INSERT INTO cycles(started_at) VALUES (?)");
    const now = new Date().toISOString();
    for (let i = 0; i < 999; i++) insert.run(now);

    assert.deepEqual(rateLimit(db), { allow: true, used: 999 });

    db.prepare("INSERT INTO cycles(started_at) VALUES (?)").run(new Date().toISOString());
    assert.deepEqual(rateLimit(db), { allow: false, used: 1000 });
  } finally {
    db.close();
  }
});
