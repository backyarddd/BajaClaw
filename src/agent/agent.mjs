// Native agent loop. No OpenClaw. Picks the configured provider (with fallback
// order), recalls relevant memory, streams a reply, and records the outcome to
// the Hermes brain so the agent improves over time.
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

// Build the message list with a system prompt and recalled memory.
function withContext(messages) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  let memo = "";
  try {
    if (lastUser) {
      const hits = brain.recall(lastUser.content, { limit: 3 });
      if (hits.length) {
        memo = "\n\nRelevant past outcomes:\n" + hits.map((h) => `- ${h.task}: ${h.outcome}`).join("\n");
      }
    }
  } catch { /* memory optional */ }
  const sys = { role: "system", content: SYSTEM + memo };
  const hasSys = messages.some((m) => m.role === "system");
  return hasSys ? messages : [sys, ...messages];
}

export function listReadyProviders() {
  return candidates(load());
}

// Stream a reply. Tries providers in order; yields {provider} first, then text.
export async function* streamRespond(messages, { signal, model } = {}) {
  const cfg = load();
  const tries = candidates(cfg);
  if (!tries.length) {
    yield { error: "no_provider", text: "No model is configured yet. Run `bajaclaw onboard` to sign in with ChatGPT (or another provider)." };
    return;
  }
  const full = withContext(messages);
  let lastErr;
  for (const provider of tries) {
    try {
      let acc = "";
      for await (const delta of streamChat(full, { provider, model, signal })) {
        acc += delta;
        yield { provider, delta };
      }
      // success: record the outcome
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      try { brain.remember({ task: lastUser?.content?.slice(0, 200) || "chat", outcome: acc.slice(0, 200), success: true, tags: ["chat", provider] }); } catch {}
      return;
    } catch (e) {
      lastErr = e;
      // try the next provider on rate-limit / transient failures
    }
  }
  yield { error: "all_failed", text: `All configured providers failed${lastErr ? `: ${lastErr.message}` : ""}.` };
}

// Non-stream convenience.
export async function respond(messages, opts = {}) {
  let text = "";
  let provider = null;
  for await (const chunk of streamRespond(messages, opts)) {
    if (chunk.delta) { text += chunk.delta; provider = chunk.provider; }
    else if (chunk.text) { text = chunk.text; }
  }
  return { text, provider };
}
