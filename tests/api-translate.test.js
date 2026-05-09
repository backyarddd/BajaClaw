import { test } from "node:test";
import assert from "node:assert/strict";

test("resolveRequest: bare profile name", async () => {
  const { resolveRequest } = await import("../src/api/translate.ts");
  const r = resolveRequest("default");
  assert.equal(r.profile, "default");
  assert.equal(r.modelOverride, undefined);
});

test("resolveRequest: bajaclaw: prefix stripped", async () => {
  const { resolveRequest } = await import("../src/api/translate.ts");
  const r = resolveRequest("bajaclaw:researcher");
  assert.equal(r.profile, "researcher");
  assert.equal(r.modelOverride, undefined);
});

test("resolveRequest: profile:model override", async () => {
  const { resolveRequest } = await import("../src/api/translate.ts");
  const r = resolveRequest("default:claude-opus-4-7");
  assert.equal(r.profile, "default");
  assert.equal(r.modelOverride, "claude-opus-4-7");
});

test("resolveRequest: bajaclaw:profile:model", async () => {
  const { resolveRequest } = await import("../src/api/translate.ts");
  const r = resolveRequest("bajaclaw:researcher:claude-sonnet-4-6");
  assert.equal(r.profile, "researcher");
  assert.equal(r.modelOverride, "claude-sonnet-4-6");
});

test("resolveRequest: bare auto applies to default profile", async () => {
  const { resolveRequest } = await import("../src/api/translate.ts");
  const r = resolveRequest("auto");
  assert.equal(r.profile, "default");
  assert.equal(r.modelOverride, "auto");
});

test("resolveRequest: bare claude- id applies to default profile", async () => {
  const { resolveRequest } = await import("../src/api/translate.ts");
  const r = resolveRequest("claude-opus-4-7");
  assert.equal(r.profile, "default");
  assert.equal(r.modelOverride, "claude-opus-4-7");
});

test("resolveRequest: empty string falls back to default", async () => {
  const { resolveRequest } = await import("../src/api/translate.ts");
  const r = resolveRequest("");
  assert.equal(r.profile, "default");
});

test("usageFromCycle: populates from cycle output and sums total", async () => {
  const { usageFromCycle } = await import("../src/api/translate.ts");
  const u = usageFromCycle({
    cycleId: 1, ok: true, text: "hi", durationMs: 1, prompt: "",
    inputTokens: 1234, outputTokens: 567,
  });
  assert.equal(u.prompt_tokens, 1234);
  assert.equal(u.completion_tokens, 567);
  assert.equal(u.total_tokens, 1801);
});

test("usageFromCycle: missing token counts coerce to 0", async () => {
  const { usageFromCycle } = await import("../src/api/translate.ts");
  const u = usageFromCycle({ cycleId: 1, ok: true, text: "", durationMs: 1, prompt: "" });
  assert.equal(u.prompt_tokens, 0);
  assert.equal(u.completion_tokens, 0);
  assert.equal(u.total_tokens, 0);
});

test("cycleToCompletion: usage matches CycleOutput", async () => {
  const { cycleToCompletion } = await import("../src/api/translate.ts");
  const c = cycleToCompletion("default", {
    cycleId: 7, ok: true, text: "ok", durationMs: 1, prompt: "",
    inputTokens: 100, outputTokens: 25,
  });
  assert.equal(c.usage.prompt_tokens, 100);
  assert.equal(c.usage.completion_tokens, 25);
  assert.equal(c.usage.total_tokens, 125);
  assert.equal(c.choices[0].finish_reason, "stop");
});

test("makeUsageChunk: terminal usage chunk has empty choices and populated usage", async () => {
  const { makeUsageChunk } = await import("../src/api/translate.ts");
  const ch = makeUsageChunk("id-1", "default", {
    prompt_tokens: 10, completion_tokens: 5, total_tokens: 15,
  });
  assert.equal(ch.object, "chat.completion.chunk");
  assert.deepEqual(ch.choices, []);
  assert.equal(ch.usage.prompt_tokens, 10);
  assert.equal(ch.usage.total_tokens, 15);
});
