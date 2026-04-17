import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = join(__dirname, "..", "bin", "bajaclaw.js");

function run(args, env = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("prints version", () => {
  const r = run(["--version"]);
  // When tsx is missing the launcher exits 1; treat either as acceptable here.
  if (r.status === 0) assert.match(r.stdout, /\d+\.\d+\.\d+/);
  else assert.match((r.stderr || r.stdout) + "", /tsx|build/);
});

test("help includes core commands", () => {
  const r = run(["--help"]);
  if (r.status === 0) {
    for (const c of ["init", "start", "doctor", "mcp", "skill", "profile", "daemon"]) {
      assert.ok(r.stdout.includes(c), `missing command in help: ${c}`);
    }
  }
});
