import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parse as parseYaml } from "yaml";
import {
  profileDir,
  profileSkillsDir,
  userSkillsDir,
} from "../paths.js";
import type { Skill, SkillScope, SkillOrigin, SkillInstallSpec } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Per-process cache: `which` results are stable for the lifetime of the
// daemon; checking every skill every cycle is wasteful.
const binCache = new Map<string, boolean>();

/** Load active skills - those whose platform / required bins match
 *  the current machine. This is what the agent cycle should use. */
export function loadAllSkills(profile: string): Skill[] {
  return loadAllSkillsRaw(profile).filter((s) => passesRuntimeChecks(s));
}

/** Load every parsed skill regardless of platform / bin checks. Used
 *  by `skill list` so users can see what's installed even when a skill
 *  is inactive on this box. Paired with `runtimeSkipReason` for UX. */
export function loadAllSkillsRaw(profile: string): Skill[] {
  const scopes: { dir: string; scope: SkillScope }[] = [
    { dir: join(profileDir(profile), "skills"), scope: "agent" },
    { dir: profileSkillsDir(profile), scope: "agent" },
    { dir: userSkillsDir(), scope: "bajaclaw-user" },
    { dir: repoBuiltinSkillsDir(), scope: "bajaclaw-builtin" },
  ];

  const byName = new Map<string, Skill>();
  for (const { dir, scope } of scopes) {
    if (!existsSync(dir)) continue;
    for (const skill of scanDir(dir, scope)) {
      if (!byName.has(skill.name)) byName.set(skill.name, skill);
    }
  }
  return Array.from(byName.values());
}

/** Return a short reason string if the skill is skipped on this box,
 *  else null. Used by `skill list` to annotate inactive skills. */
export function runtimeSkipReason(skill: Skill): string | null {
  if (skill.platforms && skill.platforms.length > 0) {
    const here = currentPlatformNames();
    if (!skill.platforms.some((p) => here.includes(p.toLowerCase()))) {
      return `platform ${skill.platforms.join("/")} (this: ${process.platform})`;
    }
  }
  if (skill.requiredBins) {
    const missing = skill.requiredBins.filter((b) => !hasBin(b));
    if (missing.length) return `missing bins: ${missing.join(", ")}`;
  }
  if (skill.anyBins && skill.anyBins.length > 0) {
    if (!skill.anyBins.some((b) => hasBin(b))) {
      return `none of these bins found: ${skill.anyBins.join(", ")}`;
    }
  }
  return null;
}

function repoBuiltinSkillsDir(): string {
  return join(__dirname, "..", "..", "skills");
}

function scanDir(dir: string, scope: SkillScope): Skill[] {
  const out: Skill[] = [];
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const entry of entries) {
    const full = join(dir, entry);
    let s; try { s = statSync(full); } catch { continue; }
    if (!s.isDirectory()) continue;
    // Accept SKILL.md (bajaclaw + hermes + openclaw canonical) or the
    // lowercase skill.md variant (openclaw also accepts it).
    const skillFile = existsSync(join(full, "SKILL.md"))
      ? join(full, "SKILL.md")
      : existsSync(join(full, "skill.md"))
        ? join(full, "skill.md")
        : null;
    if (!skillFile) continue;
    try {
      const raw = readFileSync(skillFile, "utf8");
      const parsed = parseSkill(raw, full, scope);
      if (parsed) out.push(parsed);
    } catch { /* ignore */ }
  }
  return out;
}

export function parseSkill(raw: string, path: string, scope: SkillScope): Skill | null {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return null;
  let fm: Record<string, unknown>;
  try {
    const parsed = parseYaml(m[1]!);
    fm = (parsed && typeof parsed === "object") ? parsed as Record<string, unknown> : {};
  } catch {
    return null;
  }
  const body = (m[2] ?? "").trim();
  const name = typeof fm.name === "string" ? fm.name.trim() : "";
  const description = typeof fm.description === "string" ? fm.description.trim() : "";
  if (!name) return null;

  const meta = fm.metadata && typeof fm.metadata === "object"
    ? fm.metadata as Record<string, unknown>
    : {};
  const openclawMeta = firstObject(meta, ["openclaw", "clawdbot", "clawdis"]);
  const hermesMeta = firstObject(meta, ["hermes"]);
  const origin: SkillOrigin = hermesMeta ? "hermes"
    : openclawMeta ? "openclaw"
    : "bajaclaw";

  // Platform list. Hermes uses top-level `platforms`; openclaw uses
  // `metadata.openclaw.os`. Bajaclaw has no platform field historically.
  const platformsRaw = arrField(fm.platforms) ?? arrField(openclawMeta?.os);

  // Required env vars.
  let requiredEnv: string[] | undefined;
  if (hermesMeta) {
    const list = fm.required_environment_variables;
    if (Array.isArray(list)) {
      const names: string[] = [];
      for (const item of list) {
        if (item && typeof item === "object" && typeof (item as { name?: unknown }).name === "string") {
          names.push((item as { name: string }).name);
        }
      }
      if (names.length) requiredEnv = names;
    }
  }
  if (openclawMeta) {
    const req = openclawMeta.requires as Record<string, unknown> | undefined;
    const envList = arrField(req?.env);
    if (envList) requiredEnv = Array.from(new Set([...(requiredEnv ?? []), ...envList]));
  }

  // Required bins (openclaw only).
  const requiredBins = arrField((openclawMeta?.requires as { bins?: unknown })?.bins);
  const anyBins = arrField((openclawMeta?.requires as { anyBins?: unknown })?.anyBins);

  // Hermes conditional activation.
  const requiresTools = arrField(hermesMeta?.requires_tools);
  const requiresToolsets = arrField(hermesMeta?.requires_toolsets);
  const fallbackForTools = arrField(hermesMeta?.fallback_for_tools);
  const fallbackForToolsets = arrField(hermesMeta?.fallback_for_toolsets);

  // Presentation / pointers.
  const tags = arrField(hermesMeta?.tags);
  const related = arrField(hermesMeta?.related_skills);
  const homepage = strField(openclawMeta?.homepage) ?? strField(fm.homepage);
  const emoji = strField(openclawMeta?.emoji);
  const primaryEnv = strField(openclawMeta?.primaryEnv);

  // Install specs (openclaw).
  let install: SkillInstallSpec[] | undefined;
  if (openclawMeta && Array.isArray(openclawMeta.install)) {
    const specs: SkillInstallSpec[] = [];
    for (const spec of openclawMeta.install as unknown[]) {
      if (!spec || typeof spec !== "object") continue;
      const o = spec as Record<string, unknown>;
      const kind = o.kind;
      if (kind !== "brew" && kind !== "node" && kind !== "go" && kind !== "uv") continue;
      specs.push({
        kind,
        formula: strField(o.formula),
        package: strField(o.package),
        module: strField(o.module),
        bins: arrField(o.bins),
        label: strField(o.label),
      });
    }
    if (specs.length) install = specs;
  }

  // Triggers: bajaclaw explicit. For imported skills without triggers,
  // fall back to tags (hermes) so matcher has something to score on.
  const triggers = arrField(fm.triggers) ?? tags;

  return {
    name,
    description,
    version: strField(fm.version),
    tools: arrField(fm.tools),
    triggers,
    effort: isEffort(fm.effort) ? fm.effort : undefined,
    body,
    path,
    scope,
    origin,
    platforms: platformsRaw,
    tags,
    homepage,
    emoji,
    primaryEnv,
    requiredEnv,
    requiredBins,
    anyBins,
    requiresTools,
    requiresToolsets,
    fallbackForTools,
    fallbackForToolsets,
    install,
    related,
  };
}

function passesRuntimeChecks(skill: Skill): boolean {
  // Platform gate. Map Node's `process.platform` (darwin|linux|win32)
  // to the canonical names both formats use (macos|linux|windows).
  if (skill.platforms && skill.platforms.length > 0) {
    const here = currentPlatformNames();
    const ok = skill.platforms.some((p) => here.includes(p.toLowerCase()));
    if (!ok) return false;
  }
  if (skill.requiredBins && skill.requiredBins.length > 0) {
    for (const b of skill.requiredBins) {
      if (!hasBin(b)) return false;
    }
  }
  if (skill.anyBins && skill.anyBins.length > 0) {
    const any = skill.anyBins.some((b) => hasBin(b));
    if (!any) return false;
  }
  return true;
}

function currentPlatformNames(): string[] {
  switch (process.platform) {
    case "darwin": return ["macos", "darwin"];
    case "linux": return ["linux"];
    case "win32": return ["windows", "win32"];
    default: return [process.platform];
  }
}

function hasBin(bin: string): boolean {
  const hit = binCache.get(bin);
  if (hit !== undefined) return hit;
  const cmd = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(cmd, [bin], { stdio: "ignore" });
  const ok = r.status === 0;
  binCache.set(bin, ok);
  return ok;
}

// ── Frontmatter helpers ─────────────────────────────────────────────

function firstObject(meta: Record<string, unknown>, keys: string[]): Record<string, unknown> | null {
  for (const k of keys) {
    const v = meta[k];
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  }
  return null;
}

function strField(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function arrField(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean);
  return out.length ? out : undefined;
}

function isEffort(v: unknown): v is "low" | "medium" | "high" | "xhigh" | "max" {
  return v === "low" || v === "medium" || v === "high" || v === "xhigh" || v === "max";
}
