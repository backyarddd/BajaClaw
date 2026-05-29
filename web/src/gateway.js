// Thin client for the BajaClaw gateway + local OpenAI endpoint.
// Degrades gracefully: if the gateway WS isn't up, the UI still renders with
// honest "offline" status instead of breaking.

const host = () => location.hostname || "127.0.0.1";
const GATEWAY_BASE =
  import.meta.env.VITE_GATEWAY_BASE || `http://${host()}:18789`;
const OPENAI_BASE =
  import.meta.env.VITE_OPENAI_BASE || `http://${host()}:11435`;

// The native gateway exposes a live SSE stream at /events. EventSource gives us
// connection status plus live activity without a WebSocket server dependency.
export function connectGateway({ onStatus, onEvent } = {}) {
  let es;
  try {
    es = new EventSource(`${GATEWAY_BASE}/events`);
    es.onopen = () => onStatus?.({ gateway: "connected" });
    es.onerror = () => onStatus?.({ gateway: "offline" });
    es.onmessage = (e) => { try { onEvent?.(JSON.parse(e.data)); } catch { /* ignore */ } };
  } catch {
    onStatus?.({ gateway: "offline" });
  }
  return { close: () => es?.close() };
}

// Stream a chat completion from the local OpenAI-compatible endpoint.
export async function* streamChat(messages, { model = "bajaclaw", signal } = {}) {
  const res = await fetch(`${OPENAI_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, stream: true, messages }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`endpoint ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const data = t.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const j = JSON.parse(data);
        const delta = j.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch { /* ignore */ }
    }
  }
}

export async function endpointHealth() {
  try {
    const r = await fetch(`${OPENAI_BASE}/health`, { signal: AbortSignal.timeout(800) });
    return r.ok;
  } catch { return false; }
}

export const ENDPOINTS = { GATEWAY_BASE, OPENAI_BASE };
