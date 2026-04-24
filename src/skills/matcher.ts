import type { Skill } from "../types.js";

export interface MatchContext {
  // Active tool list (from AgentConfig.allowedTools). Used to honor
  // hermes conditional activation: `requires_tools` and `fallback_for_tools`.
  allowedTools?: string[];
}

export function matchSkills(skills: Skill[], task: string, topN = 3, ctx: MatchContext = {}): Skill[] {
  const taskLower = task.toLowerCase();
  const interrogative = isInterrogative(task);
  const candidates = skills.filter((s) => isActiveForContext(s, ctx));
  const scored = candidates.map((s) => ({ s, score: scoreSkill(s, taskLower, interrogative) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.filter((x) => x.score > 0).slice(0, topN).map((x) => x.s);
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
  // `requires_tools`: every listed tool must be active. If the config
  // has no allowlist at all, the agent gets every built-in tool - skip
  // the check in that case (empty allowedTools means "all").
  if (skill.requiresTools && skill.requiresTools.length > 0 && tools.size > 0) {
    for (const t of skill.requiresTools) if (!tools.has(t)) return false;
  }
  // `fallback_for_tools`: skill exists as a workaround when those tools
  // are missing. If any listed tool is present, hide the fallback.
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
