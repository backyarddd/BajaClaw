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
  profileCuratorLogsDir,
  profileSkillUsagePath,
} from "../paths.js";
import { readSidecar, recordStateTransition } from "./usage.js";
import { invalidate as invalidateIndexCache } from "./index-cache.js";
import { skillManage } from "./skill-manage.js";
import { skillView } from "./skill-view.js";
import { loadAllSkills } from "./loader.js";
import { provenanceOf } from "./provenance.js";
import {
  buildReviewPrompt,
  parseReviewYaml,
  type CuratorReviewInput,
} from "./curator-prompt.js";
import type {
  CuratorState,
  CuratorConfig,
  CuratorProposedAction,
  SkillUsageEntry,
} from "../types.js";

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

// ── Phase 2: forked LLM review ──────────────────────────────────────

export const CURATOR_DEFAULT: Required<CuratorConfig> = {
  enabled: true,
  intervalHours: 168,
  dryRun: true,
  minIdleHours: 2,
  maxActionsPerRun: 5,
};

export type CuratorRunner = (prompt: string) => Promise<{ ok: boolean; text: string; error?: string }>;

export interface CuratorRunResult {
  ran: boolean;
  reason: string;
  transitions: number;
  proposed: CuratorProposedAction[];
  executed: CuratorProposedAction[];
  errors: string[];
  reportPath: string | null;
}

export async function runCurator(
  profile: string,
  cfg: CuratorConfig = CURATOR_DEFAULT,
  runner?: CuratorRunner,
): Promise<CuratorRunResult> {
  const merged = { ...CURATOR_DEFAULT, ...(cfg ?? {}) };
  const errors: string[] = [];
  const phase1 = runPhase1(profile);

  // Build phase-2 input from the post-phase-1 state.
  const sidecar = readSidecar(profile);
  const all = loadAllSkills(profile);
  const active = all.filter((s) => {
    const u = sidecar.skills[s.name];
    if (!u) return true;
    return u.state === "active";
  });
  const input: CuratorReviewInput = {
    profile,
    active_skills: active.map((s) => ({
      name: s.name,
      description: s.description ?? "",
      provenance: sidecar.skills[s.name]?.provenance ?? provenanceOf(s, profile),
      auto_generated: Boolean(s.autoGenerated),
      usage: sidecar.skills[s.name] ?? null,
    })),
  };

  const prompt = buildReviewPrompt(input);
  const exec: CuratorRunner = runner ?? defaultRunner;
  let yaml = "";
  try {
    const r = await exec(prompt);
    if (!r.ok) errors.push(`runner failed: ${r.error ?? "no output"}`);
    yaml = r.text ?? "";
  } catch (e) {
    errors.push(`runner threw: ${(e as Error).message}`);
  }

  const proposed = parseReviewYaml(yaml);
  const capped = proposed.slice(0, merged.maxActionsPerRun);
  const executed: CuratorProposedAction[] = [];

  if (!merged.dryRun) {
    for (const action of capped) {
      const res = await executeAction(profile, action);
      if (res.ok) executed.push(action);
      else errors.push(`exec ${action.kind}: ${res.reason}`);
    }
  }

  // Persist state.
  const state = readCuratorState(profile);
  writeCuratorState(profile, {
    last_curator_at: new Date().toISOString(),
    first_run_marker_at: state.first_run_marker_at,
    dry_run_count: merged.dryRun ? state.dry_run_count + 1 : state.dry_run_count,
  });

  const reportPath = writeReport(profile, {
    input,
    proposed,
    executed,
    errors,
    dryRun: merged.dryRun,
  });

  return {
    ran: true,
    reason: merged.dryRun ? "dry-run" : "live",
    transitions: phase1.transitions,
    proposed,
    executed,
    errors,
    reportPath,
  };
}

interface ActionResult { ok: boolean; reason?: string; }

async function executeAction(
  profile: string,
  action: CuratorProposedAction,
): Promise<ActionResult> {
  switch (action.kind) {
    case "merge": {
      if (!action.skills || !action.into) return { ok: false, reason: "merge missing skills/into" };
      const bodies: string[] = [];
      for (const child of action.skills) {
        const v = skillView({ name: child }, profile);
        if (v.ok && v.body) bodies.push(`## ${child}\n\n${v.body}`);
      }
      const merged = bodies.join("\n\n---\n\n");
      const create = skillManage(
        { action: "create", name: action.into, description: action.rationale, body: merged },
        profile,
      );
      if (!create.ok) return create;
      for (const child of action.skills) {
        const guard = checkAgentMutable(profile, child);
        if (!guard) continue;
        skillManage({ action: "delete", name: child, absorbed_into: action.into }, profile);
      }
      return { ok: true };
    }
    case "create_umbrella": {
      if (!action.children || !action.umbrella_name) return { ok: false, reason: "umbrella missing fields" };
      const create = skillManage(
        {
          action: "create",
          name: action.umbrella_name,
          description: action.rationale,
          body: `Umbrella for: ${action.children.join(", ")}\n\nSee references/ for per-child detail.`,
        },
        profile,
      );
      if (!create.ok) return create;
      for (const child of action.children) {
        const v = skillView({ name: child }, profile);
        if (v.ok && v.body) {
          skillManage(
            { action: "write_file", name: action.umbrella_name, path: `references/${child}.md`, content: v.body },
            profile,
          );
        }
        const guard = checkAgentMutable(profile, child);
        if (!guard) continue;
        skillManage({ action: "delete", name: child, absorbed_into: action.umbrella_name }, profile);
      }
      return { ok: true };
    }
    case "demote_to_references": {
      if (!action.skills || !action.target_skill) return { ok: false, reason: "demote missing fields" };
      for (const s of action.skills) {
        const v = skillView({ name: s }, profile);
        if (!v.ok || !v.body) continue;
        skillManage(
          { action: "write_file", name: action.target_skill, path: `references/${s}.md`, content: v.body },
          profile,
        );
        const guard = checkAgentMutable(profile, s);
        if (!guard) continue;
        skillManage({ action: "delete", name: s, absorbed_into: action.target_skill }, profile);
      }
      return { ok: true };
    }
    case "prune": {
      if (!action.skill) return { ok: false, reason: "prune missing skill" };
      return skillManage(
        { action: "delete", name: action.skill, absorbed_into: "", reason: action.rationale },
        profile,
      );
    }
    default:
      return { ok: false, reason: "unknown action kind" };
  }
}

function checkAgentMutable(profile: string, name: string): boolean {
  const sidecar = readSidecar(profile);
  const u = sidecar.skills[name];
  if (!u) return true; // unknown - skill_manage will reject if needed
  if (u.pinned) return false;
  if (u.provenance !== "agent") return false;
  return true;
}

async function defaultRunner(prompt: string): Promise<{ ok: boolean; text: string; error?: string }> {
  const { runOnce } = await import("../claude.js");
  const r = await runOnce(prompt, {
    model: "claude-haiku-4-5",
    effort: "medium",
    printMode: true,
    disallowedTools: ["Bash", "Write", "Edit", "Read", "Grep", "Glob", "WebSearch", "WebFetch"],
  });
  return { ok: r.ok, text: r.text ?? "", error: r.error };
}

interface ReportPayload {
  input: CuratorReviewInput;
  proposed: CuratorProposedAction[];
  executed: CuratorProposedAction[];
  errors: string[];
  dryRun: boolean;
}

function writeReport(profile: string, payload: ReportPayload): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(profileCuratorLogsDir(profile), ts);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "run.json"), JSON.stringify(payload, null, 2));
  const md: string[] = [
    `# Curator run ${ts}`,
    "",
    `Profile: ${profile}`,
    `Mode: ${payload.dryRun ? "DRY-RUN" : "LIVE"}`,
    `Skills reviewed: ${payload.input.active_skills.length}`,
    `Proposed actions: ${payload.proposed.length}`,
    `Executed: ${payload.executed.length}`,
    `Errors: ${payload.errors.length}`,
    "",
    "## Proposed",
    ...payload.proposed.map((a) => `- ${a.kind}: ${a.rationale}`),
    "",
    "## Executed",
    ...payload.executed.map((a) => `- ${a.kind}: ${a.rationale}`),
  ];
  if (payload.errors.length) {
    md.push("", "## Errors");
    for (const e of payload.errors) md.push(`- ${e}`);
  }
  writeFileSync(join(dir, "REPORT.md"), md.join("\n"));
  return dir;
}

// ── Daemon hook ──────────────────────────────────────────────────────

export interface CuratorLogger {
  info: (event: string, data?: Record<string, unknown>) => void;
  warn: (event: string, data?: Record<string, unknown>) => void;
}

/** Called from the daemon loop after each cycle. Cheap when not eligible. */
export async function maybeRunCurator(
  profile: string,
  cfg: CuratorConfig | undefined,
  log?: CuratorLogger,
): Promise<void> {
  const merged = { ...CURATOR_DEFAULT, ...(cfg ?? {}) };
  if (!merged.enabled) return;

  const state = readCuratorState(profile);
  if (!state.first_run_marker_at) {
    writeCuratorState(profile, { ...state, first_run_marker_at: new Date().toISOString() });
    return;
  }
  const referenceTime = state.last_curator_at ?? state.first_run_marker_at;
  const ageHours = (Date.now() - Date.parse(referenceTime)) / 3_600_000;
  if (ageHours < merged.intervalHours) return;

  log?.info("curator.start", { profile });
  try {
    const r = await runCurator(profile, merged);
    log?.info("curator.done", {
      profile,
      transitions: r.transitions,
      proposed: r.proposed.length,
      executed: r.executed.length,
      mode: merged.dryRun ? "dry-run" : "live",
      reportPath: r.reportPath,
    });
  } catch (e) {
    log?.warn("curator.fail", { profile, error: (e as Error).message });
  }
}
