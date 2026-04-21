import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { loadConfig, saveConfig } from "../config.js";
import { loadPersona } from "../persona-io.js";
import { isDaemonRunning } from "./daemon.js";
import { bajaclawHome, profileLogDir } from "../paths.js";
import { openDb } from "../db.js";
import { listRecent } from "../memory/recall.js";
import { runCycle } from "../agent.js";
import { sendProgressToSource, broadcastToProfile, sendAttachmentToSource, broadcastAttachmentToProfile } from "../channels/gateway.js";
import { loadAllSkillsRaw, runtimeSkipReason } from "../skills/loader.js";
import { currentVersion } from "../updater.js";
import type { AgentConfig, ChannelConfig } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Candidate locations for dashboard.html, resolved per-request so HTML
// edits hot-reload (see `sendHtml` below - no cache on the body).
//
// - When running from the dev checkout, the TypeScript source sits in
//   `src/` while the compiled JS lands in `dist/`. We prefer
//   `src/dashboard.html` so unsaved edits in the checkout land in the
//   served page on the next refresh, no build step needed.
// - The npm tarball only ships `dist/` (see package.json `files`), so
//   we also look under `dist/`. `scripts/copy-static.js` copies
//   `src/dashboard.html` into `dist/` at build time.
const DASHBOARD_HTML_CANDIDATES = [
  join(__dirname, "..", "..", "src", "dashboard.html"),
  join(__dirname, "..", "dashboard.html"),
];

// Daemon start time - when the dashboard starts in-process, we capture
// it for the /api/status uptime readout.
const START_TIME = Date.now();

export async function runDashboard(profile: string): Promise<void> {
  const cfg = loadConfig(profile);
  const port = cfg.dashboardPort ?? 7337;
  const srv = createServer((req, res) => route(req, res, profile));
  srv.listen(port, () => {
    console.log(chalk.green(`✓ dashboard: http://localhost:${port}/`));
  });
}

/** Start the dashboard in the background and return. Port-in-use is
 *  non-fatal - the caller gets an `ok: false` result to log. */
export async function startDashboardInProcess(profile: string): Promise<{
  port: number;
  ok: boolean;
  error?: string;
}> {
  const cfg = loadConfig(profile);
  const port = cfg.dashboardPort ?? 7337;
  return new Promise((resolve) => {
    const srv = createServer((req, res) => route(req, res, profile));
    srv.on("error", (err: NodeJS.ErrnoException) => {
      resolve({ port, ok: false, error: err.code === "EADDRINUSE" ? `port ${port} already in use` : err.message });
    });
    srv.listen(port, () => resolve({ port, ok: true }));
  });
}

function route(req: IncomingMessage, res: ServerResponse, profile: string): void {
  // Surface errors as JSON when the client is asking for JSON, HTML
  // otherwise. Saves the frontend from parsing error pages.
  const handler = async (): Promise<void> => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    // Static shell.
    if (method === "GET" && (url === "/" || url === "/index.html")) {
      return sendHtml(res);
    }

    // API routes.
    if (url.startsWith("/api/")) {
      await dispatchApi(req, res, profile, url, method);
      return;
    }

    res.writeHead(404); res.end();
  };
  handler().catch((err: Error) => {
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

async function dispatchApi(
  req: IncomingMessage,
  res: ServerResponse,
  profile: string,
  url: string,
  method: string,
): Promise<void> {
  // POST /api/chat - blocks until the cycle finishes and returns the
  // full result. Cycles are serialized per-profile by runCycle, so
  // concurrent dashboard chats queue behind each other.
  if (url === "/api/chat" && method === "POST") {
    const body = await readJson(req) as { message?: string };
    const task = (body.message ?? "").trim();
    if (!task) { json(res, { error: "empty message" }, 400); return; }
    const out = await runCycle({ profile, task });
    json(res, {
      ok: out.ok,
      text: out.text,
      cycleId: out.cycleId,
      costUsd: out.costUsd,
      inputTokens: out.inputTokens,
      outputTokens: out.outputTokens,
      turns: out.turns,
      durationMs: out.durationMs,
      model: out.model,
      tier: out.tier,
      error: out.error,
    });
    return;
  }

  // POST /api/progress - invoked by `bajaclaw say` from within a
  // running cycle. Forwards a short progress line back to the
  // originating channel so the user sees live updates without
  // waiting for the cycle to finish. Silently no-ops if the source
  // is missing or not a channel - dashboard/REPL cycles just drop it.
  if (url === "/api/progress" && method === "POST") {
    const body = await readJson(req) as { text?: string; source?: string };
    const text = (body.text ?? "").trim();
    if (!text) { json(res, { ok: false, error: "empty text" }, 400); return; }
    if (body.source) {
      sendProgressToSource(profile, body.source, text).catch(() => undefined);
    } else {
      broadcastToProfile(profile, text);
    }
    json(res, { ok: true });
    return;
  }

  // POST /api/attach - push an attachment to the originating channel
  // of a running cycle. Body: {path, source?, caption?}. When source
  // is set, attachments go to that channel; otherwise the last
  // active chat for the profile picks it up. Fails quiet.
  if (url === "/api/attach" && method === "POST") {
    const body = await readJson(req) as { path?: string; source?: string; caption?: string };
    const path = (body.path ?? "").trim();
    if (!path) { json(res, { ok: false, error: "empty path" }, 400); return; }
    try {
      let ok = false;
      if (body.source) ok = await sendAttachmentToSource(profile, body.source, path, body.caption);
      else ok = await broadcastAttachmentToProfile(profile, path, body.caption);
      json(res, { ok });
    } catch (e) {
      json(res, { ok: false, error: (e as Error).message }, 500);
    }
    return;
  }

  // GET /api/config - safe subset of AgentConfig for the UI.
  if (url === "/api/config" && method === "GET") {
    const cfg = loadConfig(profile);
    json(res, publicConfig(cfg));
    return;
  }

  // PUT /api/config - merges a safe subset onto the on-disk config.
  if (url === "/api/config" && method === "PUT") {
    const body = await readJson(req) as Partial<AgentConfig>;
    const cfg = loadConfig(profile);
    const next = mergeSafe(cfg, body);
    saveConfig(next);
    json(res, publicConfig(next));
    return;
  }

  // GET /api/status - daemon + gateway + version info.
  if (url === "/api/status" && method === "GET") {
    json(res, {
      profile,
      version: currentVersion(),
      uptimeMs: Date.now() - START_TIME,
      pid: process.pid,
      now: new Date().toISOString(),
    });
    return;
  }

  // GET /api/channels - configured channels with tokens masked.
  if (url === "/api/channels" && method === "GET") {
    const cfg = loadConfig(profile);
    json(res, (cfg.channels ?? []).map(maskChannel));
    return;
  }

  // DELETE /api/channels/:kind - remove a configured channel.
  const chDel = url.match(/^\/api\/channels\/(telegram|discord)$/);
  if (chDel && method === "DELETE") {
    const kind = chDel[1] as "telegram" | "discord";
    const cfg = loadConfig(profile);
    cfg.channels = (cfg.channels ?? []).filter((c) => c.kind !== kind);
    saveConfig(cfg);
    json(res, (cfg.channels ?? []).map(maskChannel));
    return;
  }

  // GET /api/clawhub/search?q=... - proxy to ClawHub registry search.
  // Never exposes a token or local state; just forwards the query and
  // returns a small subset of fields the UI renders.
  if (url.startsWith("/api/clawhub/search") && method === "GET") {
    const q = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`).searchParams.get("q") ?? "";
    if (!q.trim()) { json(res, { results: [] }); return; }
    try {
      const registry = (process.env.CLAWHUB_REGISTRY ?? "https://clawhub.ai").replace(/\/+$/, "");
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 10_000);
      const r = await fetch(`${registry}/api/v1/search?q=${encodeURIComponent(q)}`, { signal: ac.signal });
      clearTimeout(timer);
      if (!r.ok) { json(res, { results: [], error: `HTTP ${r.status}` }, r.status); return; }
      const body = await r.json() as { results?: Array<{ slug: string; displayName?: string; summary?: string; score?: number }> };
      const results = (body.results ?? []).slice(0, 25).map((it) => ({
        slug: it.slug,
        displayName: it.displayName ?? it.slug,
        summary: it.summary ?? "",
        score: it.score,
      }));
      json(res, { results });
    } catch (e) {
      json(res, { results: [], error: (e as Error).message }, 502);
    }
    return;
  }

  // POST /api/clawhub/install - install a ClawHub skill into the user scope.
  // Body: {"slug": "<slug>", "version": "<ver>"}. Shells out to
  // `bajaclaw skill install clawhub:<slug>[@ver]` with the confirm env
  // already set - the dashboard request itself counts as the confirm.
  if (url === "/api/clawhub/install" && method === "POST") {
    let body = "";
    req.on("data", (chunk) => body += chunk.toString());
    req.on("end", async () => {
      try {
        const parsed = JSON.parse(body || "{}") as { slug?: string; version?: string };
        const slug = String(parsed.slug ?? "").trim();
        if (!slug) { json(res, { ok: false, error: "slug required" }, 400); return; }
        const spec = parsed.version ? `clawhub:${slug}@${parsed.version}` : `clawhub:${slug}`;
        const { spawn } = await import("node:child_process");
        const binJs = join(__dirname, "..", "..", "bin", "bajaclaw.js");
        const proc = spawn(process.execPath, [binJs, "skill", "install", spec, "--yes"], {
          env: { ...process.env, BAJACLAW_CONFIRM: "yes" },
        });
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (d) => stdout += d.toString());
        proc.stderr.on("data", (d) => stderr += d.toString());
        proc.on("close", (code) => {
          if (code === 0) json(res, { ok: true, stdout });
          else json(res, { ok: false, stderr: stderr || stdout, code }, 500);
        });
      } catch (e) {
        json(res, { ok: false, error: (e as Error).message }, 500);
      }
    });
    return;
  }

  // GET /api/skills - active + inactive skills with origin.
  if (url === "/api/skills" && method === "GET") {
    const skills = loadAllSkillsRaw(profile);
    json(res, skills.map((s) => ({
      name: s.name,
      description: s.description,
      origin: s.origin ?? "bajaclaw",
      scope: s.scope,
      version: s.version,
      tags: s.tags,
      requiredBins: s.requiredBins,
      platforms: s.platforms,
      homepage: s.homepage,
      inactive: !!runtimeSkipReason(s),
      inactiveReason: runtimeSkipReason(s),
    })));
    return;
  }

  // GET /api/profiles - list all profiles with summary stats.
  if (url === "/api/profiles" && method === "GET") {
    const profilesDir = join(bajaclawHome(), "profiles");
    const profiles: object[] = [];
    if (existsSync(profilesDir)) {
      const entries = readdirSync(profilesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const name = entry.name;
        try {
          const cfg = loadConfig(name);
          const persona = loadPersona(name);
          const pdb = openDb(name);
          const since24 = new Date(Date.now() - 86400000).toISOString();
          const lastCycle = pdb.prepare(
            "SELECT id, started_at, finished_at, status, task, cost_usd, turns FROM cycles ORDER BY id DESC LIMIT 1"
          ).get() as Record<string, unknown> | undefined;
          const pending = (pdb.prepare("SELECT COUNT(*) c FROM tasks WHERE status='pending'").get() as { c: number }).c;
          const cyclesDay = (pdb.prepare("SELECT COUNT(*) c FROM cycles WHERE status='ok' AND started_at > ?").get(since24) as { c: number }).c;
          // "cycle mid-flight" - transient, useful for the spinner but
          // NOT the right signal for the "running" badge. Time-box
          // against 15m so a cycle row that got wedged in 'running'
          // state (daemon crash, chat Ctrl-C mid-cycle, etc.) doesn't
          // spuriously light the indicator forever.
          const inflightSince = new Date(Date.now() - 15 * 60 * 1000).toISOString();
          const cycleInFlight = (pdb.prepare(
            "SELECT COUNT(*) c FROM cycles WHERE status='running' AND started_at > ?"
          ).get(inflightSince) as { c: number }).c > 0;
          pdb.close();
          // `running` now means "the daemon process for this profile
          // is alive" - a persistent state, not the blink-and-miss-it
          // window between `started_at` and `finished_at`. Prior to
          // v0.14.26 this was tied to the in-flight cycle count, so
          // the badge lit up for a profile that happened to have a
          // stale cycle row and was dark for a profile whose daemon
          // was running but idle.
          profiles.push({
            name,
            agentName: persona?.agentName ?? cfg.name,
            model: String(cfg.model ?? "auto"),
            lastCycle: lastCycle ?? null,
            lastCycleAt: lastCycle ? (lastCycle.started_at as string) : null,
            pendingTasks: pending,
            cyclesDay,
            running: isDaemonRunning(name),
            cycleInFlight,
          });
        } catch { /* skip invalid profiles */ }
      }
    }
    return json(res, profiles);
  }

  // POST /api/profile/:name/chat - run a cycle on any profile from the UI.
  const profileChatMatch = url.match(/^\/api\/profile\/([^/]+)\/chat$/);
  if (profileChatMatch && method === "POST") {
    const targetProfile = decodeURIComponent(profileChatMatch[1] ?? "");
    const body = await readJson(req) as { message?: string };
    const task = (body.message ?? "").trim();
    if (!task) { json(res, { error: "empty message" }, 400); return; }
    const out = await runCycle({ profile: targetProfile, task });
    json(res, {
      ok: out.ok,
      text: out.text,
      cycleId: out.cycleId,
      costUsd: out.costUsd,
      inputTokens: out.inputTokens,
      outputTokens: out.outputTokens,
      turns: out.turns,
      durationMs: out.durationMs,
      model: out.model,
      tier: out.tier,
      error: out.error,
    });
    return;
  }

  // POST /api/profile/:name/task - enqueue a task without waiting.
  const profileTaskMatch = url.match(/^\/api\/profile\/([^/]+)\/task$/);
  if (profileTaskMatch && method === "POST") {
    const targetProfile = decodeURIComponent(profileTaskMatch[1] ?? "");
    const body = await readJson(req) as { task?: string; priority?: string };
    const task = (body.task ?? "").trim();
    if (!task) { json(res, { error: "empty task" }, 400); return; }
    const tdb = openDb(targetProfile);
    try {
      const result = tdb.prepare(
        "INSERT INTO tasks (created_at, priority, status, body, source) VALUES (?, ?, 'pending', ?, 'dashboard')"
      ).run(new Date().toISOString(), body.priority ?? "normal", task);
      json(res, { ok: true, taskId: result.lastInsertRowid });
    } finally { tdb.close(); }
    return;
  }

  // GET /api/logs?lines=200&level=error,warn - read recent jsonl log
  // entries from the profile's log dir. Merges across the latest
  // files so a mid-night roll-over doesn't hide context.
  if (url.startsWith("/api/logs") && method === "GET") {
    const q = new URL(url, "http://x").searchParams;
    const lines = Math.min(1000, Math.max(1, parseInt(q.get("lines") ?? "200", 10)));
    const levels = (q.get("level") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    json(res, readRecentLogs(profile, lines, levels));
    return;
  }

  // GET /api/cycles/:id - full detail for one cycle. Include prompt
  // preview, response preview, raw error text, timing, cost.
  const cycleIdMatch = url.match(/^\/api\/cycles\/(\d+)$/);
  if (cycleIdMatch && method === "GET") {
    const id = Number(cycleIdMatch[1]);
    const cdb = openDb(profile);
    try {
      const row = cdb.prepare("SELECT * FROM cycles WHERE id = ?").get(id);
      if (!row) { json(res, { error: "not found" }, 404); return; }
      const task = cdb.prepare("SELECT * FROM tasks WHERE cycle_id = ?").get(id);
      json(res, { cycle: row, task });
    } finally { cdb.close(); }
    return;
  }

  // Existing DB-backed read endpoints.
  const db = openDb(profile);
  try {
    if (url === "/api/cycles" && method === "GET") {
      return json(res, db.prepare("SELECT * FROM cycles ORDER BY id DESC LIMIT 50").all());
    }
    if (url === "/api/memories" && method === "GET") {
      return json(res, listRecent(db, 100));
    }
    if (url === "/api/schedules" && method === "GET") {
      return json(res, db.prepare("SELECT * FROM schedules").all());
    }
    if (url === "/api/tasks" && method === "GET") {
      return json(res, db.prepare("SELECT * FROM tasks ORDER BY id DESC LIMIT 100").all());
    }
    if (url === "/api/summary" && method === "GET") {
      const since24 = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const all = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(cost_usd),0) cost, COALESCE(SUM(input_tokens),0) inTok, COALESCE(SUM(output_tokens),0) outTok FROM cycles WHERE status='ok'").get() as { c: number; cost: number; inTok: number; outTok: number };
      const day = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(cost_usd),0) cost FROM cycles WHERE status='ok' AND started_at > ?").get(since24) as { c: number; cost: number };
      const week = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(cost_usd),0) cost FROM cycles WHERE status='ok' AND started_at > ?").get(since7d) as { c: number; cost: number };
      const memCount = (db.prepare("SELECT COUNT(*) c FROM memories").get() as { c: number }).c;
      const pending = (db.prepare("SELECT COUNT(*) c FROM tasks WHERE status='pending'").get() as { c: number }).c;
      return json(res, {
        profile,
        cycles: all.c,
        cyclesDay: day.c,
        cyclesWeek: week.c,
        totalCostUsd: all.cost,
        costDayUsd: day.cost,
        costWeekUsd: week.cost,
        inputTokens: all.inTok,
        outputTokens: all.outTok,
        memories: memCount,
        pendingTasks: pending,
      });
    }
  } finally { db.close(); }

  res.writeHead(404); res.end();
}

// ── Request helpers ────────────────────────────────────────────────

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      if (buf.length > 1_000_000) { req.destroy(); reject(new Error("request body too large")); }
    });
    req.on("end", () => {
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); }
      catch (e) { reject(new Error(`invalid JSON body: ${(e as Error).message}`)); }
    });
    req.on("error", reject);
  });
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

function sendHtml(res: ServerResponse): void {
  // Re-resolved every request. Supports hot-reloading HTML edits in
  // the dev checkout (no daemon restart needed) and still works from
  // the npm package where the file is shipped under `dist/`.
  let body: string | undefined;
  for (const path of DASHBOARD_HTML_CANDIDATES) {
    if (existsSync(path)) {
      body = readFileSync(path, "utf8");
      break;
    }
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(body ?? fallbackHtml());
}

function fallbackHtml(): string {
  return `<!doctype html><html><body style="font-family:system-ui;background:#09090B;color:#F0F0F3;padding:2rem">
<h1>BajaClaw Dashboard</h1><p>dashboard.html not found - run <code>npm run build</code>.</p>
</body></html>`;
}

// ── Config shaping ─────────────────────────────────────────────────

// Fields the UI is allowed to see. Channels, tools, anything touching
// auth is left off - the API is localhost-only but treat leaks
// conservatively anyway.
interface PublicConfig {
  profile: string;
  name: string;
  model: string;
  effort: string;
  contextWindow: "200k" | "1m";
  dashboardPort: number;
  dashboardAutostart: boolean;
  memorySync: boolean;
  maxBudgetUsd?: number;
  compaction: {
    enabled: boolean;
    threshold: number;
    schedule: string;
    keepRecentPerKind: number;
    pruneCycleDays: number;
  };
}

function publicConfig(cfg: AgentConfig): PublicConfig {
  return {
    profile: cfg.profile,
    name: cfg.name,
    model: String(cfg.model ?? "auto"),
    effort: cfg.effort,
    contextWindow: cfg.contextWindow ?? "200k",
    dashboardPort: cfg.dashboardPort ?? 7337,
    dashboardAutostart: cfg.dashboardAutostart ?? true,
    memorySync: cfg.memorySync ?? false,
    maxBudgetUsd: cfg.maxBudgetUsd,
    compaction: {
      enabled: cfg.compaction?.enabled ?? true,
      threshold: cfg.compaction?.threshold ?? 0.75,
      schedule: cfg.compaction?.schedule ?? "both",
      keepRecentPerKind: cfg.compaction?.keepRecentPerKind ?? 25,
      pruneCycleDays: cfg.compaction?.pruneCycleDays ?? 30,
    },
  };
}

// Whitelist of fields the PUT /api/config endpoint will merge. Anything
// else is silently ignored - prevents an injection from rewriting e.g.
// the allowedTools list via the dashboard.
const ALLOWED_FIELDS = new Set<keyof AgentConfig>([
  "model", "effort", "contextWindow", "dashboardPort",
  "dashboardAutostart", "memorySync", "maxBudgetUsd",
]);

function mergeSafe(cfg: AgentConfig, patch: Partial<AgentConfig>): AgentConfig {
  const next = { ...cfg };
  for (const [k, v] of Object.entries(patch)) {
    if (!ALLOWED_FIELDS.has(k as keyof AgentConfig)) continue;
    (next as Record<string, unknown>)[k] = v;
  }
  // Compaction has its own subsection - merge just the known numeric/boolean fields.
  if (patch.compaction && typeof patch.compaction === "object") {
    const p = patch.compaction as Record<string, unknown>;
    next.compaction = { ...(cfg.compaction ?? {} as NonNullable<AgentConfig["compaction"]>) };
    if (typeof p.enabled === "boolean") next.compaction.enabled = p.enabled;
    if (typeof p.threshold === "number") next.compaction.threshold = p.threshold;
    if (typeof p.schedule === "string") next.compaction.schedule = p.schedule as "both" | "threshold" | "daily" | "off";
    if (typeof p.keepRecentPerKind === "number") next.compaction.keepRecentPerKind = p.keepRecentPerKind;
    if (typeof p.pruneCycleDays === "number") next.compaction.pruneCycleDays = p.pruneCycleDays;
  }
  return next;
}

function maskChannel(c: ChannelConfig): object {
  const t = c.token ?? "";
  const masked = t.length > 8 ? `${t.slice(0, 4)}…${t.slice(-4)}` : "***";
  return {
    kind: c.kind,
    tokenMasked: masked,
    channelId: c.channelId,
    allowlist: c.allowlist,
  };
}

// ── Log reader ─────────────────────────────────────────────────────

interface LogEntry {
  ts: string;
  level: string;
  event: string;
  profile: string;
  [k: string]: unknown;
}

function readRecentLogs(profile: string, lines: number, levels: string[]): LogEntry[] {
  const dir = profileLogDir(profile);
  if (!existsSync(dir)) return [];
  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({ f, mtime: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .map((x) => x.f);
  } catch { return []; }

  const out: LogEntry[] = [];
  // Walk files newest-to-oldest, collect lines until we have `lines` entries.
  for (const f of files) {
    if (out.length >= lines) break;
    let raw: string;
    try { raw = readFileSync(join(dir, f), "utf8"); } catch { continue; }
    const rows = raw.split("\n").filter(Boolean).reverse();
    for (const line of rows) {
      if (out.length >= lines) break;
      try {
        const entry = JSON.parse(line) as LogEntry;
        if (levels.length > 0 && !levels.includes(entry.level)) continue;
        out.push(entry);
      } catch { /* skip malformed */ }
    }
  }
  // Return chronological order (oldest first) so the UI can append.
  return out.reverse();
}
