// Curator phase-2 review prompt + YAML output parser.
// Asks an auxiliary model to consolidate the active skill library.

import { parse as parseYaml } from "yaml";
import type { CuratorProposedAction, SkillUsageEntry } from "../types.js";

export const CURATOR_REVIEW_PROMPT = `You are reviewing a skill library for an autonomous agent. Your job is to consolidate and prune.

A skill library where every session's bug is its own skill is BROKEN, not thorough. The right bar is: would a human maintainer write this as N separate skills, or as one skill with N labeled subsections?

Prefer:
- MERGE for near-duplicate skills covering the same procedure with different names.
- CREATE_UMBRELLA when 3+ siblings share a procedure shape; the originals demote to references/<child>.md so detail isn't lost.
- DEMOTE_TO_REFERENCES when a one-session skill is too narrow for top-level but has reference value under a parent.
- PRUNE only when a skill was never used and has no reusable shape.

Pinned skills are off-limits. Bundled and user-authored skills are off-limits.

Output strict YAML with this exact shape:

proposed_actions:
  - kind: merge
    skills: [name1, name2]
    into: combined-name
    rationale: "..."

  - kind: create_umbrella
    children: [setup-foo, setup-bar]
    umbrella_name: setup-things
    children_become: references
    rationale: "..."

  - kind: demote_to_references
    skills: [one-off]
    target_skill: parent
    rationale: "..."

  - kind: prune
    skill: dead
    rationale: "..."

If nothing is worth changing, output:
proposed_actions: []
`;

export interface CuratorReviewSkill {
  name: string;
  description: string;
  provenance: string;
  auto_generated: boolean;
  usage: SkillUsageEntry | null;
}

export interface CuratorReviewInput {
  profile: string;
  active_skills: CuratorReviewSkill[];
}

export function buildReviewPrompt(input: CuratorReviewInput): string {
  const lines: string[] = [CURATOR_REVIEW_PROMPT, "", `<library profile="${input.profile}">`];
  for (const s of input.active_skills) {
    const u = s.usage
      ? `use=${s.usage.use_count} view=${s.usage.view_count} last=${s.usage.last_used_at ?? "never"}`
      : "no_usage";
    const flags = `${s.provenance}${s.auto_generated ? ",auto" : ""}`;
    lines.push(`- ${s.name} [${flags}] (${u}): ${s.description}`);
  }
  lines.push("</library>");
  lines.push("");
  lines.push("Return YAML proposed_actions. No prose, no fence, no markdown.");
  return lines.join("\n");
}

const ALLOWED_KINDS = new Set(["merge", "create_umbrella", "demote_to_references", "prune"]);

export function parseReviewYaml(text: string): CuratorProposedAction[] {
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const arr = (parsed as Record<string, unknown>).proposed_actions;
  if (!Array.isArray(arr)) return [];
  const out: CuratorProposedAction[] = [];
  for (const a of arr) {
    if (!a || typeof a !== "object") continue;
    const o = a as Record<string, unknown>;
    if (typeof o.kind !== "string" || typeof o.rationale !== "string") continue;
    if (!ALLOWED_KINDS.has(o.kind)) continue;
    out.push(o as unknown as CuratorProposedAction);
  }
  return out;
}
