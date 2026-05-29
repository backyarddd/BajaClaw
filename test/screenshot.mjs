// Boots the local OpenAI endpoint + serves web/dist, then screenshots key views.
import http from "node:http";
import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

process.env.BAJACLAW_HOME = mkdtempSync(join(tmpdir(), "bajaclaw-shot-"));
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "web", "dist");

const { startEndpoint } = await import("../plugins/openai-endpoint/server.mjs");
const { load } = await import("../src/config/config.mjs");
const cfg = load();
cfg.openaiEndpoint.port = 11434;
const ep = startEndpoint(cfg, { onListen: (e) => console.log(`endpoint :${e.port}`) });

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const PORT = 5273;
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/") p = "/index.html";
  let f = join(DIST, p);
  if (!existsSync(f)) f = join(DIST, "index.html"); // SPA fallback
  try {
    res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  } catch { res.writeHead(404); res.end("nf"); }
});
await new Promise((r) => srv.listen(PORT, r));
console.log(`web :${PORT}`);

const { chromium } = await import("playwright");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
const base = `http://localhost:${PORT}/`;
const shots = join(ROOT, "assets");

async function shot(route, name, clickLabel) {
  await page.goto(base, { waitUntil: "networkidle" });
  if (clickLabel) { await page.getByRole("button", { name: clickLabel, exact: true }).click(); await page.waitForTimeout(450); }
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(shots, `ui-${name}.png`) });
  console.log(`shot ui-${name}.png`);
}

const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await shot("chat", "chat");
await shot("providers", "providers", "Models & login");
await shot("endpoint", "endpoint", "Local API");
await shot("cowork", "cowork", "Cowork tasks");
await shot("updates", "updates", "Updates");

console.log(errors.length ? `PAGE ERRORS: ${errors.join("; ")}` : "no page errors");
await browser.close();
srv.close();
ep.close();
process.exit(errors.length ? 1 : 0);
