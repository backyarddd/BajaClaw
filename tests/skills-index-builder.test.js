import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const MOD = "../dist/skills/index-builder.js";

function tempProfile() {
  const root = mkdtempSync(join(tmpdir(), "bajaclaw-test-"));
  process.env.BAJACLAW_HOME = root;
  const profSkills = join(root, "profiles", "default", "skills");
  mkdirSync(profSkills, { recursive: true });
  return { root, profSkills, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writeSkill(dir, name, frontmatter, body = "x") {
  const sk = join(dir, name);
  mkdirSync(sk, { recursive: true });
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("\n");
  writeFileSync(join(sk, "SKILL.md"), `---\n${fm}\n---\n${body}\n`);
}

test("buildSkillsIndex: rendered text wraps in <available_skills>", async () => {
  const { profSkills, cleanup } = tempProfile();
  try {
    writeSkill(profSkills, "agent-foo", { name: "agent-foo", description: "Agent foo" });
    const { buildSkillsIndex } = await import(MOD);
    const r = buildSkillsIndex("default");
    assert.match(r.text, /<available_skills>/);
    assert.match(r.text, /<\/available_skills>/);
    assert.match(r.text, /skill_view\(name\)/);
    assert.match(r.text, /skill_manage/);
  } finally { cleanup(); }
});

test("buildSkillsIndex: includes per-profile skill", async () => {
  const { profSkills, cleanup } = tempProfile();
  try {
    writeSkill(profSkills, "uniqfoo123", { name: "uniqfoo123", description: "Unique foo" });
    const { buildSkillsIndex } = await import(MOD);
    const r = buildSkillsIndex("default");
    assert.match(r.text, /uniqfoo123: Unique foo/);
    assert.ok(r.skills.some((s) => s.name === "uniqfoo123"));
  } finally { cleanup(); }
});

test("buildSkillsIndex: groups setup-* under Setup category", async () => {
  const { profSkills, cleanup } = tempProfile();
  try {
    writeSkill(profSkills, "setup-zztest1", { name: "setup-zztest1", description: "Setup test" });
    writeSkill(profSkills, "zztest-general", { name: "zztest-general", description: "General test" });
    const { buildSkillsIndex } = await import(MOD);
    const r = buildSkillsIndex("default");
    const item1 = r.skills.find((s) => s.name === "setup-zztest1");
    const item2 = r.skills.find((s) => s.name === "zztest-general");
    assert.equal(item1?.category, "Setup");
    assert.equal(item2?.category, "General");
  } finally { cleanup(); }
});

test("buildSkillsIndex: truncates description at 120 chars", async () => {
  const { profSkills, cleanup } = tempProfile();
  try {
    const long = "x".repeat(200);
    writeSkill(profSkills, "uniqlongdesc", { name: "uniqlongdesc", description: long });
    const { buildSkillsIndex } = await import(MOD);
    const r = buildSkillsIndex("default");
    const item = r.skills.find((s) => s.name === "uniqlongdesc");
    assert.ok(item);
    // Find the rendered line
    const lineMatch = r.text.match(/- uniqlongdesc: (.+)/);
    assert.ok(lineMatch);
    assert.ok(lineMatch[1].length <= 120, `line too long: ${lineMatch[1].length}`);
  } finally { cleanup(); }
});

test("buildSkillsIndex: manifestHash stable across calls", async () => {
  const { profSkills, cleanup } = tempProfile();
  try {
    writeSkill(profSkills, "uniqstable", { name: "uniqstable", description: "x" });
    const { buildSkillsIndex } = await import(MOD);
    const a = buildSkillsIndex("default");
    const b = buildSkillsIndex("default");
    assert.equal(a.manifestHash, b.manifestHash);
  } finally { cleanup(); }
});

test("buildSkillsIndex: archived skills hidden", async () => {
  const { profSkills, cleanup } = tempProfile();
  try {
    writeSkill(profSkills, "uniqarchived", { name: "uniqarchived", description: "Archived skill" });
    const { recordCreate, recordStateTransition } = await import("../dist/skills/usage.js");
    recordCreate("default", "uniqarchived", "agent");
    recordStateTransition("default", "uniqarchived", "archived");
    const { buildSkillsIndex } = await import(MOD);
    const r = buildSkillsIndex("default");
    assert.ok(!r.skills.some((s) => s.name === "uniqarchived"));
  } finally { cleanup(); }
});

test("buildSkillsIndex: auto_generated tagged Auto-generated", async () => {
  const { profSkills, cleanup } = tempProfile();
  try {
    writeSkill(profSkills, "uniqauto", { name: "uniqauto", description: "Auto", auto_generated: true });
    const { buildSkillsIndex } = await import(MOD);
    const r = buildSkillsIndex("default");
    const item = r.skills.find((s) => s.name === "uniqauto");
    assert.equal(item?.category, "Auto-generated");
  } finally { cleanup(); }
});
