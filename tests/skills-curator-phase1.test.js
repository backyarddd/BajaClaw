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
  writeFileSync(join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name}\n---\nbody\n`);
}

const DAY = 86_400_000;

test("phase1: idle 31d active->stale", async () => {
  const { skDir, cleanup } = setup();
  try {
    writeSkill(skDir, "p1a");
    const { recordCreate, setProvenance, readSidecar } = await import(USAGE);
    recordCreate("default", "p1a", "agent");
    setProvenance("default", "p1a", "agent");

    const { _setLastUsed, runPhase1 } = await import(CUR);
    _setLastUsed("default", "p1a", new Date(Date.now() - 31 * DAY).toISOString());

    const r = runPhase1("default");
    assert.equal(r.transitions, 1);
    const s = readSidecar("default");
    assert.equal(s.skills.p1a.state, "stale");
  } finally { cleanup(); }
});

test("phase1: idle 91d stale->archived (file moves)", async () => {
  const { skDir, cleanup } = setup();
  try {
    writeSkill(skDir, "p1b");
    const { recordCreate, setProvenance } = await import(USAGE);
    recordCreate("default", "p1b", "agent");
    setProvenance("default", "p1b", "agent");

    const { _setLastUsed, _setState, runPhase1 } = await import(CUR);
    _setLastUsed("default", "p1b", new Date(Date.now() - 91 * DAY).toISOString());
    _setState("default", "p1b", "stale");

    const r = runPhase1("default");
    assert.ok(r.archived.includes("p1b"));
    assert.ok(existsSync(join(skDir, ".archive", "p1b", "SKILL.md")));
    assert.ok(!existsSync(join(skDir, "p1b", "SKILL.md")));
  } finally { cleanup(); }
});

test("phase1: pinned skill immune", async () => {
  const { skDir, cleanup } = setup();
  try {
    writeSkill(skDir, "p1c");
    const { recordCreate, recordPin, setProvenance, readSidecar } = await import(USAGE);
    recordCreate("default", "p1c", "agent");
    setProvenance("default", "p1c", "agent");
    recordPin("default", "p1c", true);

    const { _setLastUsed, runPhase1 } = await import(CUR);
    _setLastUsed("default", "p1c", new Date(Date.now() - 200 * DAY).toISOString());

    runPhase1("default");
    assert.equal(readSidecar("default").skills.p1c.state, "active");
  } finally { cleanup(); }
});

test("phase1: stale->active on recent activity", async () => {
  const { skDir, cleanup } = setup();
  try {
    writeSkill(skDir, "p1d");
    const { recordCreate, recordView, setProvenance, readSidecar } = await import(USAGE);
    recordCreate("default", "p1d", "agent");
    setProvenance("default", "p1d", "agent");

    const { _setState, runPhase1 } = await import(CUR);
    _setState("default", "p1d", "stale");
    recordView("default", "p1d");

    runPhase1("default");
    assert.equal(readSidecar("default").skills.p1d.state, "active");
  } finally { cleanup(); }
});

test("phase1: provenance=user is immune", async () => {
  const { skDir, cleanup } = setup();
  try {
    writeSkill(skDir, "p1e");
    const { recordCreate, setProvenance, readSidecar } = await import(USAGE);
    recordCreate("default", "p1e", "user");
    setProvenance("default", "p1e", "user");

    const { _setLastUsed, runPhase1 } = await import(CUR);
    _setLastUsed("default", "p1e", new Date(Date.now() - 200 * DAY).toISOString());

    runPhase1("default");
    assert.equal(readSidecar("default").skills.p1e.state, "active");
  } finally { cleanup(); }
});

test("curator-state: read/write round-trips", async () => {
  const { cleanup } = setup();
  try {
    const { readCuratorState, writeCuratorState } = await import(CUR);
    const initial = readCuratorState("default");
    assert.equal(initial.last_curator_at, null);
    writeCuratorState("default", {
      last_curator_at: "2026-05-05T00:00:00.000Z",
      first_run_marker_at: "2026-05-04T00:00:00.000Z",
      dry_run_count: 1,
    });
    const reread = readCuratorState("default");
    assert.equal(reread.last_curator_at, "2026-05-05T00:00:00.000Z");
    assert.equal(reread.dry_run_count, 1);
  } finally { cleanup(); }
});
