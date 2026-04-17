import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { loadConfig } from "../config.js";
import { openDb } from "../db.js";
import { listRecent } from "../memory/recall.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// __dirname is <repo>/src/commands (tsx) or <repo>/dist/commands (built).
const DASHBOARD_HTML = join(__dirname, "..", "..", "src", "dashboard.html");

export async function runDashboard(profile: string): Promise<void> {
  const cfg = loadConfig(profile);
  const port = cfg.dashboardPort ?? 7337;
  const srv = createServer((req: IncomingMessage, res: ServerResponse) => {
    try { handle(req, res, profile); }
    catch (e) { res.writeHead(500); res.end((e as Error).message); }
  });
  srv.listen(port, () => {
    console.log(chalk.green(`✓ dashboard: http://localhost:${port}/`));
  });
}

function handle(req: IncomingMessage, res: ServerResponse, profile: string): void {
  const url = req.url ?? "/";
  if (url === "/" || url === "/index.html") {
    const body = existsSync(DASHBOARD_HTML)
      ? readFileSync(DASHBOARD_HTML, "utf8")
      : fallbackHtml();
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(body);
    return;
  }
  if (url.startsWith("/api/")) {
    const db = openDb(profile);
    try {
      if (url === "/api/cycles") {
        const rows = db.prepare("SELECT * FROM cycles ORDER BY id DESC LIMIT 50").all();
        return json(res, rows);
      }
      if (url === "/api/memories") {
        return json(res, listRecent(db, 100));
      }
      if (url === "/api/schedules") {
        const rows = db.prepare("SELECT * FROM schedules").all();
        return json(res, rows);
      }
      if (url === "/api/tasks") {
        const rows = db.prepare("SELECT * FROM tasks ORDER BY id DESC LIMIT 100").all();
        return json(res, rows);
      }
      if (url === "/api/summary") {
        const c = db.prepare("SELECT COUNT(*) c, SUM(cost_usd) cost FROM cycles").get() as { c: number; cost: number | null };
        const m = db.prepare("SELECT COUNT(*) c FROM memories").get() as { c: number };
        return json(res, { profile, cycles: c.c, totalCostUsd: c.cost ?? 0, memories: m.c });
      }
    } finally { db.close(); }
  }
  res.writeHead(404); res.end();
}

function json(res: ServerResponse, data: unknown): void {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

function fallbackHtml(): string {
  return `<!doctype html><html><body style="font-family:system-ui;background:#111;color:#eee;padding:2rem">
<h1>BajaClaw Dashboard</h1><p>dashboard.html not found — run <code>npm run build</code>.</p>
</body></html>`;
}
