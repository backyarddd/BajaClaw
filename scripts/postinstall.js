#!/usr/bin/env node
// npm postinstall - global-install scaffold + install-status notice.
//
// npm v7+ captures postinstall stdout by default (`foreground-scripts: false`),
// so the full welcome screen runs on the FIRST `bajaclaw` invocation
// instead (see src/cli.ts first-run hook). This script stays quick and
// quiet: scaffold the default profile in silent mode, verify critical
// native deps, and emit a single-line notice to stderr (usually visible).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const require = createRequire(import.meta.url);

// --- Gate: global installs only ---------------------------------------
// Support both classic `npm_config_global` and the newer
// `npm_config_location` env var to handle any npm version.
const isGlobal =
  process.env.npm_config_global === "true" ||
  process.env.npm_config_global === "1" ||
  process.env.npm_config_location === "global";
if (!isGlobal) process.exit(0);

// CI: skip unless explicitly opted in (don't touch $HOME we don't own).
if (process.env.CI && process.env.BAJACLAW_SETUP_IN_CI !== "1") process.exit(0);

// Running as root via sudo without a SUDO_USER fallback - profile
// scaffolding would create a root-owned ~/.bajaclaw. Skip and let the
// real user run `bajaclaw setup` themselves.
const uid = typeof process.getuid === "function" ? process.getuid() : 1;
if (uid === 0 && !process.env.SUDO_USER) {
  process.stderr.write("\n\x1b[33m!\x1b[0m BajaClaw installed, but profile scaffold skipped (running as root).\n  Run `\x1b[1mbajaclaw setup\x1b[0m` as your normal user to finish.\n\n");
  process.exit(0);
}

// --- Version + dep health ---------------------------------------------
let version = "?";
try {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  version = String(pkg.version ?? "?");
} catch { /* silent */ }

// better-sqlite3 has a native binding. If it fails to load on the user's
// platform, `bajaclaw` will crash on the first cycle. Warn early.
let sqliteOK = false;
let sqliteErr = "";
try {
  require("better-sqlite3");
  sqliteOK = true;
} catch (e) {
  sqliteErr = (e && e.message) ? String(e.message).split("\n")[0] : "unknown";
}

// Check whether the `claude` CLI backend is on PATH. Not a blocker -
// bajaclaw works without it in dry-run mode - but worth flagging.
const claudeCheck = spawnSync(process.platform === "win32" ? "where.exe" : "which", ["claude"], { encoding: "utf8" });
const claudeOK = claudeCheck.status === 0 && claudeCheck.stdout.trim().length > 0;

// --- Silent profile scaffold ------------------------------------------
const launcher = join(root, "bin", "bajaclaw.js");
if (existsSync(launcher) && sqliteOK) {
  try {
    spawnSync(process.execPath, [launcher, "setup", "--silent", "--non-interactive"], {
      stdio: "ignore",
      env: { ...process.env, BAJACLAW_NO_UPDATE_NOTICE: "1" },
      timeout: 30_000,
    });
  } catch { /* never fail the install */ }
}

// --- One-line stderr notice -------------------------------------------
// npm captures stdout of postinstall scripts by default (unless
// --foreground-scripts is set), but stderr is usually still visible in
// interactive installs. Keep the notice terse.
const isTTY = !!process.stderr.isTTY;
const c = (code) => (s) => isTTY ? `\x1b[${code}m${s}\x1b[0m` : s;
const green = c(32), yellow = c(33), red = c(31), bold = c(1), dim = c(90);

const lines = [];
lines.push("");
lines.push(green("✓") + ` BajaClaw v${version} installed. Run ` + bold("bajaclaw") + " to finish setup.");

if (!sqliteOK) {
  lines.push("");
  lines.push(red("✗ ") + bold("better-sqlite3 native binding failed to load"));
  lines.push(dim(`  ${sqliteErr}`));
  lines.push(dim("  Try: npm install -g bajaclaw --force   (rebuilds native deps)"));
}
if (!claudeOK) {
  lines.push("");
  lines.push(yellow("! ") + "The `claude` CLI backend is not on your PATH.");
  lines.push(dim("  BajaClaw drives it as a subprocess. Install it from:"));
  lines.push(dim("  https://docs.claude.com/en/docs/claude-code/setup"));
  lines.push(dim("  (BajaClaw still works in dry-run mode without it.)"));
}

lines.push("");
process.stderr.write(lines.join("\n") + "\n");
process.exit(0);
