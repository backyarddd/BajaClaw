// MCP server that exposes BajaClaw state. Phase 1 ships a stub that starts,
// responds to health, and returns a minimal resource listing. Phase 4 fills
// in the remaining resources and tools without changing this signature.
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { bajaclawHome } from "../paths.js";
import { openDb } from "../db.js";
import { recall, listRecent } from "../memory/recall.js";
import { loadAllSkills } from "../skills/loader.js";

export interface ServeOptions {
  profile?: string;
  port?: number;
  stdio?: boolean;
}

export async function serve(opts: ServeOptions = {}): Promise<void> {
  if (opts.stdio || (!opts.port && !opts.stdio)) {
    return serveStdio(opts.profile);
  }
  return serveSse(opts.profile, opts.port!);
}

async function serveStdio(profile?: string): Promise<void> {
  process.stdin.setEncoding("utf8");
  let buf = "";
  process.stdin.on("data", (chunk) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        const resp = handleJsonRpc(msg, profile);
        if (resp) process.stdout.write(JSON.stringify(resp) + "\n");
      } catch (e) {
        process.stdout.write(JSON.stringify({
          jsonrpc: "2.0", id: null,
          error: { code: -32700, message: "Parse error: " + (e as Error).message },
        }) + "\n");
      }
    }
  });
  process.stdin.on("end", () => process.exit(0));
  // Announce server capabilities on init handshake handled in handleJsonRpc.
  await new Promise(() => {});
}

function serveSse(profile: string | undefined, port: number): Promise<void> {
  return new Promise((resolve) => {
    const srv = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok", profile: profile ?? null }));
        return;
      }
      if (req.method === "POST" && req.url === "/rpc") {
        let body = "";
        req.on("data", (c) => { body += c; });
        req.on("end", () => {
          try {
            const msg = JSON.parse(body);
            const resp = handleJsonRpc(msg, profile);
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify(resp ?? { jsonrpc: "2.0", id: msg.id ?? null, result: null }));
          } catch (e) {
            res.writeHead(400);
            res.end((e as Error).message);
          }
        });
        return;
      }
      res.writeHead(404); res.end();
    });
    srv.listen(port, () => {
      console.log(`bajaclaw mcp sse listening on http://localhost:${port}/`);
      resolve();
    });
  });
}

function handleJsonRpc(msg: {
  jsonrpc?: string; id?: number | string | null; method?: string; params?: unknown;
}, profile?: string): unknown {
  const id = msg.id ?? null;
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const err = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

  switch (msg.method) {
    case "initialize":
      return reply({
        protocolVersion: "2024-11-05",
        serverInfo: { name: "bajaclaw", version: "0.1.0" },
        capabilities: { resources: {}, tools: {} },
      });
    case "resources/list":
      return reply({ resources: listResources() });
    case "resources/read":
      return reply({ contents: readResource((msg.params as { uri?: string })?.uri ?? "", profile) });
    case "tools/list":
      return reply({ tools: listTools() });
    case "tools/call":
      return reply(callTool(msg.params as { name?: string; arguments?: Record<string, unknown> } | undefined));
    case "ping":
      return reply({});
    default:
      return err(-32601, `Method not found: ${msg.method}`);
  }
}

function listResources() {
  const profiles = listProfiles();
  const out: { uri: string; name: string; description?: string }[] = [
    { uri: "bajaclaw://profiles", name: "Profiles", description: "List of configured profiles" },
  ];
  for (const p of profiles) {
    out.push({ uri: `bajaclaw://profile/${p}/agents`, name: `Agents of ${p}` });
    out.push({ uri: `bajaclaw://profile/${p}/memories`, name: `Memories of ${p}` });
    out.push({ uri: `bajaclaw://profile/${p}/cycles`, name: `Cycles of ${p}` });
    out.push({ uri: `bajaclaw://profile/${p}/schedules`, name: `Schedules of ${p}` });
  }
  return out;
}

function readResource(uri: string, defaultProfile?: string): { uri: string; text: string; mimeType: string }[] {
  if (uri === "bajaclaw://profiles") {
    return [{ uri, text: JSON.stringify(listProfiles(), null, 2), mimeType: "application/json" }];
  }
  const m = uri.match(/^bajaclaw:\/\/profile\/([^/]+)\/(\w+)$/);
  if (!m) return [{ uri, text: "not found", mimeType: "text/plain" }];
  const profile = m[1]!;
  const kind = m[2]!;
  try {
    const db = openDb(profile);
    try {
      if (kind === "memories") {
        return [{ uri, text: JSON.stringify(listRecent(db, 100), null, 2), mimeType: "application/json" }];
      }
      if (kind === "cycles") {
        const rows = db.prepare("SELECT * FROM cycles ORDER BY id DESC LIMIT 50").all();
        return [{ uri, text: JSON.stringify(rows, null, 2), mimeType: "application/json" }];
      }
      if (kind === "schedules") {
        const rows = db.prepare("SELECT * FROM schedules").all();
        return [{ uri, text: JSON.stringify(rows, null, 2), mimeType: "application/json" }];
      }
      if (kind === "agents") {
        return [{ uri, text: JSON.stringify([profile], null, 2), mimeType: "application/json" }];
      }
    } finally { db.close(); }
  } catch (e) {
    return [{ uri, text: `error: ${(e as Error).message}`, mimeType: "text/plain" }];
  }
  return [{ uri, text: "unknown resource", mimeType: "text/plain" }];
}

function listTools() {
  return [
    {
      name: "bajaclaw_memory_search",
      description: "Full-text search BajaClaw memories for a profile",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
          profile: { type: "string" },
        },
        required: ["query"],
      },
    },
    {
      name: "bajaclaw_task_create",
      description: "Enqueue a task for a BajaClaw agent",
      inputSchema: {
        type: "object",
        properties: {
          agent: { type: "string" },
          task: { type: "string" },
          priority: { type: "string", enum: ["high", "normal", "low"] },
        },
        required: ["agent", "task"],
      },
    },
    {
      name: "bajaclaw_agent_status",
      description: "Report cycle counts + last run for an agent",
      inputSchema: { type: "object", properties: { agent: { type: "string" } }, required: ["agent"] },
    },
    {
      name: "bajaclaw_skill_list",
      description: "List skills visible to BajaClaw (all scopes)",
      inputSchema: { type: "object", properties: { profile: { type: "string" } } },
    },
  ];
}

function callTool(params: { name?: string; arguments?: Record<string, unknown> } | undefined) {
  const name = params?.name ?? "";
  const args = params?.arguments ?? {};
  try {
    if (name === "bajaclaw_memory_search") {
      const profile = String(args.profile ?? firstProfile() ?? "");
      if (!profile) return toolErr("no profile available");
      const db = openDb(profile);
      try {
        const res = recall(db, String(args.query ?? ""), Number(args.limit ?? 10));
        return toolOk(JSON.stringify(res, null, 2));
      } finally { db.close(); }
    }
    if (name === "bajaclaw_task_create") {
      const profile = String(args.agent ?? "");
      const body = String(args.task ?? "");
      const priority = String(args.priority ?? "normal");
      if (!profile || !body) return toolErr("agent and task are required");
      const db = openDb(profile);
      try {
        db.prepare(
          "INSERT INTO tasks(created_at, priority, status, body, source) VALUES(?,?,?,?,?)"
        ).run(new Date().toISOString(), priority, "pending", body, "mcp");
        return toolOk("enqueued");
      } finally { db.close(); }
    }
    if (name === "bajaclaw_agent_status") {
      const profile = String(args.agent ?? "");
      const db = openDb(profile);
      try {
        const row = db.prepare("SELECT COUNT(*) as c, MAX(started_at) as last FROM cycles").get() as { c: number; last: string | null };
        return toolOk(JSON.stringify(row));
      } finally { db.close(); }
    }
    if (name === "bajaclaw_skill_list") {
      const profile = String(args.profile ?? firstProfile() ?? "");
      const skills = loadAllSkills(profile).map((s) => ({ name: s.name, scope: s.scope, description: s.description }));
      return toolOk(JSON.stringify(skills, null, 2));
    }
  } catch (e) {
    return toolErr((e as Error).message);
  }
  return toolErr(`unknown tool: ${name}`);
}

function toolOk(text: string) { return { content: [{ type: "text", text }], isError: false }; }
function toolErr(message: string) { return { content: [{ type: "text", text: message }], isError: true }; }

function listProfiles(): string[] {
  const dir = join(bajaclawHome(), "profiles");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => existsSync(join(dir, n, "config.json")));
}
function firstProfile(): string | null {
  const all = listProfiles();
  return all[0] ?? null;
}
