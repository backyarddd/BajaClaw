#!/usr/bin/env node
// Cross-version test runner. Node 22+ expands "tests/**/*.test.js"
// natively in --test; Node 20 does not and fails with "Could not
// find" because it treats the pattern as a literal filename. This
// script enumerates the actual test files and invokes node --test
// with explicit paths, which works on every supported Node.
import { readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const testsDir = join(root, "tests");
const files = readdirSync(testsDir)
  .filter((f) => f.endsWith(".test.js"))
  .map((f) => join(testsDir, f))
  .sort();

if (files.length === 0) {
  console.error("no test files found in", testsDir);
  process.exit(1);
}

const proc = spawn(process.execPath, ["--test", ...files], { stdio: "inherit" });
proc.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
