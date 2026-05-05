// MCP tool: skill_manage. The agent's self-learning entry point.
// Actions: create | edit | patch | delete | write_file | remove_file.

import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, unlinkSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { profileSkillsDir, profileSkillsArchiveDir } from "../paths.js";
import {
  recordCreate,
  recordPatch,
  recordDelete,
  readSidecar,
  setProvenance,
} from "./usage.js";
import { fuzzyPatch } from "./fuzzy-patch.js";
import { validateSkillSubpath } from "./path-safety.js";
import { invalidate as invalidateIndexCache } from "./index-cache.js";
import { loadAllSkills } from "./loader.js";
import { provenanceOf } from "./provenance.js";

export type SkillManageAction =
  | "create"
  | "edit"
  | "patch"
  | "delete"
  | "write_file"
  | "remove_file";

export interface SkillManageArgs {
  action: SkillManageAction;
  name: string;
  description?: string;
  body?: string;
  triggers?: string[];
  effort?: "low" | "medium" | "high";
  find?: string;
  replace?: string;
  absorbed_into?: string;
  reason?: string;
  path?: string;
  content?: string;
}

export interface SkillManageResult {
  ok: boolean;
  reason?: string;
  path?: string;
  range?: { start: number; end: number };
}

const NAME_RE = /^[a-z][a-z0-9_-]{1,63}$/;

export function skillManage(rawArgs: Record<string, unknown>, profile: string): SkillManageResult {
  const args = rawArgs as unknown as SkillManageArgs;
  const name = String(args?.name ?? "").trim();
  if (!name || !NAME_RE.test(name)) {
    return { ok: false, reason: "invalid name (kebab-case, 2-64 chars, must start with a letter)" };
  }

  switch (args?.action) {
    case "create": return createSkill(args, profile);
    case "edit": return editSkill(args, profile);
    case "patch": return patchSkill(args, profile);
    case "delete": return deleteSkill(args, profile);
    case "write_file": return writeSkillFile(args, profile);
    case "remove_file": return removeSkillFile(args, profile);
    default: return { ok: false, reason: `unknown action: ${String(args?.action)}` };
  }
}

function skillDirFor(profile: string, name: string): string {
  return join(profileSkillsDir(profile), name);
}

function archiveDirFor(profile: string, name: string): string {
  return join(profileSkillsArchiveDir(profile), name);
}

interface MutGuardResult { ok: true; }
interface MutGuardErr { ok: false; reason: string; }

function checkMutable(profile: string, name: string): MutGuardResult | MutGuardErr {
  const sidecar = readSidecar(profile);
  const usage = sidecar.skills[name];
  if (usage?.pinned) {
    return { ok: false, reason: `skill '${name}' is pinned; run 'bajaclaw skill unpin ${name}' before mutating` };
  }
  const all = loadAllSkills(profile);
  const skill = all.find((s) => s.name === name);
  if (skill) {
    const prov = usage?.provenance ?? provenanceOf(skill, profile);
    if (prov === "bundled") {
      return { ok: false, reason: `skill '${name}' is bundled; read-only` };
    }
    if (prov === "user") {
      return { ok: false, reason: `skill '${name}' is manually authored; read-only to the agent` };
    }
  }
  return { ok: true };
}

function buildFrontmatter(args: SkillManageArgs): string {
  const lines: string[] = ["---"];
  lines.push(`name: ${args.name}`);
  lines.push(`description: ${args.description}`);
  lines.push(`version: 0.1.0`);
  lines.push(`auto_generated: true`);
  lines.push(`created_at: ${new Date().toISOString()}`);
  if (args.triggers && args.triggers.length) {
    lines.push(`triggers: ${JSON.stringify(args.triggers)}`);
  }
  if (args.effort) {
    lines.push(`effort: ${args.effort}`);
  }
  lines.push("---");
  return lines.join("\n");
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}

function createSkill(args: SkillManageArgs, profile: string): SkillManageResult {
  if (!args.description) return { ok: false, reason: "description is required" };
  if (!args.body) return { ok: false, reason: "body is required" };

  const dir = skillDirFor(profile, args.name);
  const path = join(dir, "SKILL.md");
  if (existsSync(path)) return { ok: false, reason: `skill '${args.name}' already exists; use action='edit' or 'patch'` };

  const fm = buildFrontmatter(args);
  atomicWrite(path, `${fm}\n\n${args.body.trimEnd()}\n`);
  recordCreate(profile, args.name, "agent");
  setProvenance(profile, args.name, "agent");
  invalidateIndexCache(profile);
  return { ok: true, path };
}

function editSkill(args: SkillManageArgs, profile: string): SkillManageResult {
  const guard = checkMutable(profile, args.name);
  if (!guard.ok) return guard;
  if (!args.body) return { ok: false, reason: "body is required" };

  const path = join(skillDirFor(profile, args.name), "SKILL.md");
  if (!existsSync(path)) return { ok: false, reason: `skill '${args.name}' not found` };

  const raw = readFileSync(path, "utf8");
  const fmMatch = raw.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
  // If the skill has no frontmatter, generate one from args. Otherwise
  // preserve the existing frontmatter exactly.
  const fm = fmMatch ? fmMatch[0] : `${buildFrontmatter(args)}\n\n`;
  atomicWrite(path, `${fm.replace(/\n*$/, "\n")}\n${args.body.trimEnd()}\n`);
  recordPatch(profile, args.name);
  invalidateIndexCache(profile);
  return { ok: true, path };
}

function patchSkill(args: SkillManageArgs, profile: string): SkillManageResult {
  const guard = checkMutable(profile, args.name);
  if (!guard.ok) return guard;
  if (!args.find) return { ok: false, reason: "find is required" };
  if (args.replace === undefined || args.replace === null) {
    return { ok: false, reason: "replace is required (use empty string to delete the matched range)" };
  }

  const path = join(skillDirFor(profile, args.name), "SKILL.md");
  if (!existsSync(path)) return { ok: false, reason: `skill '${args.name}' not found` };
  const raw = readFileSync(path, "utf8");

  const r = fuzzyPatch(raw, args.find, args.replace);
  if (!r.ok) return { ok: false, reason: r.reason };
  atomicWrite(path, r.body);
  recordPatch(profile, args.name);
  invalidateIndexCache(profile);
  return { ok: true, path, range: r.range };
}

function deleteSkill(args: SkillManageArgs, profile: string): SkillManageResult {
  const guard = checkMutable(profile, args.name);
  if (!guard.ok) return guard;

  const absorbed = args.absorbed_into;
  if (absorbed === undefined || absorbed === null) {
    return { ok: false, reason: "absorbed_into is required (empty string allowed for true prune, with reason)" };
  }
  if (absorbed === "" && !args.reason) {
    return { ok: false, reason: "reason is required when absorbed_into is empty" };
  }
  if (absorbed) {
    const all = loadAllSkills(profile);
    const target = all.find((s) => s.name === absorbed);
    if (!target) return { ok: false, reason: `absorbed_into target '${absorbed}' not found` };
  }

  const dir = skillDirFor(profile, args.name);
  const archDir = archiveDirFor(profile, args.name);
  if (!existsSync(dir)) return { ok: false, reason: `skill '${args.name}' not found` };

  mkdirSync(dirname(archDir), { recursive: true });
  if (existsSync(archDir)) rmSync(archDir, { recursive: true, force: true });
  renameSync(dir, archDir);
  recordDelete(profile, args.name, absorbed, args.reason);
  invalidateIndexCache(profile);
  return { ok: true, path: archDir };
}

function writeSkillFile(args: SkillManageArgs, profile: string): SkillManageResult {
  const guard = checkMutable(profile, args.name);
  if (!guard.ok) return guard;
  if (!args.path) return { ok: false, reason: "path is required" };
  if (args.content === undefined) return { ok: false, reason: "content is required" };

  const dir = skillDirFor(profile, args.name);
  if (!existsSync(dir)) return { ok: false, reason: `skill '${args.name}' not found` };
  const v = validateSkillSubpath(dir, args.path);
  if (!v.ok || !v.absolute) return { ok: false, reason: v.reason };

  atomicWrite(v.absolute, args.content);
  recordPatch(profile, args.name);
  return { ok: true, path: v.absolute };
}

function removeSkillFile(args: SkillManageArgs, profile: string): SkillManageResult {
  const guard = checkMutable(profile, args.name);
  if (!guard.ok) return guard;
  if (!args.path) return { ok: false, reason: "path is required" };

  const dir = skillDirFor(profile, args.name);
  const v = validateSkillSubpath(dir, args.path);
  if (!v.ok || !v.absolute) return { ok: false, reason: v.reason };
  if (!existsSync(v.absolute)) return { ok: false, reason: "file not found" };

  unlinkSync(v.absolute);
  recordPatch(profile, args.name);
  return { ok: true, path: v.absolute };
}
