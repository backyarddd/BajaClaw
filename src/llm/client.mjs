// Native multi-provider LLM client. No OpenClaw. Messages use OpenAI chat
// format as the lingua franca; each adapter builds the request and supplies a
// one-line "picker" for its delta shape. Streaming throughout.
import { loadCred } from "../auth/store.mjs";
import { getAccessToken } from "../auth/chatgpt-oauth.mjs";

// Provider registry. kind drives the adapter; base/defaultModel are sensible
// defaults a user can override in config.
export const REGISTRY = {
  "openai-codex": { kind: "codex", defaultModel: "gpt-5.5", label: "ChatGPT" },
  "anthropic":    { kind: "anthropic", base: "https://api.anthropic.com/v1", defaultModel: "claude-sonnet-4-6", label: "Anthropic" },
  "google":       { kind: "google", base: "https://generativelanguage.googleapis.com/v1beta", defaultModel: "gemini-2.5-pro", label: "Gemini" },
  "openai":       { kind: "openai-compat", base: "https://api.openai.com/v1", defaultModel: "gpt-4.1", label: "OpenAI" },
  "openrouter":   { kind: "openai-compat", base: "https://openrouter.ai/api/v1", defaultModel: "openai/gpt-4.1", label: "OpenRouter" },
  "groq":         { kind: "openai-compat", base: "https://api.groq.com/openai/v1", defaultModel: "llama-3.3-70b-versatile", label: "Groq" },
  "deepseek":     { kind: "openai-compat", base: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat", label: "DeepSeek" },
  "lmstudio":     { kind: "openai-compat", base: "http://127.0.0.1:1234/v1", defaultModel: "local-model", label: "LM Studio", noKey: true },
  "ollama":       { kind: "openai-compat", base: "http://127.0.0.1:11434/v1", defaultModel: "llama3.2", label: "Ollama", noKey: true },
};

export function isConfigured(providerId) {
  const p = REGISTRY[providerId];
  if (!p) return false;
  if (p.noKey) return true; // local servers need no key
  return !!loadCred(providerId);
}

// One SSE reader for every provider: yields each parsed `data:` JSON object and
// stops on the `[DONE]` sentinel (providers that just close the stream also work).
async function* sseEvents(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n");
    buf = parts.pop() || "";
    for (const line of parts) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const data = t.slice(5).trim();
      if (data === "[DONE]") return;
      try { yield JSON.parse(data); } catch { /* keepalive / non-json */ }
    }
  }
}

// Stream text deltas from an SSE response, given a per-provider picker.
async function* streamSse(res, pick) {
  for await (const j of sseEvents(res)) {
    const d = pick(j);
    if (d) yield d;
  }
}

// Separate the system prompt from the rest, used by several adapters.
function splitSystem(messages) {
  return {
    sys: messages.filter((m) => m.role === "system").map((m) => m.content).join("\n"),
    rest: messages.filter((m) => m.role !== "system"),
  };
}

async function safeText(res) {
  try { return (await res.text()).slice(0, 300); } catch { return ""; }
}

// ---- adapters ----
async function* openaiCompat(provider, messages, { model, signal }) {
  const p = REGISTRY[provider];
  const cred = p.noKey ? null : loadCred(provider);
  const headers = { "content-type": "application/json" };
  if (cred?.api_key) headers.authorization = `Bearer ${cred.api_key}`;
  const res = await fetch(`${p.base}/chat/completions`, {
    method: "POST", headers, signal,
    body: JSON.stringify({ model: model || p.defaultModel, messages, stream: true }),
  });
  if (!res.ok || !res.body) throw new Error(`${provider} ${res.status}: ${await safeText(res)}`);
  yield* streamSse(res, (j) => j.choices?.[0]?.delta?.content);
}

async function* anthropic(provider, messages, { model, signal }) {
  const p = REGISTRY[provider];
  const cred = loadCred(provider);
  const { sys, rest } = splitSystem(messages);
  const msgs = rest.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
  const res = await fetch(`${p.base}/messages`, {
    method: "POST", signal,
    headers: { "content-type": "application/json", "x-api-key": cred?.api_key || "", "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: model || p.defaultModel, system: sys || undefined, messages: msgs, max_tokens: 4096, stream: true }),
  });
  if (!res.ok || !res.body) throw new Error(`anthropic ${res.status}: ${await safeText(res)}`);
  yield* streamSse(res, (j) => (j.type === "content_block_delta" ? j.delta?.text : null));
}

async function* google(provider, messages, { model, signal }) {
  const p = REGISTRY[provider];
  const cred = loadCred(provider);
  const m = model || p.defaultModel;
  const { sys, rest } = splitSystem(messages);
  const contents = rest.map((x) => ({ role: x.role === "assistant" ? "model" : "user", parts: [{ text: x.content }] }));
  const url = `${p.base}/models/${m}:streamGenerateContent?alt=sse&key=${cred?.api_key || ""}`;
  const res = await fetch(url, {
    method: "POST", signal, headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents, systemInstruction: sys ? { parts: [{ text: sys }] } : undefined }),
  });
  if (!res.ok || !res.body) throw new Error(`google ${res.status}: ${await safeText(res)}`);
  yield* streamSse(res, (j) => j.candidates?.[0]?.content?.parts?.map((x) => x.text).join(""));
}

// ChatGPT subscription backend (Codex Responses API). Reverse-engineered, no SLA.
async function* codex(provider, messages, { model, signal }) {
  const cred = await getAccessToken();
  if (!cred?.access_token) throw new Error("not signed in to ChatGPT");
  const { sys, rest } = splitSystem(messages);
  const input = rest.map((m) => ({
    type: "message",
    role: m.role === "assistant" ? "assistant" : "user",
    content: [{ type: m.role === "assistant" ? "output_text" : "input_text", text: m.content }],
  }));
  const res = await fetch("https://chatgpt.com/backend-api/codex/responses", {
    method: "POST", signal,
    headers: {
      authorization: `Bearer ${cred.access_token}`,
      "chatgpt-account-id": cred.account_id || "",
      "content-type": "application/json",
      accept: "text/event-stream",
      "openai-beta": "responses=experimental",
      originator: "bajaclaw",
    },
    body: JSON.stringify({
      model: model && model.startsWith("gpt") ? model : REGISTRY["openai-codex"].defaultModel,
      instructions: sys || "You are BajaClaw, a helpful personal AI agent.",
      input, stream: true, store: false,
    }),
  });
  if (!res.ok || !res.body) throw new Error(`chatgpt ${res.status}: ${await safeText(res)}`);
  yield* streamSse(res, (j) => (j.type === "response.output_text.delta" ? j.delta : null));
}

const ADAPTERS = { "openai-compat": openaiCompat, anthropic, google, codex };

// Public: stream text deltas from a provider.
export async function* streamChat(messages, { provider, model, signal } = {}) {
  const p = REGISTRY[provider];
  if (!p) throw new Error(`unknown provider ${provider}`);
  yield* ADAPTERS[p.kind](provider, messages, { model, signal });
}
