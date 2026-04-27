import { test } from "node:test";
import assert from "node:assert/strict";

// Minimal Skill stand-ins. The real Skill type has more fields but the
// matcher only cares about name / description / triggers / tags.
const IMAGE_GEN = {
  name: "image-gen",
  description: "Generate an image from a text prompt and send it back through the active channel",
  triggers: ["generate an image", "make an image", "draw me", "image of"],
  body: "",
  path: "",
  scope: "bajaclaw-builtin",
};
const GRAPHIFY = {
  name: "graphify",
  description: "any input (code, docs, papers, images) - knowledge graph - clustered communities - HTML + JSON + audit report",
  triggers: ["/graphify"],
  body: "",
  path: "",
  scope: "claude-user",
};
const PR_REVIEW = {
  name: "pr-review",
  description: "Review a pull request",
  triggers: ["/review", "review pull request", "review pr"],
  body: "",
  path: "",
  scope: "bajaclaw-builtin",
};

const SKILLS = [IMAGE_GEN, GRAPHIFY, PR_REVIEW];

// Regression case from the user's screenshot. Discussion about images
// in scenes should NOT activate image-gen or graphify.
const DISCUSSION_TASK =
  "For the scenes we could use images instead of creating video graphics for everything. Like for example let say a robber is robbing a bank it doesnt have to be an animated video it can just be a picture graphic of that scene.";

function fakeRunner(textOrThrow) {
  return async () => {
    if (textOrThrow instanceof Error) throw textOrThrow;
    return { ok: true, text: textOrThrow, events: [], durationMs: 1 };
  };
}

test("matchSkills: explicit slash trigger short-circuits the LLM call", async () => {
  const { matchSkills } = await import("../src/skills/matcher.ts");
  let called = false;
  const runner = async () => {
    called = true;
    return { ok: true, text: "[]", events: [], durationMs: 0 };
  };
  const out = await matchSkills(SKILLS, "/graphify ./docs", 3, { runner });
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "graphify");
  assert.equal(called, false, "slash fast path must not call the LLM");
});

test("matchSkills: LLM returns [] for discussion text -> no skills (regression)", async () => {
  const { matchSkills } = await import("../src/skills/matcher.ts");
  const out = await matchSkills(SKILLS, DISCUSSION_TASK, 3, { runner: fakeRunner("[]") });
  assert.deepEqual(out, []);
});

test("matchSkills: LLM picks image-gen for an explicit request", async () => {
  const { matchSkills } = await import("../src/skills/matcher.ts");
  const out = await matchSkills(
    SKILLS,
    "make me an image of a robber robbing a bank",
    3,
    { runner: fakeRunner('["image-gen"]') },
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "image-gen");
});

test("matchSkills: LLM response wrapped in prose is still parsed", async () => {
  const { matchSkills } = await import("../src/skills/matcher.ts");
  const wrapped = 'Sure, here is the result: ["pr-review"] - hope this helps';
  const out = await matchSkills(SKILLS, "review my PR", 3, { runner: fakeRunner(wrapped) });
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "pr-review");
});

test("matchSkills: LLM returns unknown skill name -> filtered out", async () => {
  const { matchSkills } = await import("../src/skills/matcher.ts");
  const out = await matchSkills(SKILLS, "do something", 3, { runner: fakeRunner('["bogus", "image-gen"]') });
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "image-gen");
});

test("matchSkills: LLM throws -> falls back to keyword matcher", async () => {
  const { matchSkills } = await import("../src/skills/matcher.ts");
  const traces = [];
  const out = await matchSkills(
    SKILLS,
    "generate an image of a sunset",
    3,
    {
      runner: fakeRunner(new Error("backend exited 1")),
      onTrace: (route, names, err) => traces.push({ route, names, err }),
    },
  );
  // keyword matcher should fire on the explicit "generate an image" trigger
  assert.ok(out.some((s) => s.name === "image-gen"), "expected image-gen via keyword fallback");
  assert.equal(traces.length, 1);
  assert.equal(traces[0].route, "llm-fallback-keyword");
  assert.equal(traces[0].err, "backend exited 1");
});

test("matchSkills: LLM returns garbage -> falls back to keyword matcher", async () => {
  const { matchSkills } = await import("../src/skills/matcher.ts");
  const traces = [];
  await matchSkills(SKILLS, "draw me a cat", 3, {
    runner: fakeRunner("not json at all"),
    onTrace: (route, names, err) => traces.push({ route, names, err }),
  });
  assert.equal(traces.length, 1);
  assert.equal(traces[0].route, "llm-fallback-keyword");
  assert.equal(traces[0].err, "unparseable");
});

test("matchSkills: strategy=keyword skips the LLM entirely", async () => {
  const { matchSkills } = await import("../src/skills/matcher.ts");
  let called = false;
  const runner = async () => {
    called = true;
    return { ok: true, text: "[]", events: [], durationMs: 0 };
  };
  const traces = [];
  const out = await matchSkills(SKILLS, "generate an image of x", 3, {
    runner,
    strategy: "keyword",
    onTrace: (route, names) => traces.push({ route, names }),
  });
  assert.equal(called, false);
  assert.equal(traces[0].route, "keyword");
  assert.ok(out.some((s) => s.name === "image-gen"));
});

test("matchSkillsByKeyword: unchanged legacy substring scoring", async () => {
  const { matchSkillsByKeyword } = await import("../src/skills/matcher.ts");
  // The very behavior we're working around: keyword matcher DOES return
  // image-gen for the discussion text. The LLM path is what fixes that;
  // this test pins the legacy fallback so we know the regression is
  // specifically the LLM layer doing its job.
  const out = matchSkillsByKeyword(SKILLS, DISCUSSION_TASK, 3);
  assert.ok(out.some((s) => s.name === "image-gen"), "legacy keyword matcher hits image-gen on discussion text");
});

test("matchSkills: no candidate skills -> empty array fast", async () => {
  const { matchSkills } = await import("../src/skills/matcher.ts");
  const out = await matchSkills([], "anything", 3, { runner: fakeRunner("[]") });
  assert.deepEqual(out, []);
});

test("matchSkills: topN caps the result", async () => {
  const { matchSkills } = await import("../src/skills/matcher.ts");
  const out = await matchSkills(
    SKILLS,
    "do everything",
    1,
    { runner: fakeRunner('["image-gen", "graphify", "pr-review"]') },
  );
  assert.equal(out.length, 1);
});

test("matchSkillsByLLM: empty skills returns [] without calling runner", async () => {
  const { matchSkillsByLLM } = await import("../src/skills/matcher.ts");
  let called = false;
  const runner = async () => { called = true; return { ok: true, text: "[]", events: [], durationMs: 0 }; };
  const out = await matchSkillsByLLM([], "anything", 3, runner);
  assert.deepEqual(out, []);
  assert.equal(called, false);
});

test("matchSkillsByLLM: runner returns ok:false -> null (signals fallback)", async () => {
  const { matchSkillsByLLM } = await import("../src/skills/matcher.ts");
  const runner = async () => ({ ok: false, text: "", events: [], error: "boom", durationMs: 0 });
  const out = await matchSkillsByLLM(SKILLS, "x", 3, runner);
  assert.equal(out, null);
});
