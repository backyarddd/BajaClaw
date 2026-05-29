#!/usr/bin/env node
// BajaClaw CLI. Branded, simple, one command to run everything.
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { color, glyph, wordmark, brandline, panel, spinner } from "../src/ui/theme.mjs";
import { openUrl } from "../src/util.mjs";
import { load, save, isOnboarded, CONFIG_DIR, PROVIDERS } from "../src/config/config.mjs";
import * as daemon from "../src/daemon/daemon.mjs";
import { onboard, onboardNonInteractive } from "../src/onboarding/onboard.mjs";
import { startEndpoint } from "../plugins/openai-endpoint/server.mjs";
import { startUiServer } from "../src/daemon/uiserver.mjs";
import { startGateway } from "../src/daemon/gateway.mjs";
import { startChannels } from "../channels/manager.mjs";
import { listReadyProviders, respond, streamRespond } from "../src/agent/agent.mjs";
import { REGISTRY, isConfigured } from "../src/llm/client.mjs";
import { saveCred, removeCred, hasCred } from "../src/auth/store.mjs";
import { login as chatgptLogin } from "../src/auth/chatgpt-oauth.mjs";
import * as brain from "../plugins/hermes-brain/store.mjs";
import { runOutcome } from "../plugins/cowork-mode/flow.mjs";
import { check as checkUpdates } from "../plugins/self-updater/updater.mjs";

const PKG_VERSION = createRequire(import.meta.url)("../package.json").version;
const argv = process.argv.slice(2);
const cmd = argv[0];
const rest = argv.slice(1);
const flags = new Set(argv.filter((a) => a.startsWith("-")));
const positional = rest.filter((a) => !a.startsWith("-"));

function ok(s) { console.log(`${glyph.ok} ${s}`); }
function info(s) { console.log(`${glyph.info} ${s}`); }
function warn(s) { console.log(`${glyph.warn} ${s}`); }
function err(s) { console.log(`${glyph.err} ${color.red(s)}`); }

function help() {
  console.log("\n" + wordmark() + "\n");
  console.log(panel("Run", [
    `${color.bold("bajaclaw onboard")}    ${color.dim("guided first-run setup (model, channels, features)")}`,
    `${color.bold("bajaclaw start")}      ${color.dim("start everything (gateway + UI + local API + channels)")}`,
    `${color.bold("bajaclaw stop")} / ${color.bold("restart")}  ${color.dim("control the daemon")}`,
    `${color.bold("bajaclaw status")} / ${color.bold("doctor")}  ${color.dim("health and environment")}`,
    `${color.bold("bajaclaw ui")}         ${color.dim("open the web interface")}`,
    `${color.bold("bajaclaw uninstall")}  ${color.dim("remove the boot daemon")}`,
  ]) + "\n");
  console.log(panel("Talk", [
    `${color.bold("bajaclaw ask")} "…"    ${color.dim("one-shot question")}`,
    `${color.bold("bajaclaw chat")}       ${color.dim("interactive terminal chat")}`,
    `${color.bold("bajaclaw cowork")} "…" ${color.dim("run a goal end-to-end")}`,
  ]) + "\n");
  console.log(panel("Manage", [
    `${color.bold("bajaclaw providers")}  ${color.dim("list models/providers and what is configured")}`,
    `${color.bold("bajaclaw login")} <id> / ${color.bold("logout")} <id>  ${color.dim("provider auth")}`,
    `${color.bold("bajaclaw channels")} [enable|disable|token] ${color.dim("messaging channels")}`,
    `${color.bold("bajaclaw memory")} [query|clear]  ${color.dim("browse/search/clear memory")}`,
    `${color.bold("bajaclaw skills")}     ${color.dim("learned skills")}`,
    `${color.bold("bajaclaw update")}     ${color.dim("check upstreams, write a proposal")}`,
    `${color.bold("bajaclaw config")} [get|set] ${color.dim("view or change settings")}`,
    `${color.bold("bajaclaw logs")}       ${color.dim("tail the daemon logs")}`,
  ]) + "\n");
  console.log(color.dim(`  config: ${CONFIG_DIR}`) + "\n");
}

function openUiUrl() {
  const cfg = load();
  const url = `http://${cfg.ui.host}:${cfg.ui.port}/`;
  info(`Opening ${url}`);
  if (!openUrl(url)) warn(`Open it manually: ${url}`);
}

async function cmdStart() {
  console.log("\n" + brandline("start") + "\n");
  if (!isOnboarded()) { info("First run - writing default config (ChatGPT). Run 'bajaclaw onboard' to sign in."); onboardNonInteractive(); }
  const sp = spinner("starting gateway daemon").start();
  const res = daemon.start();
  sp.stop(glyph.ok, `gateway daemon up (${res.method})`);
  const cfg = load();
  if (cfg.openaiEndpoint.enabled) info(`OpenAI endpoint: ${color.bold(`http://${cfg.openaiEndpoint.host}:${cfg.openaiEndpoint.port}/v1`)}`);
  info(`Web UI: ${color.bold(`http://${cfg.ui.host}:${cfg.ui.port}/`)}`);
  const ready = listReadyProviders();
  if (!ready.length) warn("No model configured yet. Run 'bajaclaw onboard' to sign in with ChatGPT (or another provider).");
  else info(`Models ready: ${ready.join(", ")}`);
  ok("BajaClaw started. After a reboot, just run 'bajaclaw start' again.");
}

function cmdStop() { daemon.stop(); ok("Stopped."); }
async function cmdRestart() { daemon.stop(); await cmdStart(); }

function cmdStatus() {
  const s = daemon.status();
  console.log("\n" + panel("BajaClaw status", [
    `${glyph.bullet} daemon:        ${s.daemon}`,
    `${glyph.bullet} gateway:       ${s.gateway}`,
    `${glyph.bullet} web ui:        ${s.ui}`,
    `${glyph.bullet} openai endpoint: ${s.openaiEndpoint}`,
    `${glyph.bullet} plist:         ${color.dim(s.plist)}`,
    `${glyph.bullet} models ready:  ${listReadyProviders().join(", ") || color.yellow("none (run onboard)")}`,
  ]) + "\n");
}

function cmdDoctor() {
  const ready = listReadyProviders();
  const checks = [
    [Number(process.versions.node.split(".")[0]) >= 22, `Node ${process.versions.node} (need >=22.19)`],
    [ready.length > 0, `A model is configured (${ready.join(", ") || "none yet"})`],
    [isOnboarded(), "Onboarded (config present)"],
    [process.platform === "darwin", `Platform ${process.platform} (launchd daemon = macOS)`],
  ];
  console.log("\n" + panel("doctor", checks.map(([g, l]) => `${g ? glyph.ok : glyph.warn} ${l}`)) + "\n");
}

async function cmdUpdate() {
  const sp = spinner("checking OpenClaw / Hermes / Cowork upstreams").start();
  const r = await checkUpdates(load(), { write: !flags.has("--check") });
  sp.stop(glyph.ok, `checked sources`);
  if (!r.findings.length) { ok("Everything up to date."); return; }
  console.log("\n" + panel(`${r.findings.length} update(s)`, r.findings.map((f) => `${glyph.arrow} ${f.label}: ${color.dim(f.from)} -> ${color.bold(color.amber(f.to))}`)) + "\n");
  if (r.proposalPath) ok(`Proposal written -> ${color.dim(r.proposalPath)}`);
}

// ---- talk ----
async function streamToStdout(messages) {
  let any = false;
  for await (const c of streamRespond(messages)) {
    if (c.delta) { process.stdout.write(c.delta); any = true; }
    else if (c.text) process.stdout.write(c.text);
  }
  process.stdout.write("\n");
  return any;
}
async function cmdAsk() {
  const prompt = positional.join(" ").trim();
  if (!prompt) { err('usage: bajaclaw ask "your question"'); process.exitCode = 1; return; }
  await streamToStdout([{ role: "user", content: prompt }]);
}
async function cmdChat() {
  console.log("\n" + brandline("chat") + color.dim("  (type 'exit' to quit)") + "\n");
  const rl = createInterface({ input: stdin, output: stdout });
  const history = [];
  try {
    for (;;) {
      const line = (await rl.question(color.amber("you ") + color.dim("› "))).trim();
      if (!line || line === "exit" || line === "quit") break;
      history.push({ role: "user", content: line });
      process.stdout.write(color.teal("bajaclaw ") + color.dim("› "));
      let acc = "";
      for await (const c of streamRespond(history)) {
        if (c.delta) { process.stdout.write(c.delta); acc += c.delta; }
        else if (c.text) { process.stdout.write(c.text); acc += c.text; }
      }
      process.stdout.write("\n\n");
      history.push({ role: "assistant", content: acc });
    }
  } finally { rl.close(); }
}
async function cmdCowork() {
  const goal = positional.join(" ").trim();
  if (!goal) { err('usage: bajaclaw cowork "your goal"'); process.exitCode = 1; return; }
  const sp = spinner(`working: ${goal}`).start();
  const result = await runOutcome(goal, {
    execute: async (step) => { const { text } = await respond([{ role: "user", content: `${step.title}: ${step.detail}` }]); return { ok: true, note: text.slice(0, 500) }; },
  });
  sp.stop(glyph.ok, `outcome ${result.status}`);
  console.log("\n" + panel(goal, result.results.map((r) => `${glyph.arrow} ${color.bold(r.step.title)}\n  ${color.dim(r.result?.note || "")}`)) + "\n");
}

// ---- manage ----
function cmdProviders() {
  const cfg = load();
  const rows = PROVIDERS.map((p) => {
    const conf = isConfigured(p.id);
    const def = cfg.defaultProvider === p.id;
    const tag = def ? color.amber("default") : conf ? color.teal("ready ") : color.dim("not set");
    return `${glyph.bullet} ${tag}  ${p.label}  ${color.dim(REGISTRY[p.id]?.defaultModel || "")}`;
  });
  console.log("\n" + panel("Providers", rows) + "\n");
}

async function cmdLogin() {
  const id = positional[0];
  if (!id || !REGISTRY[id]) { err(`usage: bajaclaw login <provider>  (${PROVIDERS.map((p) => p.id).join(", ")})`); process.exitCode = 1; return; }
  if (id === "openai-codex") {
    try { await chatgptLogin({ print: (m) => console.log(color.dim(m)) }); ok("Signed in with ChatGPT."); }
    catch (e) { err(`sign-in failed: ${e.message}`); process.exitCode = 1; }
    return;
  }
  const meta = PROVIDERS.find((p) => p.id === id);
  if (meta?.kind === "local") { ok(`${meta.label} is local; no key needed.`); return; }
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const key = (await rl.question(`Paste your ${meta?.label || id} API key: `)).trim();
    if (!key) { warn("No key entered."); return; }
    saveCred(id, { type: "key", api_key: key });
    ok(`Saved ${id} key.`);
  } finally { rl.close(); }
}
function cmdLogout() {
  const id = positional[0];
  if (!id) { err("usage: bajaclaw logout <provider>"); process.exitCode = 1; return; }
  if (!hasCred(id)) { warn(`${id} was not signed in.`); return; }
  removeCred(id);
  ok(`Logged out of ${id}.`);
}

function cmdChannels() {
  const cfg = load();
  const sub = positional[0];
  if (!sub) {
    const rows = Object.entries(cfg.channels).map(([id, c]) => `${glyph.bullet} ${c.enabled ? color.teal("on ") : color.dim("off")}  ${id}  ${c.token ? color.dim("token set") : color.dim("no token")}`);
    console.log("\n" + panel("Channels", rows) + "\n");
    info("bajaclaw channels enable|disable <id>  ·  bajaclaw channels token <id> <token>");
    return;
  }
  const id = positional[1];
  if (!id || !(id in cfg.channels)) { err(`unknown channel: ${id}`); process.exitCode = 1; return; }
  if (sub === "enable" || sub === "disable") { cfg.channels[id].enabled = sub === "enable"; save(cfg); ok(`${id} ${sub}d. Run 'bajaclaw restart' to apply.`); }
  else if (sub === "token") { const tok = positional[2]; if (!tok) { err("usage: bajaclaw channels token <id> <token>"); return; } cfg.channels[id].token = tok; save(cfg); ok(`${id} token set. Run 'bajaclaw restart' to apply.`); }
  else { err(`unknown subcommand: ${sub}`); process.exitCode = 1; }
}

function cmdMemory() {
  const sub = positional[0];
  if (sub === "clear") { brain.clear(); ok("Memory cleared."); return; }
  const items = sub ? brain.recall(positional.join(" "), { limit: 20 }) : brain.all().slice(-20).reverse();
  if (!items.length) { info("No memory yet."); return; }
  console.log("\n" + panel(sub ? `Memory: "${positional.join(" ")}"` : "Recent memory", items.map((m) => `${glyph.bullet} ${m.task} ${color.dim("- " + (m.outcome || "").slice(0, 60))}`)) + "\n");
}

function cmdSkills() {
  const skills = brain.synthesizeSkills({ minSuccesses: 2 });
  if (!skills.length) { info("No learned skills yet. Repeat a kind of task a few times."); return; }
  console.log("\n" + panel("Learned skills", skills.map((s) => `${glyph.bullet} ${color.bold(s.name)} ${color.dim(`(${s.from}x) ` + s.summary)}`)) + "\n");
}

function cmdConfig() {
  const cfg = load();
  const sub = positional[0];
  if (!sub) {
    const redacted = structuredClone(cfg);
    for (const id of Object.keys(redacted.channels || {})) if (redacted.channels[id].token) redacted.channels[id].token = "***";
    console.log(JSON.stringify(redacted, null, 2));
    return;
  }
  const at = (obj, path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
  if (sub === "get") { const v = at(cfg, positional[1] || ""); console.log(typeof v === "object" ? JSON.stringify(v, null, 2) : String(v)); return; }
  if (sub === "set") {
    const key = positional[1]; let val = positional.slice(2).join(" ");
    if (!key) { err("usage: bajaclaw config set <key> <value>"); process.exitCode = 1; return; }
    if (val === "true") val = true; else if (val === "false") val = false; else if (/^-?\d+$/.test(val)) val = parseInt(val, 10);
    const parts = key.split("."); let o = cfg;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] ??= {};
    o[parts[parts.length - 1]] = val;
    save(cfg);
    ok(`Set ${key} = ${val}. Run 'bajaclaw restart' if it affects the daemon.`);
    return;
  }
  err(`unknown subcommand: ${sub}`); process.exitCode = 1;
}

function cmdLogs() {
  const out = join(CONFIG_DIR, "logs", "gateway.out.log");
  const errp = join(CONFIG_DIR, "logs", "gateway.err.log");
  for (const [label, f] of [["out", out], ["err", errp]]) {
    if (!existsSync(f)) continue;
    const lines = readFileSync(f, "utf8").trim().split("\n");
    if (!lines[0]) continue;
    console.log("\n" + color.dim(`--- ${label} (last 30) ---`));
    console.log(lines.slice(-30).join("\n"));
  }
  console.log("");
}

function cmdUninstall() {
  daemon.uninstall();
  ok("Daemon removed. (Config in ~/.bajaclaw and the npm package are untouched; 'npm rm -g bajaclaw' to uninstall the CLI.)");
}

// Internal: the supervised process the daemon runs. Boots gateway + endpoint + ui + channels.
async function cmdServe() {
  const cfg = load();
  startGateway(cfg, {
    version: PKG_VERSION,
    onListen: (g) => console.log(`[bajaclaw] gateway on http://${g.host}:${g.port}/`),
    status: () => ({ models: listReadyProviders() }),
  });
  if (cfg.openaiEndpoint.enabled) startEndpoint(cfg, { onListen: (ep) => console.log(`[bajaclaw] openai endpoint on http://${ep.host}:${ep.port}/v1`) });
  const dist = join(import.meta.dirname, "..", "web", "dist");
  startUiServer({ dist, host: cfg.ui.host, port: cfg.ui.port, onListen: (u) => console.log(`[bajaclaw] web ui on http://${u.host}:${u.port}/`) });
  startChannels({ log: console.log }).catch((e) => console.log(`[channels] ${e.message}`));
  process.stdin.resume();
}

async function main() {
  if (flags.has("--version") || flags.has("-v") || cmd === "version") return console.log(PKG_VERSION);
  switch (cmd) {
    case undefined: case "help": case "--help": case "-h": return help();
    case "onboard": return void (await onboard({ yes: flags.has("--yes") || flags.has("-y") }));
    case "start": return await cmdStart();
    case "stop": return cmdStop();
    case "restart": return await cmdRestart();
    case "status": return cmdStatus();
    case "doctor": return cmdDoctor();
    case "update": return await cmdUpdate();
    case "ui": return openUiUrl();
    case "uninstall": return cmdUninstall();
    case "ask": return await cmdAsk();
    case "chat": return await cmdChat();
    case "cowork": return await cmdCowork();
    case "providers": case "models": return cmdProviders();
    case "login": return await cmdLogin();
    case "logout": return cmdLogout();
    case "channels": return cmdChannels();
    case "memory": return cmdMemory();
    case "skills": return cmdSkills();
    case "config": return cmdConfig();
    case "logs": return cmdLogs();
    case "_serve": return await cmdServe();
    default:
      err(`unknown command: ${cmd}`); help(); process.exitCode = 1;
  }
}

main().catch((e) => { err(String(e?.stack || e)); process.exitCode = 1; });
