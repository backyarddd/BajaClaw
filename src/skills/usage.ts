// Sidecar telemetry for the self-learning skills system.
// Stored at ~/.bajaclaw/profiles/<profile>/skills/.usage.json.
// Atomic writes via tempfile + rename. No locking: cycles serialize per
// profile and the curator never runs concurrent with cycles.

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { profileSkillUsagePath, profileSkillsDir } from "../paths.js";
import type {
  SkillSidecar,
  SkillUsageEntry,
  SkillProvenance,
  SkillState,
} from "../types.js";

function emptySidecar(): SkillSidecar {
  return { schema_version: 1, skills: {}, deleted: {} };
}

export function readSidecar(profile: string): SkillSidecar {
  // Ensure parent dir exists so subsequent writes don't ENOENT.
  mkdirSync(profileSkillsDir(profile), { recursive: true });
  const path = profileSkillUsagePath(profile);
  if (!existsSync(path)) return emptySidecar();
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<SkillSidecar>;
    return migrate(parsed);
  } catch {
    return emptySidecar();
  }
}

function migrate(parsed: Partial<SkillSidecar>): SkillSidecar {
  const base = emptySidecar();
  if (parsed && typeof parsed === "object") {
    if (parsed.skills && typeof parsed.skills === "object") {
      base.skills = parsed.skills as Record<string, SkillUsageEntry>;
    }
    if (parsed.deleted && typeof parsed.deleted === "object") {
      base.deleted = parsed.deleted as SkillSidecar["deleted"];
    }
  }
  return base;
}

function writeSidecar(profile: string, sidecar: SkillSidecar): void {
  const path = profileSkillUsagePath(profile);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  writeFileSync(tmp, JSON.stringify(sidecar, null, 2), "utf8");
  renameSync(tmp, path);
}

function nowIso(): string { return new Date().toISOString(); }

function ensureEntry(s: SkillSidecar, name: string, provenance: SkillProvenance): SkillUsageEntry {
  if (!s.skills[name]) {
    s.skills[name] = {
      use_count: 0,
      view_count: 0,
      patch_count: 0,
      last_used_at: null,
      last_viewed_at: null,
      last_patched_at: null,
      created_at: nowIso(),
      state: "active",
      pinned: false,
      provenance,
    };
  }
  return s.skills[name]!;
}

function reactivate(entry: SkillUsageEntry): void {
  if (entry.state === "stale") entry.state = "active";
}

export function recordCreate(profile: string, name: string, provenance: SkillProvenance): void {
  const s = readSidecar(profile);
  const e = ensureEntry(s, name, provenance);
  e.use_count++;
  e.last_used_at = nowIso();
  reactivate(e);
  writeSidecar(profile, s);
}

export function recordView(profile: string, name: string): void {
  const s = readSidecar(profile);
  const e = ensureEntry(s, name, "user");
  e.view_count++;
  e.last_viewed_at = nowIso();
  reactivate(e);
  writeSidecar(profile, s);
}

export function recordPatch(profile: string, name: string): void {
  const s = readSidecar(profile);
  const e = ensureEntry(s, name, "agent");
  e.patch_count++;
  e.last_patched_at = nowIso();
  reactivate(e);
  writeSidecar(profile, s);
}

export function recordDelete(
  profile: string,
  name: string,
  absorbedInto: string,
  reason?: string,
): void {
  const s = readSidecar(profile);
  delete s.skills[name];
  s.deleted[name] = {
    absorbed_into: absorbedInto,
    deleted_at: nowIso(),
    ...(reason ? { reason } : {}),
  };
  writeSidecar(profile, s);
}

export function recordPin(profile: string, name: string, pinned: boolean): void {
  const s = readSidecar(profile);
  const e = ensureEntry(s, name, "user");
  e.pinned = pinned;
  writeSidecar(profile, s);
}

export function recordStateTransition(
  profile: string,
  name: string,
  newState: SkillState,
): void {
  const s = readSidecar(profile);
  const e = ensureEntry(s, name, "user");
  e.state = newState;
  writeSidecar(profile, s);
}

export function setProvenance(
  profile: string,
  name: string,
  provenance: SkillProvenance,
): void {
  const s = readSidecar(profile);
  const e = ensureEntry(s, name, provenance);
  e.provenance = provenance;
  writeSidecar(profile, s);
}
