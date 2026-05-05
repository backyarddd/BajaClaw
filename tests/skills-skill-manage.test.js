import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const MOD = "../dist/skills/skill-manage.js";
const USAGE = "../dist/skills/usage.js";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "bajaclaw-test-"));
  process.env.BAJACLAW_HOME = root;
  const skDir = join(root, "profiles", "default", "skills");
  mkdirSync(skDir, { recursive: true });
  return { root, skDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("skillManage create: writes SKILL.md and sidecar entry", async () => {
  const { skDir, cleanup } = setup();
  try {
    const { skillManage } = await import(MOD);
    const r = skillManage({ action: "create", name: "fix-foo", description: "Fix the foo", body: "## Procedure\n1. Run foo" }, "default");
    assert.equal(r.ok, true);
    assert.ok(existsSync(join(skDir, "fix-foo", "SKILL.md")));
    const raw = readFileSync(join(skDir, "fix-foo", "SKILL.md"), "utf8");
    assert.match(raw, /name: fix-foo/);
    assert.match(raw, /## Procedure/);
    assert.match(raw, /auto_generated: true/);
    const { readSidecar } = await import(USAGE);
    const s = readSidecar("default");
    assert.equal(s.skills["fix-foo"].provenance, "agent");
    assert.equal(s.skills["fix-foo"].use_count, 1);
  } finally { cleanup(); }
});

test("skillManage create: rejects duplicate name", async () => {
  const { cleanup } = setup();
  try {
    const { skillManage } = await import(MOD);
    skillManage({ action: "create", name: "dupx", description: "x", body: "x" }, "default");
    const r2 = skillManage({ action: "create", name: "dupx", description: "x", body: "x" }, "default");
    assert.equal(r2.ok, false);
    assert.match(r2.reason, /exists/);
  } finally { cleanup(); }
});

test("skillManage edit: replaces body", async () => {
  const { skDir, cleanup } = setup();
  try {
    const { skillManage } = await import(MOD);
    skillManage({ action: "create", name: "edx", description: "x", body: "old body" }, "default");
    const r = skillManage({ action: "edit", name: "edx", body: "new body" }, "default");
    assert.equal(r.ok, true);
    const raw = readFileSync(join(skDir, "edx", "SKILL.md"), "utf8");
    assert.match(raw, /new body/);
    assert.doesNotMatch(raw, /old body/);
  } finally { cleanup(); }
});

test("skillManage patch: fuzzy replace", async () => {
  const { skDir, cleanup } = setup();
  try {
    const { skillManage } = await import(MOD);
    skillManage({ action: "create", name: "ptx", description: "x", body: "step1\nrun foo\nstep3" }, "default");
    const r = skillManage({ action: "patch", name: "ptx", find: "run foo", replace: "run bar" }, "default");
    assert.equal(r.ok, true);
    const raw = readFileSync(join(skDir, "ptx", "SKILL.md"), "utf8");
    assert.match(raw, /run bar/);
  } finally { cleanup(); }
});

test("skillManage delete: archives and requires absorbed_into", async () => {
  const { skDir, cleanup } = setup();
  try {
    const { skillManage } = await import(MOD);
    skillManage({ action: "create", name: "delx", description: "x", body: "x" }, "default");
    skillManage({ action: "create", name: "dely", description: "y", body: "y" }, "default");

    const r1 = skillManage({ action: "delete", name: "delx" }, "default");
    assert.equal(r1.ok, false);

    const r2 = skillManage({ action: "delete", name: "delx", absorbed_into: "dely" }, "default");
    assert.equal(r2.ok, true);
    assert.ok(!existsSync(join(skDir, "delx", "SKILL.md")));
    assert.ok(existsSync(join(skDir, ".archive", "delx", "SKILL.md")));
  } finally { cleanup(); }
});

test("skillManage delete prune: empty absorbed_into requires reason", async () => {
  const { cleanup } = setup();
  try {
    const { skillManage } = await import(MOD);
    skillManage({ action: "create", name: "prx", description: "x", body: "x" }, "default");
    const r1 = skillManage({ action: "delete", name: "prx", absorbed_into: "" }, "default");
    assert.equal(r1.ok, false);
    const r2 = skillManage({ action: "delete", name: "prx", absorbed_into: "", reason: "empty noop skill" }, "default");
    assert.equal(r2.ok, true);
  } finally { cleanup(); }
});

test("skillManage write_file: only allowed subdirs", async () => {
  const { skDir, cleanup } = setup();
  try {
    const { skillManage } = await import(MOD);
    skillManage({ action: "create", name: "wfx", description: "x", body: "x" }, "default");
    const ok = skillManage({ action: "write_file", name: "wfx", path: "references/notes.md", content: "hello" }, "default");
    assert.equal(ok.ok, true);
    assert.ok(existsSync(join(skDir, "wfx", "references", "notes.md")));
    const bad = skillManage({ action: "write_file", name: "wfx", path: "../escape.md", content: "x" }, "default");
    assert.equal(bad.ok, false);
  } finally { cleanup(); }
});

test("skillManage: pinned skill rejects all mutations", async () => {
  const { cleanup } = setup();
  try {
    const { skillManage } = await import(MOD);
    const { recordPin } = await import(USAGE);
    skillManage({ action: "create", name: "pnx", description: "x", body: "x" }, "default");
    recordPin("default", "pnx", true);
    const r = skillManage({ action: "edit", name: "pnx", body: "y" }, "default");
    assert.equal(r.ok, false);
    assert.match(r.reason, /pinned/i);
  } finally { cleanup(); }
});

test("skillManage: invalid name rejects", async () => {
  const { cleanup } = setup();
  try {
    const { skillManage } = await import(MOD);
    const r = skillManage({ action: "create", name: "Bad Name!", description: "x", body: "x" }, "default");
    assert.equal(r.ok, false);
  } finally { cleanup(); }
});

test("skillManage remove_file: deletes file under allowed subdir", async () => {
  const { skDir, cleanup } = setup();
  try {
    const { skillManage } = await import(MOD);
    skillManage({ action: "create", name: "rfx", description: "x", body: "x" }, "default");
    skillManage({ action: "write_file", name: "rfx", path: "references/a.md", content: "x" }, "default");
    const r = skillManage({ action: "remove_file", name: "rfx", path: "references/a.md" }, "default");
    assert.equal(r.ok, true);
    assert.ok(!existsSync(join(skDir, "rfx", "references", "a.md")));
  } finally { cleanup(); }
});
