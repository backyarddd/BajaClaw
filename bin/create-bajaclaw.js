#!/usr/bin/env node
// npx create-bajaclaw [name] — bootstrap BajaClaw.
// With no args: runs `bajaclaw setup` to create the default profile.
// With a name: runs `bajaclaw init <name>` to scaffold that specific profile.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const launcher = join(__dirname, "bajaclaw.js");

const userArgs = process.argv.slice(2);
const firstIsFlag = userArgs[0]?.startsWith("-");
const cmd = !userArgs[0] || firstIsFlag ? ["setup", ...userArgs] : ["init", ...userArgs];

const r = spawnSync(process.execPath, [launcher, ...cmd], { stdio: "inherit" });
process.exit(r.status ?? 1);
