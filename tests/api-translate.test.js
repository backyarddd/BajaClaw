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
