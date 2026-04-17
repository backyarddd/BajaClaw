import { test } from "node:test";
import assert from "node:assert/strict";

// Pure-function tests for the OpenAI ↔ BajaClaw translator.
test("translator: resolveProfile", async () => {
  const { resolveProfile } = await import("../src/api/translate.ts");
  assert.equal(resolveProfile(""), "default");
  assert.equal(resolveProfile("default"), "default");
  assert.equal(resolveProfile("researcher"), "researcher");
  assert.equal(resolveProfile("bajaclaw:triage"), "triage");
});

test("translator: taskFromMessages — single user message", async () => {
  const { taskFromMessages } = await import("../src/api/translate.ts");
  const task = taskFromMessages([{ role: "user", content: "hello" }]);
  assert.equal(task, "hello");
});

test("translator: taskFromMessages — renders prior transcript", async () => {
  const { taskFromMessages } = await import("../src/api/translate.ts");
  const task = taskFromMessages([
    { role: "user", content: "first" },
    { role: "assistant", content: "second" },
    { role: "user", content: "third" },
  ]);
  assert.ok(task.includes("Prior exchange"));
  assert.ok(task.includes("USER: first"));
  assert.ok(task.includes("ASSISTANT: second"));
  assert.ok(task.includes("Current message:"));
  assert.ok(task.endsWith("third"));
});

test("translator: chunkText produces ordered non-empty chunks", async () => {
  const { chunkText } = await import("../src/api/translate.ts");
  const chunks = chunkText("one two three four five six seven", 8);
  assert.ok(chunks.length >= 2);
  assert.equal(chunks.join(""), "one two three four five six seven");
  for (const c of chunks) assert.ok(c.length > 0);
});

test("translator: makeChunk shape matches OpenAI SSE payload", async () => {
  const { makeChunk } = await import("../src/api/translate.ts");
  const chunk = makeChunk("id-1", "default", { content: "hi" });
  assert.equal(chunk.object, "chat.completion.chunk");
  assert.equal(chunk.model, "default");
  assert.equal(chunk.choices[0].delta.content, "hi");
  assert.equal(chunk.choices[0].finish_reason, null);
});
