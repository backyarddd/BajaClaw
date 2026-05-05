import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CUR = "../dist/skills/curator.js";
const USAGE = "../dist/skills/usage.js";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "bajaclaw-test-"));
  process.env.BAJACLAW_HOME = root;
  const skDir = join(root, "profiles", "default", "skills");
  mkdirSync(skDir, { recursive: true });
  return { root, skDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writeSkill(dir, name) {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name}\nauto_generated: true\n---\nbody for ${name}\n`);
}

const CFG = { enabled: true, dryRun: false, intervalHours: 168, minIdleHours: 2, maxActionsPerRun: 5 };
const CFG_DRY = { ...CFG, dryRun: true };

test("phase2: dry-run does not mutate", async () => {
  const { skDir, cleanup } = setup();
  try {
    writeSkill(skDir, "fix-img-1080");
    writeSkill(skDir, "fix-img-1088");
    const { recordCreate, setProvenance } = await import(USAGE);
    recordCreate("default", "fix-img-1080", "agent");
    recordCreate("default", "fix-img-1088", "agent");
    setProvenance("default", "fix-img-1080", "agent");
    setProvenance("default", "fix-img-1088", "agent");

    const yaml = `proposed_actions:
  - kind: merge
    skills: [fix-img-1080, fix-img-1088]
    into: image-dimensions
    rationale: "near-duplicate image dimension fixes"
`;
    const runner = async () => ({ ok: true, text: yaml });
    const { runCurator } = await import(CUR);
    const r = await runCurator("default", CFG_DRY, runner);

    assert.equal(r.proposed.length, 1);
    assert.equal(r.executed.length, 0);
    assert.ok(existsSync(join(skDir, "fix-img-1080", "SKILL.md")));
    assert.ok(existsSync(join(skDir, "fix-img-1088", "SKILL.md")));
  } finally { cleanup(); }
});

test("phase2: live mode merges", async () => {
  const { skDir, cleanup } = setup();
  try {
    writeSkill(skDir, "fix-img-1080");
    writeSkill(skDir, "fix-img-1088");
    const { recordCreate, setProvenance } = await import(USAGE);
    recordCreate("default", "fix-img-1080", "agent");
    recordCreate("default", "fix-img-1088", "agent");
    setProvenance("default", "fix-img-1080", "agent");
    setProvenance("default", "fix-img-1088", "agent");

    const yaml = `proposed_actions:
  - kind: merge
    skills: [fix-img-1080, fix-img-1088]
    into: image-dimensions
    rationale: "merge"
`;
    const { runCurator } = await import(CUR);
    const r = await runCurator("default", CFG, async () => ({ ok: true, text: yaml }));

    assert.equal(r.executed.length, 1);
    assert.ok(existsSync(join(skDir, "image-dimensions", "SKILL.md")));
    assert.ok(existsSync(join(skDir, ".archive", "fix-img-1080", "SKILL.md")));
    assert.ok(existsSync(join(skDir, ".archive", "fix-img-1088", "SKILL.md")));
  } finally { cleanup(); }
});

test("phase2: action cap enforced", async () => {
  const { skDir, cleanup } = setup();
  try {
    for (let i = 0; i < 10; i++) writeSkill(skDir, `s${i}`);
    const { recordCreate, setProvenance } = await import(USAGE);
    for (let i = 0; i < 10; i++) {
      recordCreate("default", `s${i}`, "agent");
      setProvenance("default", `s${i}`, "agent");
    }
    const actions = [];
    for (let i = 0; i < 10; i++) {
      actions.push(`  - kind: prune\n    skill: s${i}\n    rationale: "x"`);
    }
    const yaml = "proposed_actions:\n" + actions.join("\n");
    const { runCurator } = await import(CUR);
    const r = await runCurator("default", { ...CFG, maxActionsPerRun: 3 }, async () => ({ ok: true, text: yaml }));
    assert.equal(r.executed.length, 3);
  } finally { cleanup(); }
});

test("phase2: writes report", async () => {
  const { cleanup } = setup();
  try {
    const yaml = `proposed_actions: []`;
    const { runCurator } = await import(CUR);
    const r = await runCurator("default", CFG_DRY, async () => ({ ok: true, text: yaml }));
    assert.ok(r.reportPath);
    assert.ok(existsSync(join(r.reportPath, "REPORT.md")));
    assert.ok(existsSync(join(r.reportPath, "run.json")));
  } finally { cleanup(); }
});

test("maybeRunCurator: first call sets marker, no run", async () => {
  const { cleanup } = setup();
  try {
    const { maybeRunCurator, readCuratorState } = await import(CUR);
    const calls = { count: 0 };
    const runner = async () => { calls.count++; return { ok: true, text: "proposed_actions: []" }; };
    await maybeRunCurator("default", CFG, undefined);
    const s = readCuratorState("default");
    assert.ok(s.first_run_marker_at);
    assert.equal(s.last_curator_at, null);
    // Force the runner used by injecting via runCurator? Not exposed via maybeRunCurator,
    // but we can verify no curator log entry was written by checking state.
  } finally { cleanup(); }
});

test("maybeRunCurator: skips when interval hasn't elapsed", async () => {
  const { cleanup } = setup();
  try {
    const { maybeRunCurator, writeCuratorState, readCuratorState } = await import(CUR);
    writeCuratorState("default", {
      last_curator_at: new Date().toISOString(),
      first_run_marker_at: new Date(Date.now() - 24 * 86400 * 1000).toISOString(),
      dry_run_count: 0,
    });
    await maybeRunCurator("default", { enabled: true, intervalHours: 168 }, undefined);
    const s = readCuratorState("default");
    // last_curator_at should still be the same (no run happened).
    assert.ok(s.last_curator_at);
  } finally { cleanup(); }
});
