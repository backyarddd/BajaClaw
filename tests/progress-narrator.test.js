import { test } from "node:test";
import assert from "node:assert/strict";

// Event shapes the narrator must handle. These are NDJSON payloads
// from `claude --output-format stream-json --include-partial-messages
// --verbose`, captured across the three dialects runStream already
// supports (see src/claude.ts landmine 53).

function toolUseContentBlockStart(name, input) {
  return { type: "content_block_start", content_block: { type: "tool_use", name, input } };
}

function streamEventContentBlockStart(name, input) {
  return {
    type: "stream_event",
    event: { type: "content_block_start", content_block: { type: "tool_use", name, input } },
  };
}

function assistantMessage(name, input) {
  return {
    type: "assistant",
    message: { content: [{ type: "tool_use", name, input }] },
  };
}

test("verbosity=off emits nothing", async () => {
  const { ProgressNarrator } = await import("../dist/progress-narrator.js");
  const updates = [];
  const n = new ProgressNarrator({ verbosity: "off", onUpdate: (u) => updates.push(u) });
  n.addSkill("frontend-dev");
  n.handleEvent(toolUseContentBlockStart("WebSearch", { query: "anything" }));
  n.handleEvent(toolUseContentBlockStart("Edit", { file_path: "/foo/bar.ts" }));
  await new Promise((r) => setTimeout(r, 50));
  n.finalize();
  assert.equal(updates.length, 0);
  assert.equal(n.summary(), "");
  assert.equal(n.hasContent, false);
});

test("medium verbosity narrates skills + web + writes but not reads", async () => {
  const { ProgressNarrator } = await import("../dist/progress-narrator.js");
  const n = new ProgressNarrator({ verbosity: "medium", debounceMs: 5 });
  n.addSkill("frontend-dev");
  n.handleEvent(toolUseContentBlockStart("Read", { file_path: "/x/y.ts" }));
  n.handleEvent(toolUseContentBlockStart("WebSearch", { query: "bajaclaw" }));
  n.handleEvent(toolUseContentBlockStart("Edit", { file_path: "/x/y.ts" }));
  await new Promise((r) => setTimeout(r, 30));
  n.finalize();
  const body = n.summary();
  assert.match(body, /using skill: frontend-dev/);
  assert.match(body, /searching the web: bajaclaw/);
  assert.match(body, /editing y\.ts/);
  // Read must NOT appear at medium.
  assert.doesNotMatch(body, /reading y\.ts/);
});

test("full verbosity narrates reads too", async () => {
  const { ProgressNarrator } = await import("../dist/progress-narrator.js");
  const n = new ProgressNarrator({ verbosity: "full", debounceMs: 5 });
  n.handleEvent(toolUseContentBlockStart("Read", { file_path: "/x/y.ts" }));
  n.finalize();
  assert.match(n.summary(), /reading y\.ts/);
});

test("bash narration collapses known commands to icons", async () => {
  const { ProgressNarrator } = await import("../dist/progress-narrator.js");
  const n = new ProgressNarrator({ verbosity: "medium", debounceMs: 5 });
  n.handleEvent(toolUseContentBlockStart("Bash", { command: "npm install" }));
  n.handleEvent(toolUseContentBlockStart("Bash", { command: "npm test" }));
  n.handleEvent(toolUseContentBlockStart("Bash", { command: "npm run build" }));
  n.handleEvent(toolUseContentBlockStart("Bash", { command: "git push origin main" }));
  // Noise bash - at medium this should be skipped entirely.
  n.handleEvent(toolUseContentBlockStart("Bash", { command: "ls -la" }));
  n.finalize();
  const body = n.summary();
  assert.match(body, /installing dependencies/);
  assert.match(body, /running tests/);
  assert.match(body, /building/);
  assert.match(body, /pushing to git/);
  assert.doesNotMatch(body, /ls -la/);
});

test("handles assistant-message tool-use shape", async () => {
  const { ProgressNarrator } = await import("../dist/progress-narrator.js");
  const n = new ProgressNarrator({ verbosity: "medium", debounceMs: 5 });
  n.handleEvent(assistantMessage("WebFetch", { url: "https://example.com/path" }));
  n.finalize();
  assert.match(n.summary(), /opening example\.com/);
});

test("handles stream_event wrapper", async () => {
  const { ProgressNarrator } = await import("../dist/progress-narrator.js");
  const n = new ProgressNarrator({ verbosity: "medium", debounceMs: 5 });
  n.handleEvent(streamEventContentBlockStart("Task", { description: "scrape pricing data" }));
  n.finalize();
  assert.match(n.summary(), /delegating to subagent: scrape pricing data/);
});

test("debounces live updates", async () => {
  const { ProgressNarrator } = await import("../dist/progress-narrator.js");
  const updates = [];
  const n = new ProgressNarrator({
    verbosity: "full",
    debounceMs: 30,
    onUpdate: (u) => updates.push(u.latest),
  });
  // Fire four events back to back - debounce should collapse them
  // into a single live update.
  n.handleEvent(toolUseContentBlockStart("Read", { file_path: "/a.ts" }));
  n.handleEvent(toolUseContentBlockStart("Read", { file_path: "/b.ts" }));
  n.handleEvent(toolUseContentBlockStart("Read", { file_path: "/c.ts" }));
  n.handleEvent(toolUseContentBlockStart("Read", { file_path: "/d.ts" }));
  await new Promise((r) => setTimeout(r, 60));
  // We expect one debounced flush total; finalize() is non-firing.
  n.finalize();
  assert.equal(updates.length, 1);
  assert.match(updates[0], /reading d\.ts/);
});

test("addSkill fires an immediate update (no debounce wait)", async () => {
  const { ProgressNarrator } = await import("../dist/progress-narrator.js");
  const updates = [];
  const n = new ProgressNarrator({
    verbosity: "medium",
    debounceMs: 5000,
    onUpdate: (u) => updates.push(u.latest),
  });
  n.addSkill("pr-review");
  assert.equal(updates.length, 1);
  assert.match(updates[0], /using skill: pr-review/);
  n.finalize();
});

test("dedupes consecutive identical events", async () => {
  const { ProgressNarrator } = await import("../dist/progress-narrator.js");
  const n = new ProgressNarrator({ verbosity: "full", debounceMs: 5 });
  n.handleEvent(toolUseContentBlockStart("Read", { file_path: "/a.ts" }));
  n.handleEvent(toolUseContentBlockStart("Read", { file_path: "/a.ts" }));
  n.finalize();
  // One entry, not two.
  const lines = n.summary().split("\n").filter(Boolean);
  assert.equal(lines.length, 1);
});

test("summary caps at 8 entries with an overflow suffix", async () => {
  const { ProgressNarrator } = await import("../dist/progress-narrator.js");
  const n = new ProgressNarrator({ verbosity: "full", debounceMs: 5 });
  for (let i = 0; i < 12; i++) {
    n.handleEvent(toolUseContentBlockStart("Read", { file_path: `/f${i}.ts` }));
  }
  n.finalize();
  const lines = n.summary().split("\n");
  assert.equal(lines.length, 9);
  assert.match(lines[lines.length - 1], /and 4 more/);
});

test("ignores unknown event shapes silently", async () => {
  const { ProgressNarrator } = await import("../dist/progress-narrator.js");
  const n = new ProgressNarrator({ verbosity: "full", debounceMs: 5 });
  // Should not throw, should not add entries.
  n.handleEvent({ type: "nothing", weird: true });
  n.handleEvent({ type: "result", result: "ok" });
  n.finalize();
  assert.equal(n.hasContent, false);
});

test("caps live update emissions past the limit", async () => {
  const { ProgressNarrator } = await import("../dist/progress-narrator.js");
  const updates = [];
  const n = new ProgressNarrator({
    verbosity: "full",
    debounceMs: 5,
    maxLiveUpdates: 3,
    onUpdate: (u) => updates.push(u.latest),
  });
  // Fire lots of events with pauses between so each flushes.
  for (let i = 0; i < 10; i++) {
    n.handleEvent(toolUseContentBlockStart("Read", { file_path: `/f${i}.ts` }));
    await new Promise((r) => setTimeout(r, 15));
  }
  n.finalize();
  assert.equal(updates.length, 3);
  // Summary still has every entry even though live sink was capped.
  const lines = n.summary().split("\n").filter(Boolean);
  assert.equal(lines.length, 9); // 8 shown + "and 2 more"
});

test("config.verbosity default is medium", async () => {
  const { mergedDefaults } = await import("../dist/config.js");
  const cfg = mergedDefaults({ name: "x", profile: "x", template: "custom", model: "auto", effort: "high" });
  assert.equal(cfg.verbosity, "medium");
});
