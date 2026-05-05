// Determine the provenance of a loaded skill (where the file lives on
// disk) so the agent and curator know what's safe to mutate.
//
//   agent    skill written by skill_manage in the per-profile dir
//   user     manually authored, lives in the shared user dir
//   bundled  shipped with bajaclaw, lives in the repo dir

import { resolve } from "node:path";
import type { Skill, SkillProvenance } from "../types.js";
import { profileSkillsDir, userSkillsDir } from "../paths.js";

export function provenanceOf(skill: Skill, profile: string): SkillProvenance {
  const profDir = resolve(profileSkillsDir(profile));
  const userDir = resolve(userSkillsDir());
  const path = resolve(skill.path);
  if (path.startsWith(profDir + "/")) return "agent";
  if (path.startsWith(userDir + "/")) return "user";
  return "bundled";
}
