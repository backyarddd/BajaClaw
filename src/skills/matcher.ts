import type { Skill } from "../types.js";

export function matchSkills(skills: Skill[], task: string, topN = 3): Skill[] {
  const taskLower = task.toLowerCase();
  const scored = skills.map((s) => ({ s, score: scoreSkill(s, taskLower) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.filter((x) => x.score > 0).slice(0, topN).map((x) => x.s);
}

function scoreSkill(skill: Skill, taskLower: string): number {
  let score = 0;
  for (const trig of skill.triggers ?? []) {
    if (taskLower.includes(trig.toLowerCase())) score += 5;
  }
  for (const word of (skill.description ?? "").toLowerCase().split(/\s+/)) {
    if (word.length < 4) continue;
    if (taskLower.includes(word)) score += 1;
  }
  for (const word of skill.name.toLowerCase().split(/[-_\s]+/)) {
    if (word.length < 4) continue;
    if (taskLower.includes(word)) score += 2;
  }
  return score;
}
