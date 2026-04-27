import type { Skill } from "../types.js";
import type { ClaudeOptions, ClaudeResult } from "../types.js";

// Runner shape matches the relevant slice of `runOnce` from ../claude.
// We avoid the static import so tests can drive the matcher with an
// injected runner without dragging the real claude module's
// `.js`-extension resolution into the test environment.
type Runner = (prompt: string, opts?: ClaudeOptions) => Promise<ClaudeResult>;

export interface MatchContext {
  // Active tool list (from AgentConfig.allowedTools). Used to honor
  // hermes conditional activation: `requires_tools` and `fallback_for_tools`.
  allowedTools?: string[];
  // Selection strategy. "llm" (default) routes the task through a haiku
  // call that returns the names of skills the user is actually requesting.
  // "keyword" forces the legacy substring matcher (also used as fallback
  // when the LLM call fails or times out).
  strategy?: "llm" | "keyword";
  // Optional runner injection for tests. Defaults to runOnce from ../claude.
  runner?: Runner;
  // Optional trace sink. Called once per match with the route taken
  // ("slash" | "llm" | "llm-fallback-keyword" | "keyword") and the
  // selected skill names. agent.ts wires this to its Logger.
  onTrace?: (route: MatchRoute, names: string[], err?: string) => void;
}

export type MatchRoute = "slash" | "llm" | "llm-fallback-keyword" | "keyword";

const LLM_TIMEOUT_MS = 15_000;

/** Async entry point. Picks skills semantically when strategy="llm",
 *  falls back to keyword scoring on any failure. */
export async function matchSkills(
  skills: Skill[],
  task: string,
  topN = 3,
  ctx: MatchContext = {},
): Promise<Skill[]> {
  const candidates = skills.filter((s) => isActiveForContext(s, ctx));
  if (candidates.length === 0 || topN <= 0) return [];

  // Fast path: explicit slash trigger ("/graphify", "/foo bar"). When the
  // user writes the trigger verbatim, no LLM call is needed - this is an
  // unambiguous request.
  const slashHit = matchSlashTriggers(candidates, task);
  if (slashHit.length > 0) {
    const out = slashHit.slice(0, topN);
    ctx.onTrace?.("slash", out.map((s) => s.name));
    return out;
  }

  const strategy = ctx.strategy ?? "llm";
  if (strategy === "llm") {
    let fallbackReason: string | undefined;
    try {
      const llmHits = await matchSkillsByLLM(candidates, task, topN, ctx.runner);
      if (llmHits) {
        const out = llmHits.slice(0, topN);
        ctx.onTrace?.("llm", out.map((s) => s.name));
        return out;
      }
      fallbackReason = "unparseable";
    } catch (e) {
      fallbackReason = (e as Error).message;
    }
    const kw = matchSkillsByKeyword(candidates, task, topN);
    ctx.onTrace?.("llm-fallback-keyword", kw.map((s) => s.name), fallbackReason);
    return kw;
  }

  const kw = matchSkillsByKeyword(candidates, task, topN);
  ctx.onTrace?.("keyword", kw.map((s) => s.name));
  return kw;
}

/** Legacy keyword/substring scorer. Exported so the LLM path can fall
 *  back to it on failure, and so tests can pin its behavior. */
export function matchSkillsByKeyword(
  skills: Skill[],
  task: string,
  topN = 3,
): Skill[] {
  const taskLower = task.toLowerCase();
  const interrogative = isInterrogative(task);
  const scored = skills.map((s) => ({ s, score: scoreSkill(s, taskLower, interrogative) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.filter((x) => x.score > 0).slice(0, topN).map((x) => x.s);
}

/** LLM-based intent classifier. Returns null when the response is
 *  unparseable (caller treats that as "fall back to keyword"). Returns
 *  [] when the model decided no skill applies - that is a real answer,
 *  not a failure. */
export async function matchSkillsByLLM(
  skills: Skill[],
  task: string,
  topN: number,
  runner?: Runner,
): Promise<Skill[] | null> {
  if (skills.length === 0) return [];
  const exec: Runner = runner ?? (await import("../claude.js")).runOnce;

  const list = skills
    .map((s, i) => `${i + 1}. ${s.name}: ${oneLine(s.description ?? "")}`)
    .join("\n");

  const prompt = `You are a skill router for an autonomous agent.

Given a user message and a list of available skills, return the names of skills that should be activated for this message.

A skill should ONLY be activated if the user is REQUESTING the action that skill performs. Do NOT activate a skill just because the user mentions, discusses, asks about, or uses words related to its topic. When in doubt, return an empty list.

Examples:
- User: "make me an image of a cat" -> ["image-gen"]
- User: "we could use images instead of videos" -> []
- User: "what does the graphify skill do?" -> []
- User: "/graphify ./docs" -> ["graphify"]
- User: "I think the design looks good" -> []
- User: "review my pull request #42" -> ["pr-review"]

Available skills:
${list}

User message:
"""
${task.slice(0, 2000)}
"""

Return ONLY a JSON array of skill name strings. At most ${topN} names. No prose, no code fence, no markdown. If no skill should activate, return [].`;

  const r = await exec(prompt, {
    model: "claude-haiku-4-5",
    effort: "low",
    printMode: true,
    timeout: LLM_TIMEOUT_MS,
    disallowedTools: ["Bash", "Write", "Edit", "Read", "Grep", "Glob", "WebSearch", "WebFetch"],
  });

  if (!r.ok || !r.text) return null;

  const names = parseNameArray(r.text);
  if (!names) return null;

  const byName = new Map(skills.map((s) => [s.name.toLowerCase(), s]));
  const out: Skill[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const key = String(raw ?? "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    const skill = byName.get(key);
    if (skill) {
      out.push(skill);
      seen.add(key);
    }
  }
  return out;
}

function parseNameArray(text: string): string[] | null {
  const trimmed = text.trim();
  // Try the whole response first. Most haiku responses with a strict
  // "JSON array only" instruction come back clean.
  try {
    const v = JSON.parse(trimmed);
    if (Array.isArray(v)) return v.map((x) => String(x));
  } catch { /* fall through */ }

  // Fallback: scan for the first [...] block. Handles models that wrap
  // the array in stray prose or a code fence despite the instruction.
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(trimmed.slice(start, end + 1));
    return Array.isArray(v) ? v.map((x) => String(x)) : null;
  } catch {
    return null;
  }
}

function matchSlashTriggers(skills: Skill[], task: string): Skill[] {
  const trimmed = task.trim();
  if (!trimmed.startsWith("/")) return [];
  const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
  const out: Skill[] = [];
  for (const s of skills) {
    for (const trig of s.triggers ?? []) {
      const t = trig.trim().toLowerCase();
      if (t.startsWith("/") && t === firstToken) {
        out.push(s);
        break;
      }
    }
  }
  return out;
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 240);
}

function isInterrogative(task: string): boolean {
  const trimmed = task.trim();
  if (!trimmed.endsWith("?")) return false;
  const lower = trimmed.toLowerCase();
  const interrogativeStarts = [
    "what ", "who ", "when ", "where ", "why ", "how ",
    "which ", "whose ", "whom ",
    "is ", "are ", "was ", "were ",
    "do ", "does ", "did ",
    "tell me ", "explain ", "describe "
  ];
  return interrogativeStarts.some((start) => lower.startsWith(start));
}

function isActiveForContext(skill: Skill, ctx: MatchContext): boolean {
  const tools = new Set(ctx.allowedTools ?? []);
  if (skill.requiresTools && skill.requiresTools.length > 0 && tools.size > 0) {
    for (const t of skill.requiresTools) if (!tools.has(t)) return false;
  }
  if (skill.fallbackForTools && skill.fallbackForTools.length > 0 && tools.size > 0) {
    for (const t of skill.fallbackForTools) if (tools.has(t)) return false;
  }
  return true;
}

function scoreSkill(skill: Skill, taskLower: string, interrogative: boolean): number {
  let score = 0;
  for (const trig of skill.triggers ?? []) {
    const trigLower = trig.toLowerCase();
    if (taskLower.includes(trigLower)) {
      if (trigLower.startsWith("/")) {
        score += 10;
      } else if (!interrogative) {
        score += 5;
      }
    }
  }
  if (!interrogative) {
    for (const tag of skill.tags ?? []) {
      if (taskLower.includes(tag.toLowerCase())) score += 3;
    }
    for (const word of (skill.description ?? "").toLowerCase().split(/\s+/)) {
      if (word.length < 4) continue;
      if (taskLower.includes(word)) score += 1;
    }
    for (const word of skill.name.toLowerCase().split(/[-_\s]+/)) {
      if (word.length < 4) continue;
      if (taskLower.includes(word)) score += 2;
    }
  }
  return score;
}
