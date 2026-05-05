import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "bajaclaw-test-"));
  process.env.BAJACLAW_HOME = root;
  const skDir = join(root, "profiles", "default", "skills");
  mkdirSync(skDir, { recursive: true });
  return { root, skDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("end-to-end: skillManage create -> skillView -> skillList -> curator merge", async () => {
  const { skDir, cleanup } = setup();
  try {
    const { skillManage } = await import("../dist/skills/skill-manage.js");
    const { skillView } = await import("../dist/skills/skill-view.js");
    const { skillList } = await import("../dist/skills/skill-list.js");
    const { runCurator } = await import("../dist/skills/curator.js");

    // Agent creates two near-duplicate skills mid-cycle.
    const c1 = skillManage(
      { action: "create", name: "fix-1080", description: "Force 1080", body: "set width=1920 height=1080" },
      "default",
    );
    assert.equal(c1.ok, true);
    const c2 = skillManage(
      { action: "create", name: "fix-1088", description: "Force multiples-of-16", body: "set width=1920 height=1088" },
      "default",
    );
    assert.equal(c2.ok, true);

    // Agent reads one back.
    const v = skillView({ name: "fix-1080" }, "default");
    assert.equal(v.ok, true);
    assert.match(v.body, /1920/);

    // List shows both.
    const list = skillList({}, "default");
    assert.ok(list.some((s) => s.name === "fix-1080"));
    assert.ok(list.some((s) => s.name === "fix-1088"));

    // Curator runs in live mode with a stubbed runner that proposes merge.
    const yaml = `proposed_actions:
  - kind: merge
    skills: [fix-1080, fix-1088]
    into: image-dimensions
    rationale: "consolidate image dimension fixes"
`;
    const r = await runCurator(
      "default",
      { enabled: true, dryRun: false, intervalHours: 168, minIdleHours: 2, maxActionsPerRun: 5 },
      async () => ({ ok: true, text: yaml }),
    );
    assert.equal(r.executed.length, 1);

    // After merge: umbrella exists, originals archived.
    assert.ok(existsSync(join(skDir, "image-dimensions", "SKILL.md")));
    assert.ok(existsSync(join(skDir, ".archive", "fix-1080", "SKILL.md")));
    assert.ok(existsSync(join(skDir, ".archive", "fix-1088", "SKILL.md")));

    // List excludes archived by default.
    const list2 = skillList({}, "default");
    assert.ok(list2.some((s) => s.name === "image-dimensions"));
    assert.ok(!list2.some((s) => s.name === "fix-1080"));

    // skillView on archived returns 410.
    const archived = skillView({ name: "fix-1080" }, "default");
    assert.equal(archived.ok, false);
  } finally { cleanup(); }
});

test("end-to-end: skill_view increments view_count, curator phase 1 reactivates stale", async () => {
  const { skDir, cleanup } = setup();
  try {
    const { skillManage } = await import("../dist/skills/skill-manage.js");
    const { skillView } = await import("../dist/skills/skill-view.js");
    const { runPhase1, _setLastUsed, _setState } = await import("../dist/skills/curator.js");
    const { readSidecar } = await import("../dist/skills/usage.js");

    skillManage({ action: "create", name: "loop-foo", description: "Foo", body: "x" }, "default");

    // Backdate so phase 1 marks stale.
    _setLastUsed("default", "loop-foo", new Date(Date.now() - 31 * 86_400_000).toISOString());
    runPhase1("default");
    assert.equal(readSidecar("default").skills["loop-foo"].state, "stale");

    // Now agent uses it (skill_view).
    skillView({ name: "loop-foo" }, "default");
    assert.equal(readSidecar("default").skills["loop-foo"].state, "active");
  } finally { cleanup(); }
});
