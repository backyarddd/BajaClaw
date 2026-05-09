import { test } from "node:test";
import assert from "node:assert/strict";

test("buildCommand: omits --bare when bare is undefined", async () => {
  const { buildCommand } = await import("../src/claude.ts");
  const args = buildCommand("hi", { model: "claude-sonnet-4-6" });
  assert.ok(!args.includes("--bare"));
});

test("buildCommand: emits --bare when bare:true", async () => {
  const { buildCommand } = await import("../src/claude.ts");
  const args = buildCommand("hi", { model: "claude-sonnet-4-6", bare: true });
  assert.ok(args.includes("--bare"));
});

test("buildCommand: --bare not duplicated when bare:false", async () => {
  const { buildCommand } = await import("../src/claude.ts");
  const args = buildCommand("hi", { model: "claude-sonnet-4-6", bare: false });
  assert.ok(!args.includes("--bare"));
});
