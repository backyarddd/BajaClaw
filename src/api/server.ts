// HTTP server exposing BajaClaw as an OpenAI-compatible API.
//
// Endpoints:
//   GET  /health
//   GET  /v1/models                    — lists exposed profiles as models
//   POST /v1/chat/completions          — OpenAI chat (stream + non-stream)
//   POST /v1/bajaclaw/cycle            — native: { profile, task } -> full CycleOutput
//   POST /v1/bajaclaw/tasks            — native: enqueue without waiting
//
// Auth: if config.api.apiKey is set, require `Authorization: Bearer <key>`.
// Bind: defaults to 127.0.0.1 unless config.api.host is explicit.

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
  type Server,
} from "node:http";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { bajaclawHome } from "../paths.js";
import { loadConfig } from "../config.js";
import { runCycle } from "../agent.js";
import { openDb } from "../db.js";
import {
  taskFromMessages,
  resolveRequest,
  cycleToCompletion,
  chunkText,
  makeChunk,
  type OpenAIChatRequest,
} from "./translate.js";
import { KNOWN_MODELS } from "../model-picker.js";

export interface ApiConfig {
  host?: string;
  port?: number;
  apiKey?: string | null;
  // Allowlist of profile names. Empty/undefined = expose all profiles.
  exposedProfiles?: string[];
  // Delay per pseudo-streaming chunk in ms (word-grouping keeps perceived smoothness).
  streamDelayMs?: number;
}

export interface ServeOptions extends ApiConfig {
  onReady?: (addr: { host: string; port: number }) => void;
}

const DEFAULT_PORT = 8765;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_STREAM_DELAY_MS = 20;

export function serveApi(opts: ServeOptions = {}): Server {
  const host = opts.host ?? DEFAULT_HOST;
  const port = opts.port ?? DEFAULT_PORT;

  const srv = createServer((req, res) => {
    // Accept + CORS preflight.
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    res.setHeader("access-control-allow-headers", "authorization,content-type");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    handle(req, res, opts).catch((err) => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
      }
      res.end(JSON.stringify({ error: { message: (err as Error).message, type: "server_error" } }));
    });
  });

  srv.listen(port, host, () => {
    opts.onReady?.({ host, port });
  });

  return srv;
}

async function handle(req: IncomingMessage, res: ServerResponse, opts: ServeOptions): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/health") return sendJson(res, 200, { status: "ok" });

  if (!checkAuth(req, res, opts.apiKey)) return;

  if (req.method === "GET" && url.pathname === "/v1/models") {
    return sendJson(res, 200, { object: "list", data: listProfilesAsModels(opts.exposedProfiles) });
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    const body = await readJson<OpenAIChatRequest>(req);
    return handleChat(res, body, opts);
  }

  if (req.method === "POST" && url.pathname === "/v1/bajaclaw/cycle") {
    const body = await readJson<{ profile?: string; task?: string; dryRun?: boolean }>(req);
    const profile = body.profile ?? "default";
    if (!profileExposed(profile, opts.exposedProfiles)) return sendJson(res, 404, err("unknown profile"));
    const out = await runCycle({ profile, task: body.task, dryRun: !!body.dryRun });
    return sendJson(res, 200, out);
  }

  if (req.method === "POST" && url.pathname === "/v1/bajaclaw/tasks") {
    const body = await readJson<{ profile?: string; task?: string; priority?: "high" | "normal" | "low" }>(req);
    const profile = body.profile ?? "default";
    if (!profileExposed(profile, opts.exposedProfiles)) return sendJson(res, 404, err("unknown profile"));
    const db = openDb(profile);
    try {
      db.prepare(
        "INSERT INTO tasks(created_at, priority, status, body, source) VALUES(?,?,?,?,?)"
      ).run(new Date().toISOString(), body.priority ?? "normal", "pending", body.task ?? "", "api");
    } finally { db.close(); }
    return sendJson(res, 202, { status: "enqueued" });
  }

  sendJson(res, 404, err("not found"));
}

async function handleChat(
  res: ServerResponse,
  body: OpenAIChatRequest,
  opts: ServeOptions,
): Promise<void> {
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    return sendJson(res, 400, err("messages[] required"));
  }
  const resolved = resolveRequest(body.model ?? "default");
  if (!profileExposed(resolved.profile, opts.exposedProfiles)) {
    return sendJson(res, 404, err(`unknown profile: ${resolved.profile}`));
  }

  const task = taskFromMessages(body.messages);
  const wantStream = !!body.stream;

  if (!wantStream) {
    const out = await runCycle({ profile: resolved.profile, task, modelOverride: resolved.modelOverride });
    const completion = cycleToCompletion(body.model ?? resolved.profile, out);
    return sendJson(res, 200, completion);
  }

  // SSE pseudo-stream: run the cycle to completion, then chunk.
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });

  const id = `chatcmpl-bc-${Date.now()}`;
  const model = body.model ?? resolved.profile;
  const delay = opts.streamDelayMs ?? DEFAULT_STREAM_DELAY_MS;

  writeEvent(res, makeChunk(id, model, { role: "assistant" }));

  try {
    const out = await runCycle({ profile: resolved.profile, task, modelOverride: resolved.modelOverride });
    if (!out.ok) {
      writeEvent(res, makeChunk(id, model, { content: out.text || out.error || "error" }, "error"));
    } else {
      const chunks = chunkText(out.text);
      for (const c of chunks) {
        writeEvent(res, makeChunk(id, model, { content: c }));
        if (delay > 0) await sleep(delay);
      }
      writeEvent(res, makeChunk(id, model, {}, "stop"));
    }
  } catch (e) {
    writeEvent(res, makeChunk(id, model, { content: (e as Error).message }, "error"));
  }
  res.write("data: [DONE]\n\n");
  res.end();
}

function listProfilesAsModels(exposed?: string[]): { id: string; object: "model"; created: number; owned_by: "bajaclaw" }[] {
  const dir = join(bajaclawHome(), "profiles");
  if (!existsSync(dir)) return [];
  const all = readdirSync(dir).filter((n) => existsSync(join(dir, n, "config.json")));
  const filter = exposed && exposed.length > 0 ? new Set(exposed) : null;
  const names = filter ? all.filter((n) => filter.has(n)) : all;
  const now = Math.floor(Date.now() / 1000);
  const out: { id: string; object: "model"; created: number; owned_by: "bajaclaw" }[] = [];

  // Bare profile names — use each profile's configured model.
  for (const id of names) {
    out.push({ id, object: "model", created: now, owned_by: "bajaclaw" });
  }

  // profile:model virtual entries — pick any model per request without
  // touching profile config.
  for (const id of names) {
    for (const m of KNOWN_MODELS) {
      out.push({ id: `${id}:${m.id}`, object: "model", created: now, owned_by: "bajaclaw" });
    }
  }

  // Bare model-id shortcuts — apply to the default profile.
  if (names.includes("default")) {
    for (const m of KNOWN_MODELS) {
      out.push({ id: m.id, object: "model", created: now, owned_by: "bajaclaw" });
    }
  }

  return out;
}

function profileExposed(profile: string, exposed?: string[]): boolean {
  if (!profileExists(profile)) return false;
  if (!exposed || exposed.length === 0) return true;
  return exposed.includes(profile);
}

function profileExists(profile: string): boolean {
  try { loadConfig(profile); return true; } catch { return false; }
}

function checkAuth(req: IncomingMessage, res: ServerResponse, apiKey: string | null | undefined): boolean {
  if (!apiKey) return true;
  const auth = req.headers["authorization"];
  if (typeof auth !== "string" || !auth.toLowerCase().startsWith("bearer ")) {
    sendJson(res, 401, err("missing bearer token"));
    return false;
  }
  const given = auth.slice("bearer ".length).trim();
  if (given !== apiKey) {
    sendJson(res, 401, err("invalid token"));
    return false;
  }
  return true;
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {} as T;
  return JSON.parse(raw) as T;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function err(msg: string): { error: { message: string; type: string } } {
  return { error: { message: msg, type: "invalid_request_error" } };
}

function writeEvent(res: ServerResponse, event: unknown): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
