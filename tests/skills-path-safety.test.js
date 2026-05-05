import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

const MOD = "../dist/skills/path-safety.js";
// Build platform-agnostic absolute paths so Windows CI passes too.
const SKILL_DIR = join(tmpdir(), "bajaclaw-skill-x");

test("validateSkillSubpath: allows references/foo.md", async () => {
  const { validateSkillSubpath } = await import(MOD);
  const r = validateSkillSubpath(SKILL_DIR, "references/foo.md");
  assert.equal(r.ok, true);
  assert.equal(r.absolute, join(SKILL_DIR, "references", "foo.md"));
});

test("validateSkillSubpath: rejects parent escape", async () => {
  const { validateSkillSubpath } = await import(MOD);
  const r = validateSkillSubpath(SKILL_DIR, "../bar/x.md");
  assert.equal(r.ok, false);
});

test("validateSkillSubpath: rejects absolute path", async () => {
  const { validateSkillSubpath } = await import(MOD);
  const r = validateSkillSubpath(SKILL_DIR, "/etc/passwd");
  assert.equal(r.ok, false);
});

test("validateSkillSubpath: rejects unknown subdir", async () => {
  const { validateSkillSubpath } = await import(MOD);
  const r = validateSkillSubpath(SKILL_DIR, "evil/x.md");
  assert.equal(r.ok, false);
});

test("validateSkillSubpath: rejects bare file at root", async () => {
  const { validateSkillSubpath } = await import(MOD);
  const r = validateSkillSubpath(SKILL_DIR, "x.md");
  assert.equal(r.ok, false);
});

test("validateSkillSubpath: allows scripts/run.sh", async () => {
  const { validateSkillSubpath } = await import(MOD);
  const r = validateSkillSubpath(SKILL_DIR, "scripts/run.sh");
  assert.equal(r.ok, true);
});

test("validateSkillSubpath: allows nested templates/sub/x.md", async () => {
  const { validateSkillSubpath } = await import(MOD);
  const r = validateSkillSubpath(SKILL_DIR, "templates/sub/x.md");
  assert.equal(r.ok, true);
});

test("validateSkillSubpath: rejects null byte", async () => {
  const { validateSkillSubpath } = await import(MOD);
  const r = validateSkillSubpath(SKILL_DIR, "references/foo\0.md");
  assert.equal(r.ok, false);
});

test("validateSkillSubpath: rejects empty", async () => {
  const { validateSkillSubpath } = await import(MOD);
  const r = validateSkillSubpath(SKILL_DIR, "");
  assert.equal(r.ok, false);
});

test("validateSkillSubpath: rejects parent escape via subdir prefix", async () => {
  const { validateSkillSubpath } = await import(MOD);
  const r = validateSkillSubpath(SKILL_DIR, "references/../../bar.md");
  assert.equal(r.ok, false);
});
