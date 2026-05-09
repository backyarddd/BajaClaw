// OpenAI chat-completions ↔ BajaClaw cycle translation.
//
// In: OpenAI ChatCompletion request (messages[], model, stream, ...).
// Out: a single task string the BajaClaw cycle will run, plus the profile
// the model name maps to.
//
// A request's last user message is the current task. Earlier messages are
// rendered as a prior transcript so the backend has conversational context.
// BajaClaw's own memory/skill/MCP layer stacks on top of whatever the
// caller sent.

import type { CycleOutput } from "../agent.js";

export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  // OpenAI's stream_options. We honor `include_usage`: when true, the
  // streaming response emits a final usage-only chunk (choices: []) with
  // populated token counts before [DONE]. Default off (matches OpenAI).
  stream_options?: { include_usage?: boolean };
  temperature?: number;
  max_tokens?: number;
  user?: string;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatChoice {
  index: number;
  message: { role: "assistant"; content: string };
  finish_reason: "stop" | "length" | "error";
}

export interface ChatCompletion {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatChoice[];
  usage: ChatUsage;
}

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: {
    index: number;
    delta: { role?: "assistant"; content?: string };
    finish_reason: null | "stop" | "length" | "error";
  }[];
  // Populated only on the final usage chunk emitted when the request set
  // stream_options.include_usage = true. Per the OpenAI streaming spec,
  // that chunk has choices: [] and usage populated.
  usage?: ChatUsage;
}

// Map the request's "model" field to a BajaClaw profile + optional
// per-request model override.
//
// Syntax, highest specificity last:
//   "default"                          -> profile=default, use its config.model
//   "bajaclaw:default"                 -> same, explicit namespace
//   "default:claude-opus-4-7"          -> profile=default, override = opus 4.7
//   "bajaclaw:default:claude-opus-4-7" -> same, explicit namespace
//   "auto"                             -> profile=default, override = "auto"
//   "claude-opus-4-7"                  -> profile=default, override = opus 4.7
//
// "auto" or any string that starts with "claude-" is treated as a model id
// applied to the default profile - that's the shortest shortcut for
// "just use BajaClaw's pipeline but with this model".
export interface ResolvedRequest {
  profile: string;
  modelOverride?: string;
}

export function resolveProfile(model: string): string {
  return resolveRequest(model).profile;
}

export function resolveRequest(model: string, defaultProfile = "default"): ResolvedRequest {
  if (!model) return { profile: defaultProfile };
  let s = model;
  if (s.startsWith("bajaclaw:")) s = s.slice("bajaclaw:".length);

  // Bare model id shortcut → apply to default profile.
  if (/^(auto$|claude-)/.test(s)) {
    return { profile: defaultProfile, modelOverride: s };
  }

  const idx = s.indexOf(":");
  if (idx === -1) return { profile: s };
  return {
    profile: s.slice(0, idx),
    modelOverride: s.slice(idx + 1) || undefined,
  };
}

export function taskFromMessages(messages: OpenAIMessage[]): string {
  if (!messages || messages.length === 0) return "";
  const last = messages[messages.length - 1];
  if (messages.length === 1) return last?.content ?? "";

  const priors = messages.slice(0, -1);
  const transcript = priors.map((m) => `${labelFor(m.role)}: ${m.content}`).join("\n\n");
  return [
    "You are continuing a conversation. Prior exchange:",
    "",
    transcript,
    "",
    "Current message:",
    last?.content ?? "",
  ].join("\n");
}

function labelFor(role: OpenAIMessage["role"]): string {
  switch (role) {
    case "system": return "SYSTEM";
    case "user": return "USER";
    case "assistant": return "ASSISTANT";
    case "tool": return "TOOL";
  }
}

// Build a ChatUsage from a CycleOutput. CycleOutput.inputTokens already
// sums input + cache_creation + cache_read (see claude.ts parseResult)
// so it matches the displayed "in" count and what the user is billed
// for. completion_tokens maps directly to outputTokens. Either may be
// undefined for haiku-tier or stream-aborted cycles; we coerce to 0 in
// that case so the response is always a valid ChatUsage.
export function usageFromCycle(out: CycleOutput): ChatUsage {
  const prompt = out.inputTokens ?? 0;
  const completion = out.outputTokens ?? 0;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
  };
}

export function cycleToCompletion(model: string, out: CycleOutput): ChatCompletion {
  const id = `chatcmpl-bc-${out.cycleId}`;
  const finish: "stop" | "error" = out.ok ? "stop" : "error";
  return {
    id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: out.text },
        finish_reason: finish,
      },
    ],
    usage: usageFromCycle(out),
  };
}

// OpenAI's terminal usage chunk for `stream_options.include_usage: true`:
// choices: [] and usage populated. Emitted just before `data: [DONE]`.
export function makeUsageChunk(id: string, model: string, usage: ChatUsage): ChatCompletionChunk {
  return {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [],
    usage,
  };
}

// Chunk text for pseudo-streaming. Splits on word boundaries so the
// client sees progressive output even though the cycle finished before
// the first chunk was emitted.
export function chunkText(text: string, chunkSize = 24): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  const re = /\S+\s*/g;
  let buf = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    buf += m[0];
    if (buf.length >= chunkSize) {
      chunks.push(buf);
      buf = "";
    }
  }
  if (buf.length > 0) chunks.push(buf);
  return chunks;
}

export function makeChunk(
  id: string,
  model: string,
  delta: { role?: "assistant"; content?: string },
  finish: ChatCompletionChunk["choices"][number]["finish_reason"] = null,
): ChatCompletionChunk {
  return {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
}
