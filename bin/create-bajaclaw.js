#!/usr/bin/env node
// npx create-bajaclaw <name> — scaffolds a new agent profile.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const launcher = join(__dirname, "bajaclaw.js");
const args = ["init", ...process.argv.slice(2)];
const r = spawnSync(process.execPath, [launcher, ...args], { stdio: "inherit" });
process.exit(r.status ?? 1);
