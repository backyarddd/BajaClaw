// Auto model selection. When a profile's model is set to "auto", pick a
// concrete model id based on the task's shape. Heuristic only — no
// extra backend calls.
//
// Tiers:
//   claude-haiku-4-5   trivial / triage / heartbeat
//   claude-sonnet-4-6  default — most normal work
//   claude-opus-4-7    planning, coding, deep research, reflection

import type { Model } from "./types.js";

export const AUTO = "auto";

// Default to the most recent model IDs. Users can override per profile
// via `bajaclaw model <id>`; any string is accepted, the backend CLI
// validates against subscription entitlement.
export const HAIKU = "claude-haiku-4-5";
export const SONNET = "claude-sonnet-4-6";
export const OPUS = "claude-opus-4-7";

export interface PickContext {
  /** The literal model field from the profile config. */
  configuredModel?: string;
  /** The task text the cycle will run. */
  task: string;
  /** Optional source marker; passing "heartbeat" biases toward Haiku. */
  source?: string;
}

export interface PickResult {
  model: string;
  tier: "haiku" | "sonnet" | "opus";
  reason: string;
}

export function pickModel(ctx: PickContext): PickResult {
  const configured = ctx.configuredModel ?? AUTO;
  if (configured !== AUTO) {
    return { model: configured, tier: tierFor(configured), reason: "configured" };
  }

  const task = (ctx.task ?? "").trim();
  const lower = task.toLowerCase();
  const words = countWords(task);

  // --- Opus tier: planning / coding / deep reasoning --------------------
  if (matchesAny(lower, OPUS_MARKERS)) {
    return { model: OPUS, tier: "opus", reason: "opus-marker" };
  }

  // --- Haiku tier: short + trivial markers ------------------------------
  if (ctx.source === "heartbeat" || lower.startsWith("heartbeat check")) {
    return { model: HAIKU, tier: "haiku", reason: "heartbeat" };
  }
  if (words <= 8 && matchesAny(lower, HAIKU_MARKERS)) {
    return { model: HAIKU, tier: "haiku", reason: "short+trivial" };
  }
  if (words <= 4) {
    return { model: HAIKU, tier: "haiku", reason: "very-short" };
  }

  // --- Sonnet tier: everything else -------------------------------------
  return { model: SONNET, tier: "sonnet", reason: "default" };
}

export function tierFor(modelId: string): PickResult["tier"] {
  if (modelId.includes("opus")) return "opus";
  if (modelId.includes("haiku")) return "haiku";
  return "sonnet";
}

export interface ContextBudget {
  memoryCount: number;
  memoryCharsEach: number;
  skillCount: number;
}

// Per-tier prompt budgets. These only shape the prompt BajaClaw
// assembles (how many memories / skills to pack in) — the number of
// turns and tokens the agent can actually run is controlled by claude's
// `--effort` level, not by us.
export function budgetFor(tier: PickResult["tier"]): ContextBudget {
  switch (tier) {
    case "haiku":
      return { memoryCount: 3, memoryCharsEach: 180, skillCount: 1 };
    case "opus":
      return { memoryCount: 7, memoryCharsEach: 280, skillCount: 3 };
    case "sonnet":
    default:
      return { memoryCount: 5, memoryCharsEach: 220, skillCount: 2 };
  }
}

// ---------------------------------------------------------------------------
// Heuristic markers. These are intentionally conservative: a false-positive
// promotes a cycle to Opus (expensive but correct); a false-negative demotes
// to Sonnet (still capable, cheaper).

const OPUS_MARKERS: RegExp[] = [
  /\b(plan|planning|architect|architecture|roadmap|strategy|strategize)\b/,
  /\b(refactor|scaffold|migrate)\b/,
  /\b(implement|build|author)\s+(a|an|the)?\s*(system|service|feature|module|component|pipeline|function|class|script|test|migration|endpoint|parser|adapter)\b/,
  /\bwrite\s+(a|the)?\s*(program|script|function|class|module|test|spec|component|migration)\b/,
  /\b(debug|troubleshoot|diagnose)\b/,
  /\b(deep|thorough|comprehensive)\s+(research|analysis|review|dive|audit)\b/,
  /\b(review|audit)\s+(the|my|this)?\s*(code|codebase|implementation|architecture|design)\b/,
  /\b(fix|resolve)\s+(the|this|a)?\s*(bug|issue|regression|incident)\b/,
  /\bcode\s+review\b/,
  /\b(reflect|reflection)\b/,
];

const HAIKU_MARKERS: RegExp[] = [
  /^(ack|ok|okay|thanks|thank\s*you|hi|hello|hey|ping|test|status)\b/,
  /^(what|when|where|who)\s+is\s+\w+\??$/,
  /^(show|list|check)\s+(my|the)?\s*(status|logs|queue|tasks|pending|count)\b/,
  /^(does|do|is|are|can)\s+\w+/,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  for (const p of patterns) if (p.test(text)) return true;
  return false;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Known model ids for display in `bajaclaw model`.
export const KNOWN_MODELS: { id: string; note: string }[] = [
  { id: AUTO,   note: "pick automatically per task (haiku/sonnet/opus)" },
  { id: HAIKU,  note: "fast, cheap — triage + simple answers" },
  { id: SONNET, note: "balanced default" },
  { id: OPUS,   note: "planning, coding, deep research" },
];

export function isValidModel(id: string): boolean {
  if (id === AUTO) return true;
  // Any string is accepted; the backend validates per subscription.
  return id.trim().length > 0;
}

export type { Model };
