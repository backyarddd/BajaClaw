import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  profileDir,
  profileSkillsDir,
  userSkillsDir,
  claudeSkillsDir,
} from "../paths.js";
import type { Skill, SkillScope } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadAllSkills(profile: string): Skill[] {
  const scopes: { dir: string; scope: SkillScope }[] = [
    { dir: join(profileDir(profile), "skills"), scope: "agent" },
    { dir: profileSkillsDir(profile), scope: "agent" },
    { dir: userSkillsDir(), scope: "bajaclaw-user" },
    { dir: repoBuiltinSkillsDir(), scope: "bajaclaw-builtin" },
    { dir: claudeSkillsDir(), scope: "claude-user" },
    { dir: join(process.cwd(), ".claude", "skills"), scope: "claude-project" },
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

function repoBuiltinSkillsDir(): string {
  return join(__dirname, "..", "..", "..", "skills");
}

function scanDir(dir: string, scope: SkillScope): Skill[] {
  const out: Skill[] = [];
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const entry of entries) {
    const full = join(dir, entry);
    let s; try { s = statSync(full); } catch { continue; }
    if (!s.isDirectory()) continue;
    const skillFile = join(full, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    try {
      const raw = readFileSync(skillFile, "utf8");
      const parsed = parseSkill(raw, full, scope);
      if (parsed) out.push(parsed);
    } catch { /* ignore */ }
  }
  return out;
}

export function parseSkill(raw: string, path: string, scope: SkillScope): Skill | null {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!m) return null;
  const fm = parseFrontmatter(m[1]!);
  const body = m[2]!.trim();
  const name = String(fm.name ?? "").trim();
  const description = String(fm.description ?? "").trim();
  if (!name) return null;
  return {
    name,
    description,
    version: fm.version ? String(fm.version) : undefined,
    tools: Array.isArray(fm.tools) ? fm.tools.map(String) : undefined,
    triggers: Array.isArray(fm.triggers) ? fm.triggers.map(String) : undefined,
    effort: (fm.effort as "low" | "medium" | "high" | undefined),
    body,
    path,
    scope,
  };
}

function parseFrontmatter(block: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = block.split(/\r?\n/);
  let key: string | null = null;
  let listBuffer: string[] | null = null;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;

    if (listBuffer && line.startsWith("  - ")) {
      listBuffer.push(line.slice(4).trim());
      continue;
    }
    if (listBuffer && key) {
      out[key] = listBuffer;
      listBuffer = null;
      key = null;
    }

    const inline = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!inline) continue;
    const k = inline[1]!;
    const v = inline[2]!.trim();

    if (v === "") { key = k; listBuffer = []; continue; }

    if (v.startsWith("[") && v.endsWith("]")) {
      out[k] = v.slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      continue;
    }
    out[k] = v.replace(/^["']|["']$/g, "");
  }
  if (listBuffer && key) out[key] = listBuffer;
  return out;
}
