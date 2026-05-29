// Native agent loop. No OpenClaw. Two modes share provider selection + fallback:
//   - agent (streamRespond): adds a system prompt, memory recall, and outcome
//     logging. Use for the chat experience.
//   - raw (streamRaw): pure passthrough. Your messages go straight to the
//     provider, with no system prompt, no memory, no logging, no tools. Use when
//     other programs want BajaClaw as a plain local LLM.
import { load } from "../config/config.mjs";
import { streamChat, isConfigured, REGISTRY } from "../llm/client.mjs";
import * as brain from "../../plugins/hermes-brain/store.mjs";

const SYSTEM = "You are BajaClaw, a helpful, capable personal AI agent that runs on the user's own machine.";

// Ordered, configured providers to try.
function candidates(cfg) {
  const order = [cfg.defaultProvider, ...(cfg.providerOrder || [])];
  const seen = new Set();
  return order.filter((p) => p && REGISTRY[p] && !seen.has(p) && seen.add(p) && isConfigured(p));
}

// Add a system prompt and recalled memory (agent mode only).
function withContext(messages) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  let memo = "";
  try {
    if (lastUser) {
      const hits = brain.recall(lastUser.content, { limit: 3 });
      if (hits.length) memo = "\n\nRelevant past outcomes:\n" + hits.map((h) => `- ${h.task}: ${h.outcome}`).join("\n");
    }
  } catch { /* memory optional */ }
  const hasSys = messages.some((m) => m.role === "system");
  return hasSys ? messages : [{ role: "system", content: SYSTEM + memo }, ...messages];
}

export function listReadyProviders() {
  return candidates(load());
}

// Shared provider-fallback loop. Tries each configured provider in order;
// yields {provider, delta} chunks, or a final {error, text} if none work.
// onSuccess(text, provider) runs once after a provider completes.
async function* runProviders(messages, { signal, model, onSuccess } = {}) {
  const tries = candidates(load());
  if (!tries.length) {
    yield { error: "no_provider", text: "No model is configured yet. Run `bajaclaw onboard` to sign in with ChatGPT (or another provider)." };
    return;
  }
  let lastErr;
  for (const provider of tries) {
    try {
      let acc = "";
      for await (const delta of streamChat(messages, { provider, model, signal })) {
        acc += delta;
        yield { provider, delta };
      }
      onSuccess?.(acc, provider);
      return;
    } catch (e) {
      lastErr = e; // try the next provider on rate-limit / transient failures
    }
  }
  yield { error: "all_failed", text: `All configured providers failed${lastErr ? `: ${lastErr.message}` : ""}.` };
}

// Agent mode: system prompt + memory recall + outcome logging.
export async function* streamRespond(messages, { signal, model } = {}) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  yield* runProviders(withContext(messages), {
    signal, model,
    onSuccess: (acc, provider) => {
      try { brain.remember({ task: lastUser?.content?.slice(0, 200) || "chat", outcome: acc.slice(0, 200), success: true, tags: ["chat", provider] }); } catch {}
    },
  });
}

// Raw mode: pure passthrough, no system prompt, no memory, no logging, no tools.
export async function* streamRaw(messages, { signal, model } = {}) {
  yield* runProviders(messages, { signal, model });
}

// Non-stream convenience (agent mode).
export async function respond(messages, opts = {}) {
  let text = "";
  let provider = null;
  for await (const chunk of streamRespond(messages, opts)) {
    if (chunk.delta) { text += chunk.delta; provider = chunk.provider; }
    else if (chunk.text) { text = chunk.text; }
  }
  return { text, provider };
}
