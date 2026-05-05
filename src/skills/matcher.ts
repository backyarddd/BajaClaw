// Lightweight slash-trigger and keyword matcher. Used by the prompt
// assembly to surface a "user invoked /foo" hint when the task starts
// with a slash command. The full LLM-router path was removed in v0.21
// when the system-prompt index pattern took over skill discovery.

import type { Skill } from "../types.js";

export interface MatchContext {
  allowedTools?: string[];
}

export type MatchRoute = "slash" | "keyword";

export function matchSlashTriggers(skills: Skill[], task: string): Skill[] {
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

export function matchSkillsByKeyword(
  skills: Skill[],
  task: string,
  topN = 3,
  ctx: MatchContext = {},
): Skill[] {
  const candidates = skills.filter((s) => isActiveForContext(s, ctx));
  const taskLower = task.toLowerCase();
  const interrogative = isInterrogative(task);
  const scored = candidates.map((s) => ({ s, score: scoreSkill(s, taskLower, interrogative) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.filter((x) => x.score > 0).slice(0, topN).map((x) => x.s);
}

// Async wrapper kept for back-compat with existing tests; routes through
// the slash-fast-path then falls through to keyword scoring. No LLM call.
export async function matchSkills(
  skills: Skill[],
  task: string,
  topN = 3,
  ctx: MatchContext & { strategy?: "llm" | "keyword"; onTrace?: (route: MatchRoute, names: string[], err?: string) => void } = {},
): Promise<Skill[]> {
  if (topN <= 0 || skills.length === 0) return [];
  const slash = matchSlashTriggers(skills.filter((s) => isActiveForContext(s, ctx)), task);
  if (slash.length > 0) {
    const out = slash.slice(0, topN);
    ctx.onTrace?.("slash", out.map((s) => s.name));
    return out;
  }
  const out = matchSkillsByKeyword(skills, task, topN, ctx);
  ctx.onTrace?.("keyword", out.map((s) => s.name));
  return out;
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
    "tell me ", "explain ", "describe ",
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
