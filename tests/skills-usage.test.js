import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function tempProfile() {
  const root = mkdtempSync(join(tmpdir(), "bajaclaw-test-"));
  process.env.BAJACLAW_HOME = root;
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("usage: read empty sidecar returns default shape", async () => {
  const { cleanup } = tempProfile();
  try {
    const { readSidecar } = await import("../dist/skills/usage.js");
    const s = readSidecar("default");
    assert.equal(s.schema_version, 1);
    assert.deepEqual(s.skills, {});
    assert.deepEqual(s.deleted, {});
  } finally { cleanup(); }
});

test("usage: recordCreate writes new entry", async () => {
  const { cleanup } = tempProfile();
  try {
    const { recordCreate, readSidecar } = await import("../dist/skills/usage.js");
    recordCreate("default", "foo", "agent");
    const s = readSidecar("default");
    assert.ok(s.skills.foo);
    assert.equal(s.skills.foo.use_count, 1);
    assert.equal(s.skills.foo.provenance, "agent");
    assert.equal(s.skills.foo.state, "active");
    assert.equal(s.skills.foo.pinned, false);
    assert.ok(s.skills.foo.created_at);
  } finally { cleanup(); }
});

test("usage: recordView increments and reactivates stale", async () => {
  const { cleanup } = tempProfile();
  try {
    const { recordCreate, recordView, recordStateTransition, readSidecar } =
      await import("../dist/skills/usage.js");
    recordCreate("default", "foo", "agent");
    recordStateTransition("default", "foo", "stale");
    recordView("default", "foo");
    const s = readSidecar("default");
    assert.equal(s.skills.foo.view_count, 1);
    assert.equal(s.skills.foo.state, "active");
    assert.ok(s.skills.foo.last_viewed_at);
  } finally { cleanup(); }
});

test("usage: recordDelete moves to deleted block", async () => {
  const { cleanup } = tempProfile();
  try {
    const { recordCreate, recordDelete, readSidecar } =
      await import("../dist/skills/usage.js");
    recordCreate("default", "foo", "agent");
    recordCreate("default", "bar", "agent");
    recordDelete("default", "foo", "bar");
    const s = readSidecar("default");
    assert.equal(s.skills.foo, undefined);
    assert.ok(s.deleted.foo);
    assert.equal(s.deleted.foo.absorbed_into, "bar");
    assert.ok(s.deleted.foo.deleted_at);
  } finally { cleanup(); }
});

test("usage: many concurrent-style writes round-trip", async () => {
  const { cleanup } = tempProfile();
  try {
    const { recordCreate, readSidecar } = await import("../dist/skills/usage.js");
    for (let i = 0; i < 20; i++) recordCreate("default", `s${i}`, "agent");
    const s = readSidecar("default");
    assert.equal(Object.keys(s.skills).length, 20);
  } finally { cleanup(); }
});

test("usage: recordPin sets pinned flag", async () => {
  const { cleanup } = tempProfile();
  try {
    const { recordCreate, recordPin, readSidecar } =
      await import("../dist/skills/usage.js");
    recordCreate("default", "foo", "agent");
    recordPin("default", "foo", true);
    assert.equal(readSidecar("default").skills.foo.pinned, true);
    recordPin("default", "foo", false);
    assert.equal(readSidecar("default").skills.foo.pinned, false);
  } finally { cleanup(); }
});

test("usage: setProvenance updates provenance", async () => {
  const { cleanup } = tempProfile();
  try {
    const { recordCreate, setProvenance, readSidecar } =
      await import("../dist/skills/usage.js");
    recordCreate("default", "foo", "user");
    setProvenance("default", "foo", "agent");
    assert.equal(readSidecar("default").skills.foo.provenance, "agent");
  } finally { cleanup(); }
});

test("usage: recordDelete with empty absorbed_into and reason", async () => {
  const { cleanup } = tempProfile();
  try {
    const { recordCreate, recordDelete, readSidecar } =
      await import("../dist/skills/usage.js");
    recordCreate("default", "foo", "agent");
    recordDelete("default", "foo", "", "no longer needed");
    const s = readSidecar("default");
    assert.equal(s.deleted.foo.absorbed_into, "");
    assert.equal(s.deleted.foo.reason, "no longer needed");
  } finally { cleanup(); }
});
