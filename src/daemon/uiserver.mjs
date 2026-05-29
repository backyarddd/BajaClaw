// Tiny static server for the built web UI (web/dist). Zero deps.
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname, normalize } from "node:path";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

export function startUiServer({ dist, host = "127.0.0.1", port = 18790, onListen } = {}) {
  const cache = new Map(); // path -> Buffer; the built bundle is immutable per run
  const server = http.createServer((req, res) => {
    if (!existsSync(dist)) {
      res.writeHead(503, { "content-type": "text/html" });
      return res.end("<h1>BajaClaw UI not built</h1><p>Run <code>npm run ui:build</code>.</p>");
    }
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    // prevent path traversal
    let file = normalize(join(dist, p));
    if (!file.startsWith(dist)) file = join(dist, "index.html");
    if (!existsSync(file)) file = join(dist, "index.html"); // SPA fallback
    try {
      let body = cache.get(file);
      if (!body) { body = readFileSync(file); cache.set(file, body); }
      res.writeHead(200, {
        "content-type": MIME[extname(file)] || "application/octet-stream",
        "cache-control": "no-cache",
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  server.listen(port, host, () => onListen?.({ host, port }));
  return server;
}
