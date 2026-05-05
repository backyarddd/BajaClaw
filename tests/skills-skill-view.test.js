import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "bajaclaw-test-"));
  process.env.BAJACLAW_HOME = root;
  const skDir = join(root, "profiles", "default", "skills");
  mkdirSync(skDir, { recursive: true });
  return { root, skDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writeSkill(dir, name, body = "## Body\nstuff") {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} skill\n---\n${body}\n`);
}

test("skillView: returns body and frontmatter", async () => {
  const { skDir, cleanup } = setup();
  try {
    writeSkill(skDir, "uniqviewfoo", "## Quick reference\nrun foo");
    const { skillView } = await import("../dist/skills/skill-view.js");
    const r = skillView({ name: "uniqviewfoo" }, "default");
    assert.equal(r.ok, true);
    assert.match(r.body, /run foo/);
    assert.equal(r.frontmatter.name, "uniqviewfoo");
  } finally { cleanup(); }
});

test("skillView: 404 on missing", async () => {
  const { cleanup } = setup();
  try {
    const { skillView } = await import("../dist/skills/skill-view.js");
    const r = skillView({ name: "nope-zzzz-uniq" }, "default");
    assert.equal(r.ok, false);
    assert.equal(r.status, 404);
  } finally { cleanup(); }
});

test("skillView: increments view_count", async () => {
  const { skDir, cleanup } = setup();
  try {
    writeSkill(skDir, "uniqviewct");
    const { skillView } = await import("../dist/skills/skill-view.js");
    const { readSidecar } = await import("../dist/skills/usage.js");
    skillView({ name: "uniqviewct" }, "default");
    skillView({ name: "uniqviewct" }, "default");
    const s = readSidecar("default");
    assert.equal(s.skills.uniqviewct.view_count, 2);
  } finally { cleanup(); }
});

test("skillView: 410 for archived skill", async () => {
  const { skDir, cleanup } = setup();
  try {
    writeSkill(skDir, "uniqarchv");
    const { skillView } = await import("../dist/skills/skill-view.js");
    const { recordCreate, recordStateTransition } = await import("../dist/skills/usage.js");
    recordCreate("default", "uniqarchv", "agent");
    recordStateTransition("default", "uniqarchv", "archived");
    // Also remove from disk so loadAllSkills doesn't pick it up.
    rmSync(join(skDir, "uniqarchv"), { recursive: true, force: true });
    const r = skillView({ name: "uniqarchv" }, "default");
    assert.equal(r.ok, false);
    assert.equal(r.status, 410);
  } finally { cleanup(); }
});

test("skillList: returns items with usage stats", async () => {
  const { skDir, cleanup } = setup();
  try {
    writeSkill(skDir, "uniqlsa");
    writeSkill(skDir, "uniqlsb");
    const { skillView } = await import("../dist/skills/skill-view.js");
    const { skillList } = await import("../dist/skills/skill-list.js");
    skillView({ name: "uniqlsa" }, "default");
    const list = skillList({}, "default");
    const a = list.find((s) => s.name === "uniqlsa");
    const b = list.find((s) => s.name === "uniqlsb");
    assert.ok(a);
    assert.equal(a.view_count, 1);
    assert.ok(b);
    assert.equal(b.view_count, 0);
  } finally { cleanup(); }
});

test("skillList: filters by state", async () => {
  const { skDir, cleanup } = setup();
  try {
    writeSkill(skDir, "uniqlsc");
    const { skillList } = await import("../dist/skills/skill-list.js");
    const { recordCreate, recordStateTransition } = await import("../dist/skills/usage.js");
    recordCreate("default", "uniqlsc", "agent");
    recordStateTransition("default", "uniqlsc", "stale");
    const stale = skillList({ state: "stale" }, "default");
    assert.ok(stale.some((s) => s.name === "uniqlsc"));
    const active = skillList({ state: "active" }, "default");
    assert.ok(!active.some((s) => s.name === "uniqlsc"));
  } finally { cleanup(); }
});
