import { test } from "node:test";
import assert from "node:assert/strict";

test("pickModel: respects a configured non-auto id", async () => {
  const { pickModel } = await import("../src/model-picker.ts");
  const r = pickModel({ configuredModel: "claude-opus-4-7", task: "hello" });
  assert.equal(r.model, "claude-opus-4-7");
  assert.equal(r.reason, "configured");
});

test("pickModel: heartbeat -> haiku", async () => {
  const { pickModel } = await import("../src/model-picker.ts");
  const r = pickModel({ task: "Heartbeat check. Review state.", configuredModel: "auto" });
  assert.equal(r.tier, "haiku");
  assert.equal(r.reason, "heartbeat");
});

test("pickModel: short + trivial markers -> haiku", async () => {
  const { pickModel } = await import("../src/model-picker.ts");
  const r = pickModel({ task: "check status", configuredModel: "auto" });
  assert.equal(r.tier, "haiku");
});

test("pickModel: very short -> haiku", async () => {
  const { pickModel } = await import("../src/model-picker.ts");
  const r = pickModel({ task: "yes", configuredModel: "auto" });
  assert.equal(r.tier, "haiku");
});

test("pickModel: coding markers -> opus", async () => {
  const { pickModel } = await import("../src/model-picker.ts");
  const cases = [
    "write a function that deduplicates an array",
    "refactor the user service to use async iteration",
    "debug the failing tests",
    "fix the bug in billing pipeline",
    "implement a migration from v1 to v2",
  ];
  for (const t of cases) {
    const r = pickModel({ task: t, configuredModel: "auto" });
    assert.equal(r.tier, "opus", `expected opus for "${t}" got ${r.tier}`);
  }
});

test("pickModel: planning markers -> opus", async () => {
  const { pickModel } = await import("../src/model-picker.ts");
  const r = pickModel({ task: "let's plan the roadmap for Q3", configuredModel: "auto" });
  assert.equal(r.tier, "opus");
});

test("pickModel: default falls through to sonnet", async () => {
  const { pickModel } = await import("../src/model-picker.ts");
  const r = pickModel({
    task: "summarize yesterday's email thread with the Stripe team and suggest next steps",
    configuredModel: "auto",
  });
  assert.equal(r.tier, "sonnet");
});

test("budgetFor tiers differ in shape", async () => {
  const { budgetFor } = await import("../src/model-picker.ts");
  const h = budgetFor("haiku"); const s = budgetFor("sonnet"); const o = budgetFor("opus");
  assert.ok(h.memoryCount < s.memoryCount && s.memoryCount < o.memoryCount);
  assert.ok(h.skillCount <= s.skillCount && s.skillCount <= o.skillCount);
  assert.ok(h.memoryCharsEach <= s.memoryCharsEach && s.memoryCharsEach <= o.memoryCharsEach);
});
