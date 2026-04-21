import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

let GIT_AVAILABLE;
try { execSync("git --version", { stdio: "ignore" }); GIT_AVAILABLE = true; }
catch { GIT_AVAILABLE = false; }

test("snapshot + rewind round trip via shadow git", { skip: !GIT_AVAILABLE }, async () => {
  const home = mkdtempSync(join(tmpdir(), "bajaclaw-snap-"));
  const root = mkdtempSync(join(tmpdir(), "bajaclaw-snap-root-"));
  process.env.BAJACLAW_HOME = home;
  try {
    const { snapshot, rewindToSha } = await import("../dist/snapshots.js");

    // Initial state: file with content "v1".
    const file = join(root, "hello.txt");
    writeFileSync(file, "v1");
    const pre = await snapshot("test", root, "pre-cycle-1");
    assert.equal(pre.ok, true, `snapshot failed: ${pre.error}`);
    assert.ok(pre.sha && pre.sha.length === 40);

    // Mutate the file post-snapshot.
    writeFileSync(file, "v2-post");
    assert.equal(readFileSync(file, "utf8"), "v2-post");

    // Rewind back to the pre-snapshot.
    const restore = await rewindToSha("test", root, pre.sha);
    assert.equal(restore.ok, true, `rewind failed: ${restore.error}`);
    assert.equal(readFileSync(file, "utf8"), "v1", "file content not restored");
  } finally {
    delete process.env.BAJACLAW_HOME;
    rmSync(home, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("snapshot returns ok:false when root does not exist", async () => {
  const home = mkdtempSync(join(tmpdir(), "bajaclaw-snap-"));
  process.env.BAJACLAW_HOME = home;
  try {
    const { snapshot } = await import("../dist/snapshots.js");
    const r = await snapshot("test", "/tmp/definitely-missing-snapshot-root-xyz", "pre");
    assert.equal(r.ok, false);
  } finally {
    delete process.env.BAJACLAW_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});

test("listSnapshots returns empty array on a virgin profile", async () => {
  const home = mkdtempSync(join(tmpdir(), "bajaclaw-snap-"));
  process.env.BAJACLAW_HOME = home;
  try {
    const { listSnapshots } = await import("../dist/snapshots.js");
    const r = await listSnapshots("test-virgin", "/tmp");
    assert.deepEqual(r, []);
  } finally {
    delete process.env.BAJACLAW_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});
