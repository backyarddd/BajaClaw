import { test } from "node:test";
import assert from "node:assert/strict";

test("runStream is exported and is an async function", async () => {
  const { runStream } = await import("../dist/claude.js");
  assert.equal(typeof runStream, "function");
  // Returns a thenable. We don't actually exec claude here - that
  // would require the CLI to be present and would spend money.
  assert.equal(runStream.constructor.name, "AsyncFunction");
});

test("runStream accepts partial-text callbacks in its signature", async () => {
  const { runStream } = await import("../dist/claude.js");
  const r = await runStream("hello", { dryRun: true }, { onPartialText: () => {} });
  // dryRun short-circuits to the runOnce dry-run path.
  assert.equal(r.ok, true);
  assert.equal(r.dryRun, true);
});
