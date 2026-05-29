// BajaClaw smoketest. Exercises every module without external login.
// Uses a temp BAJACLAW_HOME so it never touches the real ~/.bajaclaw.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

process.env.BAJACLAW_HOME = mkdtempSync(join(tmpdir(), "bajaclaw-smoke-"));
process.env.NO_COLOR = "1";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "bin", "bajaclaw.mjs");

let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; results.push(`  ok   ${name}`); }
  else { fail++; results.push(`  FAIL ${name} ${detail}`); }
}
async function section(name, fn) {
  try { await fn(); } catch (e) { fail++; results.push(`  FAIL ${name} threw: ${e?.message || e}`); }
}

function runCli(args) {
  return execFileSync(process.execPath, [BIN, ...args], { encoding: "utf8", env: process.env });
}

await section("CLI", async () => {
  check("--version", runCli(["--version"]).trim() === "1.0.0");
  check("--help shows wordmark", /BAJACLAW/.test(runCli(["--help"])));
  check("doctor runs", /doctor/i.test(runCli(["doctor"])));
  check("status runs", /BajaClaw status/.test(runCli(["status"])));
  check("unknown cmd exits nonzero", (() => {
    try { runCli(["bogus"]); return false; } catch { return true; }
  })());
});

await section("config", async () => {
  const cfg = await import("../src/config/config.mjs");
  const c = cfg.load();
  check("default provider is ChatGPT", c.defaultProvider === "openai-codex");
  check("all providers kept", cfg.PROVIDERS.length >= 8);
  check("ollama+lmstudio present (other LLMs)", cfg.PROVIDERS.some(p => p.id === "ollama") && cfg.PROVIDERS.some(p => p.id === "lmstudio"));
  const p = cfg.save(c);
  check("config saves", typeof p === "string");
  check("isOnboarded true after save", cfg.isOnboarded());
});

await section("onboarding (non-interactive)", async () => {
  const { onboardNonInteractive } = await import("../src/onboarding/onboard.mjs");
  const r = onboardNonInteractive();
  check("onboard writes config", !!r.configPath && r.provider === "openai-codex");
});

await section("llm client + auth store", async () => {
  const llm = await import("../src/llm/client.mjs");
  check("registry has 9 providers", Object.keys(llm.REGISTRY).length >= 9);
  check("codex + openai-compat + anthropic + google kinds present",
    ["codex","openai-compat","anthropic","google"].every(k => Object.values(llm.REGISTRY).some(p => p.kind === k)));
  check("local providers count as configured (no key)", llm.isConfigured("ollama") && llm.isConfigured("lmstudio"));
  check("key provider not configured without cred", !llm.isConfigured("anthropic"));
  const store = await import("../src/auth/store.mjs");
  store.saveCred("anthropic", { type: "key", api_key: "test-key" });
  check("cred save+load round-trip", store.loadCred("anthropic")?.api_key === "test-key");
  check("now configured after saveCred", llm.isConfigured("anthropic"));
  store.removeCred("anthropic");
  check("cred removed", !store.hasCred("anthropic"));
});

await section("chatgpt oauth (PKCE construction)", async () => {
  const oauth = await import("../src/auth/chatgpt-oauth.mjs");
  const url = oauth.authorizeUrl({ challenge: "abc", state: "xyz" });
  check("authorize url is auth.openai.com PKCE", url.startsWith("https://auth.openai.com/oauth/authorize") &&
    url.includes("code_challenge=abc") && url.includes("code_challenge_method=S256") && url.includes("state=xyz"));
  check("account id parses from id_token", (() => {
    const claims = { "https://api.openai.com/auth": { chatgpt_account_id: "acct_123" } };
    const fakeJwt = "h." + Buffer.from(JSON.stringify(claims)).toString("base64") + ".s";
    return oauth.accountIdFromIdToken(fakeJwt) === "acct_123";
  })());
});

await section("native agent (no provider -> graceful)", async () => {
  const cfgMod = await import("../src/config/config.mjs");
  const c = cfgMod.load();
  c.providerOrder = []; c.defaultProvider = "openai-codex"; // hermetic: no candidates
  cfgMod.save(c);
  const agent = await import("../src/agent/agent.mjs");
  check("no providers ready in clean env", agent.listReadyProviders().length === 0);
  let text = "";
  for await (const ch of agent.streamRespond([{ role: "user", content: "hi" }])) {
    if (ch.text) text += ch.text; if (ch.delta) text += ch.delta;
  }
  check("agent yields a graceful no-provider message", /onboard|configured/.test(text));
});

await section("openai endpoint (native agent)", async () => {
  const { createServer } = await import("../plugins/openai-endpoint/server.mjs");
  const { load } = await import("../src/config/config.mjs");
  const cfg = load();
  cfg.defaultProvider = "openai-codex";
  cfg.providerOrder = []; // hermetic: no reachable providers -> graceful message
  const server = createServer(cfg);
  await new Promise((res) => server.listen(0, "127.0.0.1", res));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const health = await (await fetch(`${base}/health`)).json();
  check("/health ok", health.status === "ok");

  const models = await (await fetch(`${base}/v1/models`)).json();
  check("/v1/models shape", models.object === "list" && models.data.some(m => m.id === "bajaclaw"));

  const chat = await (await fetch(`${base}/v1/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "bajaclaw", messages: [{ role: "user", content: "ping" }] }),
  })).json();
  check("/v1/chat/completions OpenAI-shaped", chat.object === "chat.completion" &&
    typeof chat.choices[0].message.content === "string" && chat.choices[0].message.content.length > 0);

  const streamRes = await fetch(`${base}/v1/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "bajaclaw", stream: true, messages: [{ role: "user", content: "hi" }] }),
  });
  const text = await streamRes.text();
  check("/v1/chat/completions stream SSE", text.includes("chat.completion.chunk") && text.includes("[DONE]"));

  await new Promise((res) => server.close(res));
});

await section("native gateway + channels", async () => {
  const { startGateway } = await import("../src/daemon/gateway.mjs");
  const { load } = await import("../src/config/config.mjs");
  const cfg = load();
  cfg.gateway.port = 0;
  const server = startGateway(cfg, { status: () => ({ models: [] }) });
  await new Promise((r) => setTimeout(r, 120));
  const port = server.address().port;
  const h = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
  check("gateway /health ok", h.status === "ok" && h.service === "bajaclaw-gateway");
  await new Promise((r) => server.close(r));

  const mgr = await import("../channels/manager.mjs");
  check("channel ids include telegram+discord", mgr.CHANNEL_IDS.includes("telegram") && mgr.CHANNEL_IDS.includes("discord"));
  const started = await mgr.startChannels({ log: () => {} });
  check("no channels start when none enabled", Array.isArray(started) && started.length === 0);
});

await section("config (standalone)", async () => {
  const cfg = (await import("../src/config/config.mjs")).load();
  check("endpoint port 11435 (avoids ollama)", cfg.openaiEndpoint.port === 11435);
  check("channels section present", cfg.channels && "telegram" in cfg.channels && "discord" in cfg.channels);
});

await section("hermes brain", async () => {
  const store = await import("../plugins/hermes-brain/store.mjs");
  store.remember({ task: "deploy api", outcome: "ok", success: true, tags: ["deploy"] });
  store.remember({ task: "deploy worker", outcome: "ok", success: true, tags: ["deploy"] });
  store.remember({ task: "deploy web", outcome: "ok", success: true, tags: ["deploy"] });
  const recalled = store.recall("deploy something");
  check("recall returns memories", recalled.length >= 1 && /deploy/.test(recalled[0].task));
  const skills = store.synthesizeSkills({ minSuccesses: 3 });
  check("skill synthesis from repeats", skills.some(s => s.name === "auto-deploy"));
});

await section("cowork mode", async () => {
  const { planGoal, runOutcome } = await import("../plugins/cowork-mode/flow.mjs");
  const plan = planGoal("write a report");
  check("plan has ordered steps", plan.steps.length === 4 && plan.steps[0].id === 1);
  const out = await runOutcome("write a report");
  check("runOutcome completes", out.status === "complete" && out.deliverable.includes("Produce the deliverable"));
});

await section("self-updater (render, offline-safe)", async () => {
  const mod = await import("../plugins/self-updater/updater.mjs");
  // Live check; tolerate network/rate-limit by only asserting structure.
  const { load } = await import("../src/config/config.mjs");
  const r = await mod.check(load(), { write: true });
  check("check returns findings+proposal", Array.isArray(r.findings) && typeof r.proposal === "string");
  check("proposal mentions BajaClaw", r.proposal.includes("BajaClaw"));
});

await section("web ui build + server", async () => {
  const fs = await import("node:fs");
  const dist = join(ROOT, "web", "dist");
  check("web/dist built (index.html)", fs.existsSync(join(dist, "index.html")));
  const { startUiServer } = await import("../src/daemon/uiserver.mjs");
  const server = startUiServer({ dist, port: 0 });
  await new Promise((r) => server.listen ? r() : setTimeout(r, 100));
  // server already listening on a random port; grab it
  await new Promise((r) => setTimeout(r, 120));
  const port = server.address()?.port;
  if (port) {
    const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    check("UI server serves index", /<div id="root">/.test(html));
    const spa = await fetch(`http://127.0.0.1:${port}/some/deep/route`);
    check("UI server SPA fallback", spa.ok);
  } else {
    check("UI server serves index", false, "(no port)");
  }
  await new Promise((r) => server.close(r));
});

await section("daemon plist", async () => {
  const d = await import("../src/daemon/daemon.mjs");
  const xml = d.plistXml();
  check("plist has label", xml.includes("com.bajaclaw.gateway") && xml.includes("RunAtLoad"));
  // Validate with plutil if available (macOS).
  try {
    const tmp = join(process.env.BAJACLAW_HOME, "test.plist");
    (await import("node:fs")).writeFileSync(tmp, xml);
    execFileSync("plutil", ["-lint", tmp], { stdio: "ignore" });
    check("plutil -lint passes", true);
  } catch (e) {
    check("plutil -lint passes", process.platform !== "darwin", "(plutil unavailable)");
  }
});

console.log("\nBajaClaw smoketest");
console.log(results.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
