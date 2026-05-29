// Local control API for the web dashboard. Binds to localhost via the gateway.
// JSON over HTTP. No secrets are returned (keys/tokens are write-only).
import { load, save, PROVIDERS } from "../config/config.mjs";
import { REGISTRY, isConfigured } from "../llm/client.mjs";
import { saveCred, loadCred, removeCred, hasCred } from "../auth/store.mjs";
import { listReadyProviders } from "../agent/agent.mjs";
import * as brain from "../../plugins/hermes-brain/store.mjs";
import { runOutcome } from "../../plugins/cowork-mode/flow.mjs";
import { check as checkUpdates } from "../../plugins/self-updater/updater.mjs";

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(body);
}
function readJson(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

// Config without secrets (channel tokens redacted to a boolean).
function publicConfig(cfg) {
  const c = structuredClone(cfg);
  for (const id of Object.keys(c.channels || {})) {
    const has = !!c.channels[id].token;
    if ("token" in c.channels[id]) c.channels[id].token = undefined;
    c.channels[id].hasToken = has;
  }
  return c;
}

function providerList(cfg) {
  return PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    kind: p.kind,
    recommended: !!p.recommended,
    configured: isConfigured(p.id),
    isDefault: cfg.defaultProvider === p.id,
    defaultModel: REGISTRY[p.id]?.defaultModel || null,
  }));
}

function channelList(cfg) {
  const native = new Set(["telegram", "discord"]);
  return Object.entries(cfg.channels || {}).map(([id, c]) => ({
    id,
    enabled: !!c.enabled,
    hasToken: !!c.token,
    native: native.has(id),
  }));
}

async function reloadChannels() {
  try {
    const mgr = await import("../../channels/manager.mjs");
    mgr.stopChannels();
    return await mgr.startChannels({ log: () => {} });
  } catch { return []; }
}

// Merge only allow-listed config fields from a PATCH body.
function applyConfigPatch(cfg, body) {
  const set = (path, val) => {
    const parts = path.split(".");
    let o = cfg;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] ??= {};
    o[parts[parts.length - 1]] = val;
  };
  if (typeof body.defaultProvider === "string" && REGISTRY[body.defaultProvider]) {
    set("defaultProvider", body.defaultProvider);
    cfg.providerOrder = [body.defaultProvider, ...(cfg.providerOrder || []).filter((p) => p !== body.defaultProvider)];
  }
  if (Array.isArray(body.providerOrder)) set("providerOrder", body.providerOrder.filter((p) => REGISTRY[p]));
  if (body.openaiEndpoint) {
    if (typeof body.openaiEndpoint.enabled === "boolean") set("openaiEndpoint.enabled", body.openaiEndpoint.enabled);
    if (["agent", "raw"].includes(body.openaiEndpoint.mode)) set("openaiEndpoint.mode", body.openaiEndpoint.mode);
    if (Number.isInteger(body.openaiEndpoint.port)) set("openaiEndpoint.port", body.openaiEndpoint.port);
  }
  if (body.selfUpdate) {
    if (typeof body.selfUpdate.enabled === "boolean") set("selfUpdate.enabled", body.selfUpdate.enabled);
    if (["propose", "sandbox", "notify"].includes(body.selfUpdate.mode)) set("selfUpdate.mode", body.selfUpdate.mode);
  }
  if (body.features) {
    if (typeof body.features.hermesBrain === "boolean") set("features.hermesBrain", body.features.hermesBrain);
    if (typeof body.features.coworkMode === "boolean") set("features.coworkMode", body.features.coworkMode);
  }
  return cfg;
}

// Returns true if it handled the request.
export async function handleApi(req, res, url, ctx = {}) {
  const p = url.pathname;
  if (!p.startsWith("/api/")) return false;
  const method = req.method;
  const cfg = load();

  try {
    if (p === "/api/status" && method === "GET") {
      send(res, 200, {
        version: ctx.version || null,
        ready: listReadyProviders(),
        defaultProvider: cfg.defaultProvider,
        ports: { gateway: cfg.gateway.port, ui: cfg.ui.port, openaiEndpoint: cfg.openaiEndpoint.port },
        endpointMode: cfg.openaiEndpoint.mode,
        channels: channelList(cfg).filter((c) => c.enabled).map((c) => c.id),
        memoryCount: (() => { try { return brain.all().length; } catch { return 0; } })(),
      });
      return true;
    }

    if (p === "/api/config" && method === "GET") { send(res, 200, publicConfig(cfg)); return true; }
    if (p === "/api/config" && (method === "PATCH" || method === "POST")) {
      const body = await readJson(req);
      save(applyConfigPatch(cfg, body));
      send(res, 200, { ok: true, config: publicConfig(load()) });
      return true;
    }

    if (p === "/api/providers" && method === "GET") { send(res, 200, { providers: providerList(cfg) }); return true; }
    let m;
    if ((m = p.match(/^\/api\/providers\/([\w-]+)\/key$/)) && method === "PUT") {
      const body = await readJson(req);
      if (!REGISTRY[m[1]]) { send(res, 404, { error: "unknown provider" }); return true; }
      if (!body.key) { send(res, 400, { error: "missing key" }); return true; }
      saveCred(m[1], { type: "key", api_key: String(body.key) });
      send(res, 200, { ok: true });
      return true;
    }
    if ((m = p.match(/^\/api\/providers\/([\w-]+)$/)) && method === "DELETE") {
      removeCred(m[1]);
      send(res, 200, { ok: true });
      return true;
    }

    if (p === "/api/channels" && method === "GET") { send(res, 200, { channels: channelList(cfg) }); return true; }
    if ((m = p.match(/^\/api\/channels\/([\w-]+)$/)) && (method === "PUT" || method === "PATCH")) {
      const body = await readJson(req);
      const id = m[1];
      cfg.channels[id] = cfg.channels[id] || {};
      if (typeof body.enabled === "boolean") cfg.channels[id].enabled = body.enabled;
      if (typeof body.token === "string" && body.token) cfg.channels[id].token = body.token;
      save(cfg);
      const active = await reloadChannels();
      send(res, 200, { ok: true, active });
      return true;
    }

    if (p === "/api/memory" && method === "GET") {
      const q = url.searchParams.get("q");
      const items = q ? brain.recall(q, { limit: 25 }) : brain.all().slice(-50).reverse();
      send(res, 200, { items });
      return true;
    }
    if (p === "/api/memory" && method === "DELETE") { brain.clear(); send(res, 200, { ok: true }); return true; }

    if (p === "/api/skills" && method === "GET") { send(res, 200, { skills: brain.synthesizeSkills({ minSuccesses: 2 }) }); return true; }

    if (p === "/api/updates" && method === "GET") {
      const r = await checkUpdates(cfg, { write: false });
      send(res, 200, { findings: r.findings, proposal: r.proposal });
      return true;
    }
    if (p === "/api/updates/check" && method === "POST") {
      const r = await checkUpdates(cfg, { write: true });
      send(res, 200, { findings: r.findings, proposal: r.proposal, proposalPath: r.proposalPath });
      return true;
    }

    if (p === "/api/cowork" && method === "POST") {
      const body = await readJson(req);
      const goal = String(body.goal || "").trim();
      if (!goal) { send(res, 400, { error: "missing goal" }); return true; }
      const { respond } = await import("../agent/agent.mjs");
      const result = await runOutcome(goal, {
        execute: async (step) => {
          const { text } = await respond([{ role: "user", content: `${step.title}: ${step.detail}` }]);
          return { ok: true, note: text.slice(0, 400) };
        },
        onProgress: (e) => ctx.publish?.({ type: "cowork", phase: e.phase, step: e.step?.title }),
      });
      send(res, 200, result);
      return true;
    }

    send(res, 404, { error: `no api route ${method} ${p}` });
    return true;
  } catch (e) {
    send(res, 500, { error: String(e?.message || e) });
    return true;
  }
}
