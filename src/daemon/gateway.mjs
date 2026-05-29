// BajaClaw native gateway. No OpenClaw. A small HTTP + SSE control plane the web
// UI connects to for health and a live event stream. Channels and the agent
// publish events onto the bus; the UI subscribes via EventSource.
import http from "node:http";
import { EventEmitter } from "node:events";
import { handleApi } from "./api.mjs";

export const bus = new EventEmitter();
bus.setMaxListeners(0);

export function publish(event) {
  bus.emit("event", { at: new Date().toISOString(), ...event });
}

function cors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
}

export function startGateway(cfg, { onListen, status, version } = {}) {
  const server = http.createServer(async (req, res) => {
    cors(res);
    const url = new URL(req.url, "http://localhost");

    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ status: "ok", service: "bajaclaw-gateway", ...(status?.() || {}) }));
    }

    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, url, { version, publish });
      if (handled) return;
    }

    if (url.pathname === "/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);
      const onEvent = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
      bus.on("event", onEvent);
      const ping = setInterval(() => res.write(": ping\n\n"), 15000);
      req.on("close", () => { clearInterval(ping); bus.off("event", onEvent); });
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
  server.listen(cfg.gateway.port, cfg.gateway.host, () => onListen?.(cfg.gateway));
  return server;
}
