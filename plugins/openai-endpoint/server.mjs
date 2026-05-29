// Local OpenAI-compatible endpoint. Exposes BajaClaw as a local LLM so other
// programs can point their OpenAI client at it. Zero deps (node:http + fetch).
//
// Routes: GET /health, GET /v1/models, POST /v1/chat/completions (stream + json).
// Backend resolution (in order):
//   1. config.openaiEndpoint.upstream  -> any OpenAI-compatible URL (+ key)
//   2. the OpenClaw gateway, if reachable
//   3. mock echo (keeps the surface usable/testable before login)
import http from "node:http";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";

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
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function nowId(prefix = "chatcmpl") {
  // No Math.random reliance for determinism in tests; time + counter.
  nowId._n = (nowId._n || 0) + 1;
  return `${prefix}-${Date.now().toString(36)}${nowId._n}`;
}

// Is any OpenClaw provider logged in? Cheap heuristic: a non-empty
// auth-profiles.json under ~/.openclaw. Avoids hanging the agent bridge when
// the user hasn't signed in yet.
function openclawLoggedIn() {
  const base = join(homedir(), ".openclaw", "agents");
  if (!existsSync(base)) return false;
  try {
    for (const agent of readdirSync(base)) {
      const f = join(base, agent, "agent", "auth-profiles.json");
      if (existsSync(f)) {
        const j = JSON.parse(readFileSync(f, "utf8"));
        if (j?.profiles && Object.keys(j.profiles).length) return true;
      }
    }
  } catch { /* ignore */ }
  return false;
}

function resolveBackend(cfg) {
  const ep = cfg.openaiEndpoint || {};
  if (ep.upstream?.url) {
    return { type: "openai-compatible", url: ep.upstream.url, key: ep.upstream.key };
  }
  // Bridge to the real agent (uses the configured provider) once signed in.
  if (ep.useAgentBridge !== false && openclawLoggedIn()) {
    return { type: "openclaw-agent" };
  }
  return { type: "mock" };
}

// Run one agent turn through OpenClaw using the configured provider.
function runAgentTurn(prompt, { model } = {}) {
  return new Promise((resolve, reject) => {
    const args = ["agent", "--json", "--message", prompt, "--timeout", "120"];
    if (model && model !== "bajaclaw" && model !== "bajaclaw-fast" && model !== "bajaclaw-chatgpt") {
      args.push("--model", model);
    }
    execFile("openclaw", args, { timeout: 130000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      const text = stdout.trim();
      try {
        const j = JSON.parse(text);
        resolve(j.reply ?? j.text ?? j.message ?? j.content ?? j.output ?? text);
      } catch {
        resolve(text); // not JSON; return raw
      }
    });
  });
}

function mockCompletion(reqBody) {
  const last = [...(reqBody.messages || [])].reverse().find((m) => m.role === "user");
  const text =
    `BajaClaw (mock backend - sign in via \`bajaclaw onboard\` to use a real model). ` +
    `You said: ${last?.content ?? "(nothing)"}`;
  return text;
}

function chatEnvelope(model, content, finish = "stop") {
  return {
    id: nowId(),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      { index: 0, message: { role: "assistant", content }, finish_reason: finish },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

function streamChunk(id, model, delta, finish = null) {
  return (
    "data: " +
    JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta, finish_reason: finish }],
    }) +
    "\n\n"
  );
}

async function handleChat(req, res, cfg) {
  const body = await readBody(req);
  const model = body.model || "bajaclaw";
  const wantStream = !!body.stream;
  const backend = resolveBackend(cfg);

  // Passthrough to an explicit OpenAI-compatible upstream (verbatim, streamed).
  if (backend.type === "openai-compatible") {
    const headers = { "content-type": "application/json" };
    if (backend.key) headers.authorization = `Bearer ${backend.key}`;
    const up = await fetch(backend.url, { method: "POST", headers, body: JSON.stringify(body) });
    res.writeHead(up.status, {
      "content-type": up.headers.get("content-type") || "application/json",
      "access-control-allow-origin": "*",
    });
    if (up.body) {
      const reader = up.body.getReader();
      for (;;) { const { done, value } = await reader.read(); if (done) break; res.write(value); }
    }
    res.end();
    return;
  }

  // Real model via the OpenClaw agent (configured provider). Falls back to mock
  // if the turn fails (e.g. not signed in yet).
  let content;
  if (backend.type === "openclaw-agent") {
    const last = [...(body.messages || [])].reverse().find((m) => m.role === "user");
    try {
      content = await runAgentTurn(last?.content ?? "", { model });
    } catch {
      content = mockCompletion(body);
    }
  } else {
    content = mockCompletion(body);
  }

  if (!wantStream) return json(res, 200, chatEnvelope(model, content));

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "access-control-allow-origin": "*",
  });
  const id = nowId();
  res.write(streamChunk(id, model, { role: "assistant" }));
  for (const word of content.split(" ")) {
    res.write(streamChunk(id, model, { content: word + " " }));
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
        return json(res, 200, {
          object: "list",
          data: MODELS.map((m) => ({ ...m, object: "model", created: 0 })),
        });
      }
      if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
        return await handleChat(req, res, cfg);
      }
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
