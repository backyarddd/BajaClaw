// Daemon lifecycle. The daemon IS the gateway (+ the local OpenAI endpoint).
// macOS: launchd. Other: detached process fallback.
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { load, CONFIG_DIR } from "../config/config.mjs";

const HOME = homedir();
const LABEL = "com.bajaclaw.gateway";
const LA_DIR = join(HOME, "Library", "LaunchAgents");
const PLIST = join(LA_DIR, `${LABEL}.plist`);
const LOG_DIR = join(CONFIG_DIR, "logs");
const isMac = platform() === "darwin";

function uid() {
  return process.getuid ? process.getuid() : 0;
}

function nodeBin() {
  return process.execPath;
}

function serveEntry() {
  // The internal supervised entry that boots gateway + endpoint.
  return join(import.meta.dirname, "..", "..", "bin", "bajaclaw.mjs");
}

function ensureLogs() {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
}

export function plistXml() {
  ensureLogs();
  const out = join(LOG_DIR, "gateway.out.log");
  const err = join(LOG_DIR, "gateway.err.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin()}</string>
    <string>${serveEntry()}</string>
    <string>_serve</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${out}</string>
  <key>StandardErrorPath</key><string>${err}</string>
  <key>WorkingDirectory</key><string>${HOME}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>BAJACLAW_MANAGED</key><string>1</string>
  </dict>
</dict>
</plist>
`;
}

export function installPlist() {
  if (!isMac) return null;
  if (!existsSync(LA_DIR)) mkdirSync(LA_DIR, { recursive: true });
  writeFileSync(PLIST, plistXml());
  return PLIST;
}

function launchctl(args) {
  return execFileSync("launchctl", args, { stdio: "pipe" }).toString();
}

export function isLoaded() {
  if (!isMac) return false;
  try {
    launchctl(["print", `gui/${uid()}/${LABEL}`]);
    return true;
  } catch {
    return false;
  }
}

export function start() {
  ensureLogs();
  if (isMac) {
    installPlist();
    // bootout first (ignore errors) so we reload a fresh definition, then bootstrap.
    try { launchctl(["bootout", `gui/${uid()}`, PLIST]); } catch {}
    launchctl(["bootstrap", `gui/${uid()}`, PLIST]);
    try { launchctl(["enable", `gui/${uid()}/${LABEL}`]); } catch {}
    try { launchctl(["kickstart", "-k", `gui/${uid()}/${LABEL}`]); } catch {}
    return { method: "launchd", plist: PLIST };
  }
  // Fallback: detached background process.
  const child = spawn(nodeBin(), [serveEntry(), "_serve"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return { method: "detached", pid: child.pid };
}

export function stop() {
  if (isMac) {
    try { launchctl(["bootout", `gui/${uid()}`, PLIST]); } catch {}
    return { method: "launchd" };
  }
  return { method: "detached", note: "kill the bajaclaw _serve process manually" };
}

export function uninstall() {
  stop();
  if (existsSync(PLIST)) rmSync(PLIST);
  return PLIST;
}

export function status() {
  const cfg = load();
  return {
    platform: platform(),
    daemon: isMac ? (isLoaded() ? "running (launchd)" : "stopped") : "n/a (use _serve)",
    label: LABEL,
    plist: existsSync(PLIST) ? PLIST : "(not installed)",
    gateway: `${cfg.gateway.host}:${cfg.gateway.port}`,
    ui: `${cfg.ui.host}:${cfg.ui.port}`,
    openaiEndpoint: cfg.openaiEndpoint.enabled
      ? `${cfg.openaiEndpoint.host}:${cfg.openaiEndpoint.port}`
      : "disabled",
  };
}

export { LABEL, PLIST };
