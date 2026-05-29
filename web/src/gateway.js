// Thin client for the BajaClaw gateway + local OpenAI endpoint.
// Degrades gracefully: if the gateway WS isn't up, the UI still renders with
// honest "offline" status instead of breaking.

const GATEWAY_WS =
  import.meta.env.VITE_GATEWAY_WS || `ws://${location.hostname || "127.0.0.1"}:18789/ws`;
const OPENAI_BASE =
  import.meta.env.VITE_OPENAI_BASE || `http://${location.hostname || "127.0.0.1"}:11434`;

export function connectGateway({ onStatus, onEvent } = {}) {
  let ws;
  let alive = false;
  try {
    ws = new WebSocket(GATEWAY_WS);
    ws.onopen = () => { alive = true; onStatus?.({ gateway: "connected" }); };
    ws.onclose = () => { alive = false; onStatus?.({ gateway: "offline" }); };
    ws.onerror = () => { alive = false; onStatus?.({ gateway: "offline" }); };
    ws.onmessage = (e) => {
      try { onEvent?.(JSON.parse(e.data)); } catch { /* ignore non-json */ }
    };
  } catch {
    onStatus?.({ gateway: "offline" });
  }
  return {
    send: (msg) => { if (alive) ws.send(JSON.stringify(msg)); },
    close: () => ws?.close(),
    isAlive: () => alive,
  };
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

export const ENDPOINTS = { GATEWAY_WS, OPENAI_BASE };
