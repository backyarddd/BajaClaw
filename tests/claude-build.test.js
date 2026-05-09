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

test("buildCommand: omits lightweight flags when lightweight is unset", async () => {
  const { buildCommand } = await import("../src/claude.ts");
  const args = buildCommand("hi", { model: "claude-sonnet-4-6" });
  assert.ok(!args.includes("--setting-sources=local"));
  assert.ok(!args.includes("--strict-mcp-config"));
  assert.ok(!args.includes("--no-session-persistence"));
});

test("buildCommand: emits all three lightweight flags when lightweight:true", async () => {
  const { buildCommand } = await import("../src/claude.ts");
  const args = buildCommand("hi", { model: "claude-sonnet-4-6", lightweight: true });
  assert.ok(args.includes("--setting-sources=local"));
  assert.ok(args.includes("--strict-mcp-config"));
  assert.ok(args.includes("--no-session-persistence"));
  assert.ok(!args.includes("--bare"));
});

test("buildCommand: lightweight + bare can coexist (both flag sets emitted)", async () => {
  const { buildCommand } = await import("../src/claude.ts");
  const args = buildCommand("hi", { model: "claude-sonnet-4-6", lightweight: true, bare: true });
  assert.ok(args.includes("--bare"));
  assert.ok(args.includes("--setting-sources=local"));
});
