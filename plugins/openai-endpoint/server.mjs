// Local OpenAI-compatible endpoint. Exposes BajaClaw as a local LLM so other
// programs can point their OpenAI client at it. Zero deps (node:http + fetch).
// Standalone: routes to BajaClaw's native agent (no OpenClaw).
//
// Routes: GET /health, GET /v1/models, POST /v1/chat/completions (stream + json).
import http from "node:http";
import { streamRespond } from "../../src/agent/agent.mjs";
import { REGISTRY } from "../../src/llm/client.mjs";

const MODELS = [
  { id: "bajaclaw", owned_by: "bajaclaw" },
  { id: "bajaclaw-chatgpt", owned_by: "bajaclaw" },
  { id: "bajaclaw-fast", owned_by: "bajaclaw" },
];

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
    "access-control-allow-origin": "*",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function nowId(prefix = "chatcmpl") {
  nowId._n = (nowId._n || 0) + 1;
  return `${prefix}-${Date.now().toString(36)}${nowId._n}`;
}

function chatEnvelope(model, content, finish = "stop") {
  return {
    id: nowId(), object: "chat.completion", created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finish }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}
function streamChunk(id, model, delta, finish = null) {
  return "data: " + JSON.stringify({
    id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  }) + "\n\n";
}

// Map an OpenAI model alias to a provider hint (bajaclaw-chatgpt forces ChatGPT).
function modelHint(model) {
  if (model === "bajaclaw-chatgpt") return { model: REGISTRY["openai-codex"].defaultModel };
  return {};
}

async function handleChat(req, res, cfg) {
  const body = await readBody(req);
  const model = body.model || "bajaclaw";
  const wantStream = !!body.stream;
  const messages = body.messages || [];

  // Optional passthrough to an explicit OpenAI-compatible upstream.
  const up = cfg.openaiEndpoint?.upstream;
  if (up?.url) {
    const headers = { "content-type": "application/json" };
    if (up.key) headers.authorization = `Bearer ${up.key}`;
    const r = await fetch(up.url, { method: "POST", headers, body: JSON.stringify(body) });
    res.writeHead(r.status, { "content-type": r.headers.get("content-type") || "application/json", "access-control-allow-origin": "*" });
    if (r.body) { const rd = r.body.getReader(); for (;;) { const { done, value } = await rd.read(); if (done) break; res.write(value); } }
    return res.end();
  }

  if (!wantStream) {
    let content = "";
    for await (const c of streamRespond(messages, modelHint(model))) {
      if (c.delta) content += c.delta;
      else if (c.text) content = c.text;
    }
    return json(res, 200, chatEnvelope(model, content));
  }

  res.writeHead(200, {
    "content-type": "text/event-stream", "cache-control": "no-cache",
    connection: "keep-alive", "access-control-allow-origin": "*",
  });
  const id = nowId();
  res.write(streamChunk(id, model, { role: "assistant" }));
  for await (const c of streamRespond(messages, modelHint(model))) {
    const piece = c.delta ?? c.text;
    if (piece) res.write(streamChunk(id, model, { content: piece }));
  }
  res.write(streamChunk(id, model, {}, "stop"));
  res.write("data: [DONE]\n\n");
  res.end();
}

export function createServer(cfg) {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "authorization,content-type",
        });
        return res.end();
      }
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/health") return json(res, 200, { status: "ok", service: "bajaclaw-openai-endpoint" });
      if (url.pathname === "/v1/models") {
        return json(res, 200, { object: "list", data: MODELS.map((m) => ({ ...m, object: "model", created: 0 })) });
      }
      if (url.pathname === "/v1/chat/completions" && req.method === "POST") return await handleChat(req, res, cfg);
      return json(res, 404, { error: { message: `no route ${req.method} ${url.pathname}`, type: "not_found" } });
    } catch (e) {
      return json(res, 500, { error: { message: String(e?.message || e), type: "server_error" } });
    }
  });
}

export function startEndpoint(cfg, { onListen } = {}) {
  const ep = cfg.openaiEndpoint;
  const server = createServer(cfg);
  server.listen(ep.port, ep.host, () => onListen?.(ep));
  return server;
}
