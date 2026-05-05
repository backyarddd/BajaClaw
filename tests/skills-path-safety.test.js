import { test } from "node:test";
import assert from "node:assert/strict";

const MOD = "../dist/skills/path-safety.js";

test("validateSkillSubpath: allows references/foo.md", async () => {
  const { validateSkillSubpath } = await import(MOD);
  const r = validateSkillSubpath("/tmp/skills/foo", "references/foo.md");
  assert.equal(r.ok, true);
  assert.equal(r.absolute, "/tmp/skills/foo/references/foo.md");
});

test("validateSkillSubpath: rejects parent escape", async () => {
  const { validateSkillSubpath } = await import(MOD);
  const r = validateSkillSubpath("/tmp/skills/foo", "../bar/x.md");
  assert.equal(r.ok, false);
});

test("validateSkillSubpath: rejects absolute path", async () => {
  const { validateSkillSubpath } = await import(MOD);
  const r = validateSkillSubpath("/tmp/skills/foo", "/etc/passwd");
  assert.equal(r.ok, false);
});

test("validateSkillSubpath: rejects unknown subdir", async () => {
  const { validateSkillSubpath } = await import(MOD);
  const r = validateSkillSubpath("/tmp/skills/foo", "evil/x.md");
  assert.equal(r.ok, false);
});

test("validateSkillSubpath: rejects bare file at root", async () => {
  const { validateSkillSubpath } = await import(MOD);
  const r = validateSkillSubpath("/tmp/skills/foo", "x.md");
  assert.equal(r.ok, false);
});

test("validateSkillSubpath: allows scripts/run.sh", async () => {
  const { validateSkillSubpath } = await import(MOD);
  const r = validateSkillSubpath("/tmp/skills/foo", "scripts/run.sh");
  assert.equal(r.ok, true);
});

test("validateSkillSubpath: allows nested templates/sub/x.md", async () => {
  const { validateSkillSubpath } = await import(MOD);
  const r = validateSkillSubpath("/tmp/skills/foo", "templates/sub/x.md");
  assert.equal(r.ok, true);
});

test("validateSkillSubpath: rejects null byte", async () => {
  const { validateSkillSubpath } = await import(MOD);
  const r = validateSkillSubpath("/tmp/skills/foo", "references/foo\0.md");
  assert.equal(r.ok, false);
});

test("validateSkillSubpath: rejects empty", async () => {
  const { validateSkillSubpath } = await import(MOD);
  const r = validateSkillSubpath("/tmp/skills/foo", "");
  assert.equal(r.ok, false);
});

test("validateSkillSubpath: rejects parent escape via subdir prefix", async () => {
  const { validateSkillSubpath } = await import(MOD);
  const r = validateSkillSubpath("/tmp/skills/foo", "references/../../bar.md");
  assert.equal(r.ok, false);
});
