#!/usr/bin/env node
// BajaClaw CLI. Branded, simple, one command to run everything.
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { color, glyph, wordmark, brandline, panel, spinner } from "../src/ui/theme.mjs";
import { load, save, isOnboarded, CONFIG_DIR } from "../src/config/config.mjs";
import * as daemon from "../src/daemon/daemon.mjs";
import { onboard, onboardNonInteractive } from "../src/onboarding/onboard.mjs";
import { startEndpoint } from "../plugins/openai-endpoint/server.mjs";
import { startUiServer } from "../src/daemon/uiserver.mjs";
import { check as checkUpdates } from "../plugins/self-updater/updater.mjs";

const PKG_VERSION = "1.0.0";
const argv = process.argv.slice(2);
const cmd = argv[0];
const flags = new Set(argv.filter((a) => a.startsWith("-")));

function ok(s) { console.log(`${glyph.ok} ${s}`); }
function info(s) { console.log(`${glyph.info} ${s}`); }
function warn(s) { console.log(`${glyph.warn} ${s}`); }
function err(s) { console.log(`${glyph.err} ${color.red(s)}`); }

function help() {
  console.log("\n" + wordmark() + "\n");
  console.log(panel("Commands", [
    `${color.bold("bajaclaw start")}      ${color.dim("start everything (gateway daemon + OpenAI endpoint)")}`,
    `${color.bold("bajaclaw stop")}       ${color.dim("stop the daemon")}`,
    `${color.bold("bajaclaw restart")}    ${color.dim("restart the daemon")}`,
    `${color.bold("bajaclaw status")}     ${color.dim("show health")}`,
    `${color.bold("bajaclaw onboard")}    ${color.dim("first-run setup (ChatGPT by default, all LLMs available)")}`,
    `${color.bold("bajaclaw ui")}         ${color.dim("open the web interface")}`,
    `${color.bold("bajaclaw update")}     ${color.dim("check upstreams, write an approve-to-merge proposal")}`,
    `${color.bold("bajaclaw doctor")}     ${color.dim("environment + health checks")}`,
  ]) + "\n");
  console.log(color.dim(`  config: ${CONFIG_DIR}`) + "\n");
}

function hasOpenclaw() {
  try { execFileSync("openclaw", ["--version"], { stdio: "ignore" }); return true; }
  catch { return false; }
}

function openUrl(url) {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try { execFileSync(opener, [url], { stdio: "ignore" }); return true; } catch { return false; }
}

async function cmdStart() {
  console.log("\n" + brandline("start") + "\n");
  if (!isOnboarded()) {
    info("First run - writing default config (ChatGPT). Run 'bajaclaw onboard' to sign in.");
    onboardNonInteractive();
  }
  const sp = spinner("starting gateway daemon").start();
  const res = daemon.start();
  sp.stop(glyph.ok, `gateway daemon up (${res.method})`);
  const cfg = load();
  if (cfg.openaiEndpoint.enabled) {
    info(`OpenAI endpoint will serve at ${color.bold(`http://${cfg.openaiEndpoint.host}:${cfg.openaiEndpoint.port}/v1`)}`);
  }
  info(`Web UI: ${color.bold(`http://${cfg.ui.host}:${cfg.ui.port}/`)}`);
  if (!hasOpenclaw()) warn("OpenClaw core not detected - install it with: npm i -g openclaw");
  ok("BajaClaw started. After a reboot, just run 'bajaclaw start' again.");
}

function cmdStop() {
  daemon.stop();
  ok("Stopped.");
}

async function cmdRestart() {
  daemon.stop();
  await cmdStart();
}

function cmdStatus() {
  const s = daemon.status();
  console.log("\n" + panel("BajaClaw status", [
    `${glyph.bullet} daemon:        ${s.daemon}`,
    `${glyph.bullet} gateway:       ${s.gateway}`,
    `${glyph.bullet} web ui:        ${s.ui}`,
    `${glyph.bullet} openai endpoint: ${s.openaiEndpoint}`,
    `${glyph.bullet} plist:         ${color.dim(s.plist)}`,
    `${glyph.bullet} openclaw core: ${hasOpenclaw() ? color.green("installed") : color.yellow("not installed")}`,
  ]) + "\n");
}

function cmdDoctor() {
  const checks = [];
  const nodeOk = Number(process.versions.node.split(".")[0]) >= 22;
  checks.push([nodeOk, `Node ${process.versions.node} (need >=22.19)`]);
  checks.push([hasOpenclaw(), "OpenClaw core installed"]);
  checks.push([isOnboarded(), "Onboarded (config present)"]);
  checks.push([process.platform === "darwin", `Platform ${process.platform} (launchd daemon = macOS)`]);
  console.log("\n" + panel("doctor", checks.map(([good, label]) =>
    `${good ? glyph.ok : glyph.warn} ${label}`)) + "\n");
}

async function cmdUpdate() {
  const cfg = load();
  const sp = spinner("checking OpenClaw / Hermes / Cowork upstreams").start();
  const r = await checkUpdates(cfg, { write: !flags.has("--check") });
  sp.stop(glyph.ok, `checked ${Object.keys(r.raw).length} sources`);
  if (!r.findings.length) { ok("Everything up to date."); return; }
  console.log("\n" + panel(`${r.findings.length} update(s)`, r.findings.map((f) =>
    `${glyph.arrow} ${f.label}: ${color.dim(f.from)} → ${color.bold(color.amber(f.to))}`)) + "\n");
  if (r.proposalPath) ok(`Proposal written → ${color.dim(r.proposalPath)} (review & approve; nothing auto-merged)`);
}

function cmdUi() {
  const cfg = load();
  const url = `http://${cfg.ui.host}:${cfg.ui.port}/`;
  info(`Opening ${url}`);
  if (!openUrl(url)) warn(`Open it manually: ${url}`);
}

// Internal: the supervised process the daemon runs. Boots gateway + endpoint.
async function cmdServe() {
  const cfg = load();
  // 1) OpenAI endpoint (always ours).
  if (cfg.openaiEndpoint.enabled) {
    startEndpoint(cfg, { onListen: (ep) => console.log(`[bajaclaw] openai endpoint on http://${ep.host}:${ep.port}/v1`) });
  }
  // 2) Web UI (served from web/dist).
  const dist = join(import.meta.dirname, "..", "web", "dist");
  startUiServer({ dist, host: cfg.ui.host, port: cfg.ui.port,
    onListen: (u) => console.log(`[bajaclaw] web ui on http://${u.host}:${u.port}/`) });
  // 3) Gateway = OpenClaw daemon as a child, if installed.
  if (hasOpenclaw()) {
    const child = spawn(
      "openclaw",
      ["gateway", "run", "--port", String(cfg.gateway.port), "--bind", "loopback", "--allow-unconfigured"],
      { stdio: "inherit" }
    );
    child.on("exit", (c) => console.log(`[bajaclaw] gateway exited (${c}); endpoint + UI still serving`));
  } else {
    console.log("[bajaclaw] OpenClaw core not installed; endpoint-only mode. Install with: npm i -g openclaw");
  }
  // Keep alive.
  process.stdin.resume();
}

async function main() {
  if (flags.has("--version") || flags.has("-v") || cmd === "version") return console.log(PKG_VERSION);
  switch (cmd) {
    case undefined:
    case "help":
    case "--help":
    case "-h": return help();
    case "onboard": return void (await onboard({ yes: flags.has("--yes") || flags.has("-y") }));
    case "start": return await cmdStart();
    case "stop": return cmdStop();
    case "restart": return await cmdRestart();
    case "status": return cmdStatus();
    case "doctor": return cmdDoctor();
    case "update": return await cmdUpdate();
    case "ui": return cmdUi();
    case "_serve": return await cmdServe();
    default:
      err(`unknown command: ${cmd}`);
      help();
      process.exitCode = 1;
  }
}

main().catch((e) => { err(String(e?.stack || e)); process.exitCode = 1; });
