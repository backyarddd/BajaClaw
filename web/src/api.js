// Client for the BajaClaw control API (served by the gateway).
const BASE = import.meta.env.VITE_GATEWAY_BASE || `http://${location.hostname || "127.0.0.1"}:18789`;

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}
const get = (path) => req("GET", path);

export const api = {
  status: () => get("/api/status"),
  getConfig: () => get("/api/config"),
  patchConfig: (body) => req("PATCH", "/api/config", body),
  providers: () => get("/api/providers"),
  setProviderKey: (id, key) => req("PUT", `/api/providers/${id}/key`, { key }),
  removeProvider: (id) => req("DELETE", `/api/providers/${id}`),
  setDefaultProvider: (id) => req("PATCH", "/api/config", { defaultProvider: id }),
  channels: () => get("/api/channels"),
  setChannel: (id, body) => req("PUT", `/api/channels/${id}`, body),
  memory: (q) => get(`/api/memory${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  clearMemory: () => req("DELETE", "/api/memory"),
  skills: () => get("/api/skills"),
  updates: () => get("/api/updates"),
  checkUpdates: () => req("POST", "/api/updates/check"),
  cowork: (goal) => req("POST", "/api/cowork", { goal }),
};
