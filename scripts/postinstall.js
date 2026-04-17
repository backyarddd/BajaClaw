#!/usr/bin/env node
// npm postinstall — runs `bajaclaw setup` only on a global install.
// Local dev installs (npm install inside the repo) are a no-op.
//
// Silent on missing claude CLI, missing permissions, or any other soft
// failure — the install should not fail because setup didn't succeed.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Skip if this isn't a global install. npm sets npm_config_global=true during
// `npm install -g`. For other installs, exit quietly.
if (process.env.npm_config_global !== "true") process.exit(0);

// Skip inside CI. Most CI envs set CI=true — we don't want to touch a home
// directory we don't own.
if (process.env.CI && process.env.BAJACLAW_SETUP_IN_CI !== "1") process.exit(0);

const launcher = join(__dirname, "..", "bin", "bajaclaw.js");
if (!existsSync(launcher)) process.exit(0);

try {
  spawnSync(process.execPath, [launcher, "setup"], {
    stdio: "inherit",
    env: { ...process.env, BAJACLAW_NO_UPDATE_NOTICE: "1" },
  });
} catch {
  // Never fail the install on a setup hiccup.
}
process.exit(0);
