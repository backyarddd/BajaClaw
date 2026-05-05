// Curator: idle-triggered library consolidation. Two phases.
//
// Phase 1 (pure-function lifecycle transitions):
//   active -> stale     when no usage in >30 days
//   stale  -> archived  when no usage in >90 days (file moves to .archive)
//   stale  -> active    when usage observed since last curator pass
//
// Phase 2 (forked LLM review): see runCurator. Off in this file's
// public surface until phase 2 lands; this module exposes runPhase1
// and the state-file helpers.
//
// Pinned skills are immune. provenance != "agent" skills are immune.

import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import {
  profileSkillsDir,
  profileSkillsArchiveDir,
  profileCuratorStatePath,
  profileSkillUsagePath,
} from "../paths.js";
import { readSidecar, recordStateTransition } from "./usage.js";
import { invalidate as invalidateIndexCache } from "./index-cache.js";
import type { CuratorState, SkillUsageEntry } from "../types.js";

const DAY = 86_400_000;
const STALE_AFTER_DAYS = 30;
const ARCHIVE_AFTER_DAYS = 90;

export interface Phase1Result {
  transitions: number;
  archived: string[];
}

export function runPhase1(profile: string): Phase1Result {
  const sidecar = readSidecar(profile);
  let transitions = 0;
  const archived: string[] = [];
  const now = Date.now();

  for (const [name, entry] of Object.entries(sidecar.skills)) {
    if (entry.pinned) continue;
    if (entry.provenance !== "agent") continue;

    const last = lastActivityMs(entry);
    const ageDays = (now - last) / DAY;

    // Reactivation first.
    if (entry.state === "stale" && ageDays < STALE_AFTER_DAYS) {
      recordStateTransition(profile, name, "active");
      transitions++;
      continue;
    }
    if (entry.state === "active" && ageDays > STALE_AFTER_DAYS) {
      recordStateTransition(profile, name, "stale");
      transitions++;
      continue;
    }
    if (entry.state === "stale" && ageDays > ARCHIVE_AFTER_DAYS) {
      archiveSkill(profile, name);
      recordStateTransition(profile, name, "archived");
      transitions++;
      archived.push(name);
      continue;
    }
  }
  if (transitions > 0) invalidateIndexCache(profile);
  return { transitions, archived };
}

function lastActivityMs(entry: SkillUsageEntry): number {
  const candidates = [
    entry.last_used_at,
    entry.last_viewed_at,
    entry.last_patched_at,
    entry.created_at,
  ]
    .filter((x): x is string => Boolean(x))
    .map((x) => Date.parse(x))
    .filter((n) => Number.isFinite(n));
  return candidates.length ? Math.max(...candidates) : Date.now();
}

function archiveSkill(profile: string, name: string): void {
  const src = join(profileSkillsDir(profile), name);
  const dst = join(profileSkillsArchiveDir(profile), name);
  if (!existsSync(src)) return;
  mkdirSync(dirname(dst), { recursive: true });
  if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });
  renameSync(src, dst);
}

// ── State file ───────────────────────────────────────────────────────

export function readCuratorState(profile: string): CuratorState {
  const path = profileCuratorStatePath(profile);
  if (!existsSync(path)) {
    return { last_curator_at: null, first_run_marker_at: null, dry_run_count: 0 };
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CuratorState;
  } catch {
    return { last_curator_at: null, first_run_marker_at: null, dry_run_count: 0 };
  }
}

export function writeCuratorState(profile: string, state: CuratorState): void {
  const path = profileCuratorStatePath(profile);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmp, path);
}

// ── Test-only helpers ────────────────────────────────────────────────

/** Internal: forcibly backdate all timestamps for a skill. Test-only. */
export function _setLastUsed(profile: string, name: string, iso: string): void {
  const sidecarPath = profileSkillUsagePath(profile);
  const s = readSidecar(profile);
  if (s.skills[name]) {
    s.skills[name]!.last_used_at = iso;
    s.skills[name]!.last_viewed_at = iso;
    s.skills[name]!.last_patched_at = iso;
    s.skills[name]!.created_at = iso;
  }
  writeFileSync(sidecarPath, JSON.stringify(s, null, 2), "utf8");
}

/** Internal: set a skill's state directly. Test-only. */
export function _setState(
  profile: string,
  name: string,
  state: "active" | "stale" | "archived",
): void {
  recordStateTransition(profile, name, state);
}
