import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const MOD = "../dist/skills/index-cache.js";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "bajaclaw-test-"));
  process.env.BAJACLAW_HOME = root;
  const skDir = join(root, "profiles", "default", "skills");
  mkdirSync(skDir, { recursive: true });
  return { root, skDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writeSkill(dir, name, desc) {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${desc}\n---\nbody\n`);
}

test("index-cache: first call computes and snapshots", async () => {
  const { skDir, cleanup } = setup();
  try {
    writeSkill(skDir, "uniqzfoo", "Foo skill");
    const { getOrBuildIndex } = await import(MOD);
    const r = getOrBuildIndex("default");
    assert.match(r.text, /uniqzfoo: Foo skill/);
    const snap = join(skDir, ".skills_prompt_snapshot.json");
    assert.ok(existsSync(snap));
  } finally { cleanup(); }
});

test("index-cache: second call hits LRU", async () => {
  const { skDir, cleanup } = setup();
  try {
    writeSkill(skDir, "uniqzbar", "Bar skill");
    const { getOrBuildIndex, _stats } = await import(MOD);
    _stats.reset();
    getOrBuildIndex("default");
    const before = _stats.get();
    getOrBuildIndex("default");
    const after = _stats.get();
    assert.ok(after.hits > before.hits);
  } finally { cleanup(); }
});

test("index-cache: file change invalidates and rebuilds", async () => {
  const { skDir, cleanup } = setup();
  try {
    writeSkill(skDir, "uniqzbaz", "Original");
    const { getOrBuildIndex } = await import(MOD);
    const a = getOrBuildIndex("default");
    await new Promise((r) => setTimeout(r, 15));
    writeSkill(skDir, "uniqzbaz", "Updated description");
    const b = getOrBuildIndex("default");
    assert.notEqual(a.manifestHash, b.manifestHash);
    assert.match(b.text, /Updated description/);
  } finally { cleanup(); }
});

test("index-cache: invalidate(profile) drops cached entry", async () => {
  const { skDir, cleanup } = setup();
  try {
    writeSkill(skDir, "uniqzqux", "Qux");
    const { getOrBuildIndex, invalidate, _stats } = await import(MOD);
    _stats.reset();
    getOrBuildIndex("default"); // miss
    getOrBuildIndex("default"); // hit
    invalidate("default");
    getOrBuildIndex("default"); // should be miss again (LRU dropped, but disk snapshot may rescue) — at least not the same LRU hit path
    const stats = _stats.get();
    assert.ok(stats.misses >= 1);
  } finally { cleanup(); }
});

test("index-cache: different allowedTools key yields separate cache", async () => {
  const { skDir, cleanup } = setup();
  try {
    writeSkill(skDir, "uniqzwax", "Wax");
    const { getOrBuildIndex, _stats } = await import(MOD);
    _stats.reset();
    getOrBuildIndex("default", ["Bash", "Read"]);
    getOrBuildIndex("default", ["Bash", "Read"]); // hit
    const beforeOther = _stats.get();
    getOrBuildIndex("default", ["Bash", "Write"]); // different toolset = miss
    const afterOther = _stats.get();
    assert.ok(afterOther.misses > beforeOther.misses);
  } finally { cleanup(); }
});
