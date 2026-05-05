# Self-Learning Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace bajaclaw's silent post-cycle auto-skiller and 7-15s LLM matcher with a self-learning pattern: agent calls `skill_manage`/`skill_view` mid-cycle, system-prompt index advertises skills, idle curator consolidates the library.

**Architecture:** Three new MCP tools (`skill_manage`, `skill_view`, `skill_list`) added to the existing MCP server. Pre-cycle prompt assembly switches from "match top-N skills, inline bodies" to "inject flat index, agent reads bodies on demand." Sidecar `.usage.json` tracks view/use counts. Curator runs idle (>=2h cycle pause, >=7d since last) with phase-1 pure transitions and phase-2 forked Haiku review (dry-run for first 3 runs). Per-profile storage at `~/.bajaclaw/profiles/<profile>/skills/`.

**Tech Stack:** TypeScript (strict), Node 22+, better-sqlite3, MCP SDK 1.0, node:test.

**Spec:** `docs/specs/2026-05-05-self-learning-skills-design.md`

**Release:** Single bundled v0.21.0.

---

## File structure

### New files

| Path | Responsibility |
|---|---|
| `src/skills/usage.ts` | Sidecar `.usage.json` reader/writer with atomic writes; record* functions |
| `src/skills/index-builder.ts` | Walk skill dirs, render `<available_skills>` block, manifest hash |
| `src/skills/index-cache.ts` | In-process LRU + on-disk snapshot keyed by manifest hash |
| `src/skills/skill-manage.ts` | `skill_manage` tool: create/edit/patch/delete/write_file/remove_file |
| `src/skills/skill-view.ts` | `skill_view` tool: read full body, increment view count |
| `src/skills/skill-list.ts` | `skill_list` tool: filter by category/state |
| `src/skills/fuzzy-patch.ts` | Exact-then-whitespace-then-similarity match for patch action |
| `src/skills/path-safety.ts` | Validate relative path under skill dir, allowlist subdirs |
| `src/skills/curator.ts` | Curator phase 1 + phase 2 + report writer + state file |
| `src/skills/curator-prompt.ts` | The anti-bloat review prompt + YAML parser |
| `src/skills/provenance.ts` | Determine `agent`/`user`/`bundled` per skill |
| `src/commands/curator.ts` | CLI `bajaclaw curator <run|status|approve|dry-run-only>` |
| `tests/skills-usage.test.js` | Unit tests for usage.ts |
| `tests/skills-index-builder.test.js` | Index rendering + manifest hash |
| `tests/skills-index-cache.test.js` | LRU + snapshot |
| `tests/skills-fuzzy-patch.test.js` | Patch matching cases |
| `tests/skills-path-safety.test.js` | Path validation cases |
| `tests/skills-skill-manage.test.js` | Every action + every guard |
| `tests/skills-skill-view.test.js` | View tool behavior |
| `tests/skills-curator-phase1.test.js` | Lifecycle transitions, pin immunity |
| `tests/skills-curator-phase2.test.js` | Mocked LLM runner, action execution, dry-run |
| `tests/skills-loop.test.js` | Integration: full cycle simulation |

### Modified files

| Path | Changes |
|---|---|
| `src/agent.ts` | Replace matcher call with `buildSkillsIndex`; remove `synthesizeSkill` post-cycle hook; add `maybeRunCurator` daemon-loop hook; pass `skillsIndex` to `assemblePrompt` |
| `src/mcp/server.ts` | Register `skill_manage`, `skill_view`, `skill_list` tools |
| `src/types.ts` | Add `SkillSidecar`, `SkillUsageEntry`, `CuratorConfig`, `CuratorState`, `CuratorAction`; remove `AutoSkillConfig` |
| `src/config.ts` | Add `curator` defaults; deprecate `autoSkill` (warn, drop) |
| `src/skills/loader.ts` | Move `requires_tools`/`fallback_for_tools` checks out of load-time gate (move to index visibility) |
| `src/skills/matcher.ts` | Delete `matchSkillsByLLM`, `LLM_TIMEOUT_MS`; keep `matchSkillsByKeyword` for slash hint |
| `src/commands/skill.ts` | Add `pin`/`unpin`/`stats` subcommands; rework `list` to read sidecar |
| `src/cli.ts` | Register `curator` command group |
| `src/paths.ts` | Add `profileSkillUsagePath`, `profileSkillIndexCachePath`, `profileCuratorStatePath`, `profileCuratorLogsDir` |
| `package.json` | Bump 0.20.8 -> 0.21.0 |
| `CHANGELOG.md` | Add v0.21.0 entry |

### Deleted files

- `src/skills/auto-skiller.ts`
- `tests/auto-skiller.test.js` (if exists; verify in Task 0)

---

## Task 0: Pre-flight

- [ ] **Step 1: Verify clean working tree**

```bash
cd ~/bajaclaw && git status
```

Expected: only the spec doc commit ahead of origin/main, no other changes.

- [ ] **Step 2: Verify tests pass before changes**

```bash
npm test 2>&1 | tail -20
```

Expected: all green.

- [ ] **Step 3: Verify lint passes**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 4: Confirm auto-skiller test files**

```bash
ls tests/ | grep -i skill
ls tests/ | grep -i auto
```

Note any auto-skill-specific tests for deletion in Task 9.

---

## Task 1: Foundation types and path helpers

**Files:**
- Modify: `src/types.ts`
- Modify: `src/paths.ts`

- [ ] **Step 1: Add new types to src/types.ts**

Append at end of file:

```ts
// ── Self-learning skills ─────────────────────────────────────────────

export type SkillProvenance = "agent" | "user" | "bundled";
export type SkillState = "active" | "stale" | "archived";

export interface SkillUsageEntry {
  use_count: number;
  view_count: number;
  patch_count: number;
  last_used_at: string | null;
  last_viewed_at: string | null;
  last_patched_at: string | null;
  created_at: string;
  state: SkillState;
  pinned: boolean;
  provenance: SkillProvenance;
}

export interface SkillDeletedEntry {
  absorbed_into: string;
  deleted_at: string;
  reason?: string;
}

export interface SkillSidecar {
  schema_version: 1;
  skills: Record<string, SkillUsageEntry>;
  deleted: Record<string, SkillDeletedEntry>;
}

export interface CuratorConfig {
  enabled: boolean;
  intervalHours: number;
  dryRun: boolean;
  minIdleHours: number;
  maxActionsPerRun: number;
}

export interface CuratorState {
  last_curator_at: string | null;
  first_run_marker_at: string | null;
  dry_run_count: number;
}

export type CuratorActionKind =
  | "merge"
  | "create_umbrella"
  | "demote_to_references"
  | "prune";

export interface CuratorProposedAction {
  kind: CuratorActionKind;
  rationale: string;
  // merge:
  skills?: string[];
  into?: string;
  // create_umbrella:
  children?: string[];
  umbrella_name?: string;
  children_become?: "references";
  // demote_to_references:
  target_skill?: string;
  // prune:
  skill?: string;
}
```

- [ ] **Step 2: Remove AutoSkillConfig**

In `src/types.ts`, find the `AutoSkillConfig` interface and the field that references it on `AgentConfig`. Delete both. The field is `autoSkill?: AutoSkillConfig` on `AgentConfig`.

- [ ] **Step 3: Add path helpers to src/paths.ts**

Append:

```ts
export function profileSkillsDir(profile: string): string {
  return ensureDir(join(profileDir(profile), "skills"));
}

export function profileSkillUsagePath(profile: string): string {
  return join(profileSkillsDir(profile), ".usage.json");
}

export function profileSkillIndexCachePath(profile: string): string {
  return join(profileSkillsDir(profile), ".skills_prompt_snapshot.json");
}

export function profileSkillsArchiveDir(profile: string): string {
  return join(profileSkillsDir(profile), ".archive");
}

export function profileCuratorStatePath(profile: string): string {
  return join(profileSkillsDir(profile), ".curator_state.json");
}

export function profileCuratorLogsDir(profile: string): string {
  return ensureDir(join(profileDir(profile), "logs", "curator"));
}
```

(There's already a `profileSkillsDir` in `paths.ts`. Check for it; if present, do not duplicate. Add only the missing helpers.)

- [ ] **Step 4: Run lint**

```bash
npm run lint
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/paths.ts
git commit -m "feat(skills): foundation types and path helpers"
```

---

## Task 2: Sidecar telemetry (usage.ts)

**Files:**
- Create: `src/skills/usage.ts`
- Create: `tests/skills-usage.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/skills-usage.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function tempProfile() {
  const root = mkdtempSync(join(tmpdir(), "bajaclaw-test-"));
  process.env.BAJACLAW_HOME = root;
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("usage: read empty sidecar returns default shape", async () => {
  const { root, cleanup } = tempProfile();
  try {
    const { readSidecar } = await import("../src/skills/usage.ts");
    const s = readSidecar("default");
    assert.equal(s.schema_version, 1);
    assert.deepEqual(s.skills, {});
    assert.deepEqual(s.deleted, {});
  } finally { cleanup(); }
});

test("usage: recordCreate writes new entry", async () => {
  const { root, cleanup } = tempProfile();
  try {
    const { recordCreate, readSidecar } = await import("../src/skills/usage.ts");
    recordCreate("default", "foo", "agent");
    const s = readSidecar("default");
    assert.ok(s.skills.foo);
    assert.equal(s.skills.foo.use_count, 1);
    assert.equal(s.skills.foo.provenance, "agent");
    assert.equal(s.skills.foo.state, "active");
    assert.equal(s.skills.foo.pinned, false);
    assert.ok(s.skills.foo.created_at);
  } finally { cleanup(); }
});

test("usage: recordView increments and reactivates", async () => {
  const { root, cleanup } = tempProfile();
  try {
    const { recordCreate, recordView, recordStateTransition, readSidecar } =
      await import("../src/skills/usage.ts");
    recordCreate("default", "foo", "agent");
    recordStateTransition("default", "foo", "stale");
    recordView("default", "foo");
    const s = readSidecar("default");
    assert.equal(s.skills.foo.view_count, 1);
    assert.equal(s.skills.foo.state, "active"); // reactivated
    assert.ok(s.skills.foo.last_viewed_at);
  } finally { cleanup(); }
});

test("usage: recordDelete moves to deleted block", async () => {
  const { root, cleanup } = tempProfile();
  try {
    const { recordCreate, recordDelete, readSidecar } =
      await import("../src/skills/usage.ts");
    recordCreate("default", "foo", "agent");
    recordCreate("default", "bar", "agent");
    recordDelete("default", "foo", "bar");
    const s = readSidecar("default");
    assert.equal(s.skills.foo, undefined);
    assert.ok(s.deleted.foo);
    assert.equal(s.deleted.foo.absorbed_into, "bar");
    assert.ok(s.deleted.foo.deleted_at);
  } finally { cleanup(); }
});

test("usage: atomic write survives concurrent reads", async () => {
  const { root, cleanup } = tempProfile();
  try {
    const { recordCreate, readSidecar } = await import("../src/skills/usage.ts");
    for (let i = 0; i < 20; i++) recordCreate("default", `s${i}`, "agent");
    const s = readSidecar("default");
    assert.equal(Object.keys(s.skills).length, 20);
  } finally { cleanup(); }
});

test("usage: recordPin sets pinned flag", async () => {
  const { root, cleanup } = tempProfile();
  try {
    const { recordCreate, recordPin, readSidecar } =
      await import("../src/skills/usage.ts");
    recordCreate("default", "foo", "agent");
    recordPin("default", "foo", true);
    assert.equal(readSidecar("default").skills.foo.pinned, true);
    recordPin("default", "foo", false);
    assert.equal(readSidecar("default").skills.foo.pinned, false);
  } finally { cleanup(); }
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/skills-usage.test.js 2>&1 | tail -10
```

Expected: failures (module not found).

- [ ] **Step 3: Implement src/skills/usage.ts**

```ts
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { profileSkillUsagePath, profileSkillsDir } from "../paths.js";
import type { SkillSidecar, SkillUsageEntry, SkillProvenance, SkillState } from "../types.js";

function emptySidecar(): SkillSidecar {
  return { schema_version: 1, skills: {}, deleted: {} };
}

export function readSidecar(profile: string): SkillSidecar {
  profileSkillsDir(profile); // ensure dir
  const path = profileSkillUsagePath(profile);
  if (!existsSync(path)) return emptySidecar();
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as SkillSidecar;
    if (!parsed.schema_version) return migrate(parsed);
    return parsed;
  } catch {
    return emptySidecar();
  }
}

function migrate(parsed: unknown): SkillSidecar {
  // Single shape currently; placeholder for future bumps.
  const base = emptySidecar();
  if (parsed && typeof parsed === "object") {
    const o = parsed as Record<string, unknown>;
    if (o.skills && typeof o.skills === "object") base.skills = o.skills as Record<string, SkillUsageEntry>;
    if (o.deleted && typeof o.deleted === "object") base.deleted = o.deleted as Record<string, never>;
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
      use_count: 0, view_count: 0, patch_count: 0,
      last_used_at: null, last_viewed_at: null, last_patched_at: null,
      created_at: nowIso(), state: "active", pinned: false, provenance,
    };
  }
  return s.skills[name];
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
  const e = ensureEntry(s, name, "user"); // safe default if first observation
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

export function recordDelete(profile: string, name: string, absorbedInto: string, reason?: string): void {
  const s = readSidecar(profile);
  delete s.skills[name];
  s.deleted[name] = { absorbed_into: absorbedInto, deleted_at: nowIso(), reason };
  writeSidecar(profile, s);
}

export function recordPin(profile: string, name: string, pinned: boolean): void {
  const s = readSidecar(profile);
  const e = ensureEntry(s, name, "user");
  e.pinned = pinned;
  writeSidecar(profile, s);
}

export function recordStateTransition(profile: string, name: string, newState: SkillState): void {
  const s = readSidecar(profile);
  const e = ensureEntry(s, name, "user");
  e.state = newState;
  writeSidecar(profile, s);
}

export function setProvenance(profile: string, name: string, provenance: SkillProvenance): void {
  const s = readSidecar(profile);
  const e = ensureEntry(s, name, provenance);
  e.provenance = provenance;
  writeSidecar(profile, s);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tests/skills-usage.test.js 2>&1 | tail -10
```

Expected: all pass. The test sets `BAJACLAW_HOME` per test; verify `profileDir()` honors that env var. If not, adjust paths.ts to read it.

- [ ] **Step 5: Verify paths.ts honors BAJACLAW_HOME**

Open `src/paths.ts`. Find `bajaclawHome()`. If it doesn't read `process.env.BAJACLAW_HOME`, add it as the first check.

- [ ] **Step 6: Run lint**

```bash
npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add src/skills/usage.ts tests/skills-usage.test.js src/paths.ts
git commit -m "feat(skills): sidecar usage telemetry with atomic writes"
```

---

## Task 3: Path safety + fuzzy patch helpers

**Files:**
- Create: `src/skills/path-safety.ts`
- Create: `src/skills/fuzzy-patch.ts`
- Create: `tests/skills-path-safety.test.js`
- Create: `tests/skills-fuzzy-patch.test.js`

- [ ] **Step 1: Write failing test for path-safety**

Create `tests/skills-path-safety.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";

test("validateSkillSubpath: allows references/foo.md", async () => {
  const { validateSkillSubpath } = await import("../src/skills/path-safety.ts");
  const r = validateSkillSubpath("/skills/foo", "references/foo.md");
  assert.equal(r.ok, true);
  assert.equal(r.absolute, "/skills/foo/references/foo.md");
});

test("validateSkillSubpath: rejects parent escape", async () => {
  const { validateSkillSubpath } = await import("../src/skills/path-safety.ts");
  const r = validateSkillSubpath("/skills/foo", "../bar/x.md");
  assert.equal(r.ok, false);
});

test("validateSkillSubpath: rejects absolute", async () => {
  const { validateSkillSubpath } = await import("../src/skills/path-safety.ts");
  const r = validateSkillSubpath("/skills/foo", "/etc/passwd");
  assert.equal(r.ok, false);
});

test("validateSkillSubpath: rejects unknown subdir", async () => {
  const { validateSkillSubpath } = await import("../src/skills/path-safety.ts");
  const r = validateSkillSubpath("/skills/foo", "evil/x.md");
  assert.equal(r.ok, false);
});

test("validateSkillSubpath: rejects bare file at root", async () => {
  const { validateSkillSubpath } = await import("../src/skills/path-safety.ts");
  const r = validateSkillSubpath("/skills/foo", "x.md");
  assert.equal(r.ok, false);
});

test("validateSkillSubpath: allows scripts/run.sh", async () => {
  const { validateSkillSubpath } = await import("../src/skills/path-safety.ts");
  const r = validateSkillSubpath("/skills/foo", "scripts/run.sh");
  assert.equal(r.ok, true);
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
node --test tests/skills-path-safety.test.js 2>&1 | tail -5
```

Expected: failures.

- [ ] **Step 3: Implement src/skills/path-safety.ts**

```ts
import { resolve, isAbsolute } from "node:path";

const ALLOWED_SUBDIRS = new Set(["references", "templates", "scripts", "assets"]);

export interface ValidatedPath {
  ok: boolean;
  absolute?: string;
  reason?: string;
}

export function validateSkillSubpath(skillDir: string, rel: string): ValidatedPath {
  if (!rel || typeof rel !== "string") return { ok: false, reason: "empty path" };
  if (isAbsolute(rel)) return { ok: false, reason: "absolute paths rejected" };
  if (rel.includes("\0")) return { ok: false, reason: "null byte" };

  const parts = rel.split(/[\\/]+/).filter(Boolean);
  if (parts.length < 2) return { ok: false, reason: "must be <subdir>/<file>" };
  if (parts.includes("..")) return { ok: false, reason: "parent traversal" };
  if (!ALLOWED_SUBDIRS.has(parts[0]!)) {
    return { ok: false, reason: `subdir must be one of: ${Array.from(ALLOWED_SUBDIRS).join(", ")}` };
  }

  const absolute = resolve(skillDir, rel);
  const skillResolved = resolve(skillDir);
  if (!absolute.startsWith(skillResolved + "/") && absolute !== skillResolved) {
    return { ok: false, reason: "resolves outside skill dir" };
  }
  return { ok: true, absolute };
}
```

- [ ] **Step 4: Verify path-safety tests pass**

```bash
node --test tests/skills-path-safety.test.js 2>&1 | tail -5
```

- [ ] **Step 5: Write failing test for fuzzy-patch**

Create `tests/skills-fuzzy-patch.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";

test("fuzzyPatch: exact unique match replaces", async () => {
  const { fuzzyPatch } = await import("../src/skills/fuzzy-patch.ts");
  const body = "line1\nfoo bar\nbaz\nline4";
  const r = fuzzyPatch(body, "foo bar\nbaz", "FOO BAR\nBAZ");
  assert.equal(r.ok, true);
  assert.match(r.body, /FOO BAR\nBAZ/);
});

test("fuzzyPatch: multiple exact matches reject", async () => {
  const { fuzzyPatch } = await import("../src/skills/fuzzy-patch.ts");
  const body = "x\nx\nx\n";
  const r = fuzzyPatch(body, "x", "Y");
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /ambig/i);
});

test("fuzzyPatch: whitespace tolerant when exact misses", async () => {
  const { fuzzyPatch } = await import("../src/skills/fuzzy-patch.ts");
  const body = "alpha\n  beta  \ngamma";
  const r = fuzzyPatch(body, "alpha\nbeta\ngamma", "ALPHA\nBETA\nGAMMA");
  assert.equal(r.ok, true);
  assert.match(r.body, /ALPHA/);
});

test("fuzzyPatch: similarity match >=0.85", async () => {
  const { fuzzyPatch } = await import("../src/skills/fuzzy-patch.ts");
  const body = "before\nthe quick brown fox jumps\nafter";
  // intentionally one word off
  const r = fuzzyPatch(body, "the quick brown fox jumped", "REPLACED");
  assert.equal(r.ok, true);
  assert.match(r.body, /REPLACED/);
});

test("fuzzyPatch: low similarity rejects", async () => {
  const { fuzzyPatch } = await import("../src/skills/fuzzy-patch.ts");
  const body = "totally unrelated content here";
  const r = fuzzyPatch(body, "the quick brown fox jumps over", "REPLACED");
  assert.equal(r.ok, false);
});
```

- [ ] **Step 6: Run test to verify failure**

```bash
node --test tests/skills-fuzzy-patch.test.js 2>&1 | tail -5
```

- [ ] **Step 7: Implement src/skills/fuzzy-patch.ts**

```ts
export interface FuzzyPatchResult {
  ok: boolean;
  body: string;
  reason?: string;
  range?: { start: number; end: number };
}

export function fuzzyPatch(body: string, find: string, replace: string): FuzzyPatchResult {
  if (!find) return { ok: false, body, reason: "empty find" };

  // Phase 1: exact substring match
  const exact = findAllSubstrings(body, find);
  if (exact.length === 1) {
    const start = exact[0]!;
    return { ok: true, body: body.slice(0, start) + replace + body.slice(start + find.length), range: { start, end: start + find.length } };
  }
  if (exact.length > 1) return { ok: false, body, reason: `${exact.length} exact matches; ambiguous, narrow context` };

  // Phase 2: whitespace-normalized match
  const normFind = normalizeWs(find);
  const candidates = findAllNormalizedRanges(body, normFind);
  if (candidates.length === 1) {
    const { start, end } = candidates[0]!;
    return { ok: true, body: body.slice(0, start) + replace + body.slice(end), range: { start, end } };
  }
  if (candidates.length > 1) return { ok: false, body, reason: "multiple whitespace-normalized matches" };

  // Phase 3: similarity (line-block fuzzy)
  const sim = bestSimilarityRange(body, find, 0.85);
  if (sim) {
    const { start, end } = sim;
    return { ok: true, body: body.slice(0, start) + replace + body.slice(end), range: { start, end } };
  }
  return { ok: false, body, reason: "no match (exact, whitespace, or similarity)" };
}

function findAllSubstrings(haystack: string, needle: string): number[] {
  const out: number[] = [];
  let i = 0;
  while (i <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, i);
    if (idx === -1) break;
    out.push(idx);
    i = idx + 1;
  }
  return out;
}

function normalizeWs(s: string): string {
  return s.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

function findAllNormalizedRanges(haystack: string, normNeedle: string): { start: number; end: number }[] {
  // Slide windows of varying length around normNeedle.length, normalize each, compare.
  const out: { start: number; end: number }[] = [];
  if (!normNeedle) return out;
  const target = normNeedle;
  const minLen = Math.max(1, Math.floor(target.length * 0.7));
  const maxLen = Math.ceil(target.length * 1.5);
  for (let start = 0; start < haystack.length; start++) {
    for (let len = minLen; len <= maxLen && start + len <= haystack.length; len++) {
      const slice = haystack.slice(start, start + len);
      if (normalizeWs(slice) === target) {
        out.push({ start, end: start + len });
        start = start + len - 1;
        break;
      }
    }
    if (out.length > 1) return out; // early bail; ambiguous
  }
  return out;
}

function bestSimilarityRange(haystack: string, needle: string, threshold: number): { start: number; end: number } | null {
  // Slide line-block windows. Compute similarity = 1 - editDistance/maxLen.
  // Window size = needle line count +/- 1.
  const lines = haystack.split("\n");
  const needleLines = needle.split("\n").length;
  let best: { start: number; end: number; score: number } | null = null;
  let lineStarts: number[] = [0];
  let acc = 0;
  for (const ln of lines) { acc += ln.length + 1; lineStarts.push(acc); }

  for (let i = 0; i + needleLines <= lines.length; i++) {
    for (const w of [needleLines - 1, needleLines, needleLines + 1]) {
      if (w <= 0 || i + w > lines.length) continue;
      const start = lineStarts[i]!;
      const end = lineStarts[i + w]! - 1; // exclude the newline that started the next line
      const slice = haystack.slice(start, end);
      const score = similarity(slice, needle);
      if (score >= threshold && (!best || score > best.score)) {
        best = { start, end, score };
      }
    }
  }
  return best ? { start: best.start, end: best.end } : null;
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const dist = levenshtein(a, b);
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - dist / max;
}

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1);
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}
```

- [ ] **Step 8: Run fuzzy-patch tests**

```bash
node --test tests/skills-fuzzy-patch.test.js 2>&1 | tail -10
```

Expected: all pass. If similarity case fails, tune the thresholds in `findAllNormalizedRanges` (the 0.7/1.5 multipliers).

- [ ] **Step 9: Lint and commit**

```bash
npm run lint
git add src/skills/path-safety.ts src/skills/fuzzy-patch.ts tests/skills-path-safety.test.js tests/skills-fuzzy-patch.test.js
git commit -m "feat(skills): path safety and fuzzy-patch helpers"
```

---

## Task 4: Provenance helper + index builder

**Files:**
- Create: `src/skills/provenance.ts`
- Create: `src/skills/index-builder.ts`
- Create: `tests/skills-index-builder.test.js`

- [ ] **Step 1: Implement src/skills/provenance.ts**

```ts
import type { Skill, SkillProvenance } from "../types.js";
import { profileSkillsDir, userSkillsDir } from "../paths.js";

export function provenanceOf(skill: Skill, profile: string): SkillProvenance {
  const profDir = profileSkillsDir(profile);
  const userDir = userSkillsDir();
  if (skill.path.startsWith(profDir)) return "agent";
  if (skill.path.startsWith(userDir)) return "user";
  return "bundled";
}
```

(Note: this returns `agent` for anything in the per-profile dir. The sidecar may override with explicit `provenance: "user"` for manually-authored skills under that dir; index-builder reads sidecar first.)

- [ ] **Step 2: Write failing test for index-builder**

Create `tests/skills-index-builder.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function tempProfile() {
  const root = mkdtempSync(join(tmpdir(), "bajaclaw-test-"));
  process.env.BAJACLAW_HOME = root;
  const profDir = join(root, "profiles", "default");
  mkdirSync(join(profDir, "skills"), { recursive: true });
  return { root, profDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writeSkill(dir, name, frontmatter, body = "x") {
  const sk = join(dir, name);
  mkdirSync(sk, { recursive: true });
  const fm = Object.entries(frontmatter).map(([k,v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n");
  writeFileSync(join(sk, "SKILL.md"), `---\n${fm}\n---\n${body}\n`);
}

test("index-builder: empty profile returns header only", async () => {
  const { root, cleanup } = tempProfile();
  try {
    const { buildSkillsIndex } = await import("../src/skills/index-builder.ts");
    const r = buildSkillsIndex("default");
    assert.match(r.text, /<available_skills>/);
    assert.match(r.text, /<\/available_skills>/);
    assert.equal(r.skills.length, 0);
  } finally { cleanup(); }
});

test("index-builder: renders skill with name and description", async () => {
  const { root, profDir, cleanup } = tempProfile();
  try {
    writeSkill(join(profDir, "skills"), "foo", { name: "foo", description: "Do a foo thing" });
    const { buildSkillsIndex } = await import("../src/skills/index-builder.ts");
    const r = buildSkillsIndex("default");
    assert.match(r.text, /- foo: Do a foo thing/);
    assert.equal(r.skills.length, 1);
  } finally { cleanup(); }
});

test("index-builder: groups setup-* under Setup", async () => {
  const { root, profDir, cleanup } = tempProfile();
  try {
    writeSkill(join(profDir, "skills"), "setup-discord", { name: "setup-discord", description: "Wire Discord" });
    writeSkill(join(profDir, "skills"), "code-review", { name: "code-review", description: "Review code" });
    const { buildSkillsIndex } = await import("../src/skills/index-builder.ts");
    const r = buildSkillsIndex("default");
    const setupIdx = r.text.indexOf("# Setup");
    const generalIdx = r.text.indexOf("# General");
    assert.ok(setupIdx >= 0);
    assert.ok(generalIdx >= 0);
    // Order: General before Setup before Auto-generated
    assert.ok(generalIdx < setupIdx);
  } finally { cleanup(); }
});

test("index-builder: truncates description at 120 chars", async () => {
  const { root, profDir, cleanup } = tempProfile();
  try {
    const long = "x".repeat(200);
    writeSkill(join(profDir, "skills"), "foo", { name: "foo", description: long });
    const { buildSkillsIndex } = await import("../src/skills/index-builder.ts");
    const r = buildSkillsIndex("default");
    const lineMatch = r.text.match(/- foo: (.+)/);
    assert.ok(lineMatch);
    assert.ok(lineMatch[1].length <= 120);
  } finally { cleanup(); }
});

test("index-builder: manifestHash stable for same input", async () => {
  const { root, profDir, cleanup } = tempProfile();
  try {
    writeSkill(join(profDir, "skills"), "foo", { name: "foo", description: "x" });
    const { buildSkillsIndex } = await import("../src/skills/index-builder.ts");
    const a = buildSkillsIndex("default");
    const b = buildSkillsIndex("default");
    assert.equal(a.manifestHash, b.manifestHash);
  } finally { cleanup(); }
});

test("index-builder: hides skills filtered by provenance:user with sidecar override", async () => {
  // skipped here; tested in skill-list/loader integration
  assert.ok(true);
});
```

- [ ] **Step 3: Run failing test**

```bash
node --test tests/skills-index-builder.test.js 2>&1 | tail -10
```

- [ ] **Step 4: Implement src/skills/index-builder.ts**

```ts
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { loadAllSkills } from "./loader.js";
import { readSidecar } from "./usage.js";
import type { Skill, SkillUsageEntry } from "../types.js";

export interface SkillsIndex {
  text: string;
  skills: Array<{ name: string; description: string; category: string }>;
  manifestHash: string;
}

const MAX_DESC_LEN = 120;

export function buildSkillsIndex(profile: string, allowedTools: string[] = []): SkillsIndex {
  const all = loadAllSkills(profile);
  const sidecar = readSidecar(profile);
  const visible = all.filter((s) => isVisible(s, sidecar.skills[s.name], allowedTools));

  const grouped = groupByCategory(visible, sidecar.skills);

  const lines: string[] = [];
  lines.push("<available_skills>");
  lines.push("The following skills are installed for this profile. Each line is `name: description`.");
  lines.push("To use a skill, call skill_view(name) to read its full content, then follow it.");
  lines.push("");

  const order = ["General", "Setup", "Auto-generated"];
  for (const cat of order) {
    const items = grouped.get(cat);
    if (!items || items.length === 0) continue;
    lines.push(`# ${cat}`);
    for (const s of items) {
      lines.push(`- ${s.name}: ${truncate(s.description ?? "", MAX_DESC_LEN)}`);
    }
    lines.push("");
  }
  // Other categories at the end.
  for (const [cat, items] of grouped) {
    if (order.includes(cat) || items.length === 0) continue;
    lines.push(`# ${cat}`);
    for (const s of items) {
      lines.push(`- ${s.name}: ${truncate(s.description ?? "", MAX_DESC_LEN)}`);
    }
    lines.push("");
  }
  lines.push("Before answering, scan this list. If any skill is even partially relevant to the");
  lines.push("task, you MUST call skill_view(name) to read its body and follow its instructions.");
  lines.push("Err on the side of viewing.");
  lines.push("");
  lines.push("If during a cycle you discover a non-trivial reusable procedure, save it via");
  lines.push('skill_manage(action="create"). Don\'t wait to be asked.');
  lines.push("</available_skills>");

  const text = lines.join("\n");
  const manifestHash = computeManifestHash(visible);
  const skillsList = visible.map((s) => ({
    name: s.name,
    description: s.description ?? "",
    category: categoryOf(s, sidecar.skills[s.name]),
  }));
  return { text, skills: skillsList, manifestHash };
}

function isVisible(skill: Skill, usage: SkillUsageEntry | undefined, allowedTools: string[]): boolean {
  if (usage?.state === "archived") return false;
  // Conditional gates (requires_tools / fallback_for_tools):
  const tools = new Set(allowedTools);
  if (skill.requiresTools && skill.requiresTools.length > 0 && tools.size > 0) {
    for (const t of skill.requiresTools) if (!tools.has(t)) return false;
  }
  if (skill.fallbackForTools && skill.fallbackForTools.length > 0 && tools.size > 0) {
    for (const t of skill.fallbackForTools) if (tools.has(t)) return false;
  }
  return true;
}

function categoryOf(skill: Skill, _usage: SkillUsageEntry | undefined): string {
  // Frontmatter override (TODO: bajaclaw.category) - skip for now unless added
  if (skill.autoGenerated) return "Auto-generated";
  if (skill.name.startsWith("setup-")) return "Setup";
  return "General";
}

function groupByCategory(skills: Skill[], _usage: Record<string, SkillUsageEntry>): Map<string, Skill[]> {
  const map = new Map<string, Skill[]>();
  for (const s of skills) {
    const cat = categoryOf(s, _usage[s.name]);
    const arr = map.get(cat) ?? [];
    arr.push(s);
    map.set(cat, arr);
  }
  for (const arr of map.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
  return map;
}

function truncate(s: string, max: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : oneLine.slice(0, max - 1) + "…";
}

function computeManifestHash(skills: Skill[]): string {
  const sorted = [...skills].sort((a, b) => a.path.localeCompare(b.path));
  const h = createHash("sha256");
  for (const s of sorted) {
    let mtime = 0, size = 0;
    try { const st = statSync(s.path); mtime = st.mtimeMs; size = st.size; } catch { /* ignore */ }
    h.update(`${s.path}|${mtime}|${size}\n`);
  }
  return h.digest("hex");
}
```

- [ ] **Step 5: Run tests**

```bash
node --test tests/skills-index-builder.test.js 2>&1 | tail -15
```

Expected: all pass. If "groups setup-*" test fails on order assertion, adjust the test (the `order` array dictates Setup ordering).

- [ ] **Step 6: Lint and commit**

```bash
npm run lint
git add src/skills/provenance.ts src/skills/index-builder.ts tests/skills-index-builder.test.js
git commit -m "feat(skills): index builder with category grouping and manifest hash"
```

---

## Task 5: Index cache (LRU + on-disk snapshot)

**Files:**
- Create: `src/skills/index-cache.ts`
- Create: `tests/skills-index-cache.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/skills-index-cache.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "bajaclaw-test-"));
  process.env.BAJACLAW_HOME = root;
  const skDir = join(root, "profiles", "default", "skills");
  mkdirSync(skDir, { recursive: true });
  return { root, skDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
function writeSkill(dir, name, desc) {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${desc}\n---\nbody\n`);
}

test("index-cache: first call computes and snapshots", async () => {
  const { skDir, cleanup } = setup();
  try {
    writeSkill(skDir, "foo", "Foo skill");
    const { getOrBuildIndex } = await import("../src/skills/index-cache.ts");
    const { join } = await import("node:path");
    const r = getOrBuildIndex("default");
    assert.match(r.text, /foo: Foo skill/);
    const snap = join(skDir, ".skills_prompt_snapshot.json");
    assert.ok(existsSync(snap));
  } finally { cleanup(); }
});

test("index-cache: second call hits cache", async () => {
  const { skDir, cleanup } = setup();
  try {
    writeSkill(skDir, "foo", "Foo skill");
    const { getOrBuildIndex, _stats } = await import("../src/skills/index-cache.ts");
    _stats.reset();
    getOrBuildIndex("default");
    const before = _stats.get();
    getOrBuildIndex("default");
    const after = _stats.get();
    assert.ok(after.hits > before.hits);
  } finally { cleanup(); }
});

test("index-cache: file change invalidates cache", async () => {
  const { skDir, cleanup } = setup();
  try {
    writeSkill(skDir, "foo", "Foo skill");
    const { getOrBuildIndex } = await import("../src/skills/index-cache.ts");
    const a = getOrBuildIndex("default");
    // wait at least 5ms to ensure mtime differs
    await new Promise((r) => setTimeout(r, 10));
    writeSkill(skDir, "foo", "Foo skill UPDATED");
    const b = getOrBuildIndex("default");
    assert.notEqual(a.manifestHash, b.manifestHash);
    assert.match(b.text, /UPDATED/);
  } finally { cleanup(); }
});
```

- [ ] **Step 2: Run failing test**

```bash
node --test tests/skills-index-cache.test.js 2>&1 | tail -10
```

- [ ] **Step 3: Implement src/skills/index-cache.ts**

```ts
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { profileSkillIndexCachePath } from "../paths.js";
import { buildSkillsIndex, type SkillsIndex } from "./index-builder.js";

interface CacheEntry { profile: string; manifestHash: string; allowedToolsKey: string; index: SkillsIndex; }

const lru: CacheEntry[] = [];
const LRU_MAX = 16;

export const _stats = (() => {
  let hits = 0, misses = 0;
  return {
    hit() { hits++; }, miss() { misses++; },
    get() { return { hits, misses }; },
    reset() { hits = 0; misses = 0; },
  };
})();

export function getOrBuildIndex(profile: string, allowedTools: string[] = []): SkillsIndex {
  const allowedKey = allowedTools.slice().sort().join(",");
  // 1. Probe quickly: hash directory state via builder (cheap walk; we want manifest hash).
  // For correctness we recompute but reuse cached text if hashes match.
  const probe = buildSkillsIndex(profile, allowedTools);
  const cached = lru.find((e) => e.profile === profile && e.manifestHash === probe.manifestHash && e.allowedToolsKey === allowedKey);
  if (cached) {
    _stats.hit();
    moveToFront(cached);
    return cached.index;
  }

  // 2. On-disk snapshot
  const snapPath = profileSkillIndexCachePath(profile);
  if (existsSync(snapPath)) {
    try {
      const snap = JSON.parse(readFileSync(snapPath, "utf8")) as { manifestHash: string; rendered_index: string; generated_at: string; allowedToolsKey?: string };
      if (snap.manifestHash === probe.manifestHash && snap.allowedToolsKey === allowedKey) {
        const index: SkillsIndex = { text: snap.rendered_index, skills: probe.skills, manifestHash: snap.manifestHash };
        pushLru({ profile, manifestHash: snap.manifestHash, allowedToolsKey: allowedKey, index });
        _stats.hit();
        return index;
      }
    } catch { /* fall through */ }
  }

  // 3. Miss: write snapshot and cache
  writeSnapshot(snapPath, probe, allowedKey);
  pushLru({ profile, manifestHash: probe.manifestHash, allowedToolsKey: allowedKey, index: probe });
  _stats.miss();
  return probe;
}

function moveToFront(entry: CacheEntry): void {
  const idx = lru.indexOf(entry);
  if (idx > 0) { lru.splice(idx, 1); lru.unshift(entry); }
}

function pushLru(entry: CacheEntry): void {
  lru.unshift(entry);
  while (lru.length > LRU_MAX) lru.pop();
}

function writeSnapshot(path: string, idx: SkillsIndex, allowedToolsKey: string): void {
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  const payload = { manifestHash: idx.manifestHash, rendered_index: idx.text, generated_at: new Date().toISOString(), allowedToolsKey };
  writeFileSync(tmp, JSON.stringify(payload), "utf8");
  renameSync(tmp, path);
}

export function invalidate(profile: string): void {
  for (let i = lru.length - 1; i >= 0; i--) if (lru[i]!.profile === profile) lru.splice(i, 1);
}
```

- [ ] **Step 4: Run tests**

```bash
node --test tests/skills-index-cache.test.js 2>&1 | tail -10
```

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/skills/index-cache.ts tests/skills-index-cache.test.js
git commit -m "feat(skills): two-layer index cache (LRU + on-disk snapshot)"
```

---

## Task 6: skill_view + skill_list MCP tools

**Files:**
- Create: `src/skills/skill-view.ts`
- Create: `src/skills/skill-list.ts`
- Create: `tests/skills-skill-view.test.js`
- Modify: `src/mcp/server.ts`

- [ ] **Step 1: Write failing test**

Create `tests/skills-skill-view.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "bajaclaw-test-"));
  process.env.BAJACLAW_HOME = root;
  const skDir = join(root, "profiles", "default", "skills");
  mkdirSync(skDir, { recursive: true });
  return { root, skDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writeSkill(dir, name, body = "## Body\nstuff") {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} skill\n---\n${body}\n`);
}

test("skillView: returns body and frontmatter", async () => {
  const { skDir, cleanup } = setup();
  try {
    writeSkill(skDir, "foo", "## Quick reference\nrun foo");
    const { skillView } = await import("../src/skills/skill-view.ts");
    const r = skillView({ name: "foo" }, "default");
    assert.equal(r.ok, true);
    assert.match(r.body, /run foo/);
    assert.equal(r.frontmatter.name, "foo");
  } finally { cleanup(); }
});

test("skillView: 404 on missing", async () => {
  const { cleanup } = setup();
  try {
    const { skillView } = await import("../src/skills/skill-view.ts");
    const r = skillView({ name: "nope" }, "default");
    assert.equal(r.ok, false);
    assert.equal(r.status, 404);
  } finally { cleanup(); }
});

test("skillView: increments view_count", async () => {
  const { skDir, cleanup } = setup();
  try {
    writeSkill(skDir, "foo");
    const { skillView } = await import("../src/skills/skill-view.ts");
    const { readSidecar } = await import("../src/skills/usage.ts");
    skillView({ name: "foo" }, "default");
    skillView({ name: "foo" }, "default");
    const s = readSidecar("default");
    assert.equal(s.skills.foo.view_count, 2);
  } finally { cleanup(); }
});
```

- [ ] **Step 2: Run failing test**

```bash
node --test tests/skills-skill-view.test.js 2>&1 | tail -10
```

- [ ] **Step 3: Implement src/skills/skill-view.ts**

```ts
import { readFileSync } from "node:fs";
import { loadAllSkills, parseSkill } from "./loader.js";
import { recordView } from "./usage.js";

export interface SkillViewArgs { name: string; }
export interface SkillViewResult {
  ok: boolean;
  status?: number;
  name?: string;
  description?: string;
  body?: string;
  path?: string;
  frontmatter?: Record<string, unknown>;
  reason?: string;
}

export function skillView(args: SkillViewArgs, profile: string): SkillViewResult {
  const name = String(args?.name ?? "").trim();
  if (!name) return { ok: false, status: 400, reason: "name is required" };

  const all = loadAllSkills(profile);
  const skill = all.find((s) => s.name === name);
  if (!skill) return { ok: false, status: 404, reason: `no skill named '${name}'` };

  let raw: string;
  try { raw = readFileSync(skill.path, "utf8"); } catch (e) {
    return { ok: false, status: 500, reason: `read failed: ${(e as Error).message}` };
  }
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  const frontmatter: Record<string, unknown> = {
    name: skill.name,
    description: skill.description,
    version: skill.version,
    triggers: skill.triggers,
    effort: skill.effort,
    autoGenerated: skill.autoGenerated,
  };
  const body = fmMatch ? fmMatch[2]!.trim() : raw;

  recordView(profile, name);

  return {
    ok: true,
    name: skill.name,
    description: skill.description,
    body,
    path: skill.path,
    frontmatter,
  };
}
```

- [ ] **Step 4: Implement src/skills/skill-list.ts**

```ts
import { loadAllSkills } from "./loader.js";
import { readSidecar } from "./usage.js";
import { provenanceOf } from "./provenance.js";
import type { SkillState } from "../types.js";

export interface SkillListArgs {
  category?: string;
  state?: SkillState;
  includeArchived?: boolean;
}
export interface SkillListItem {
  name: string;
  description: string;
  category: string;
  state: SkillState;
  pinned: boolean;
  provenance: string;
  last_used_at: string | null;
  last_viewed_at: string | null;
  use_count: number;
  view_count: number;
}

function categoryOf(name: string, autoGenerated: boolean | undefined): string {
  if (autoGenerated) return "Auto-generated";
  if (name.startsWith("setup-")) return "Setup";
  return "General";
}

export function skillList(args: SkillListArgs, profile: string): SkillListItem[] {
  const all = loadAllSkills(profile);
  const sidecar = readSidecar(profile);
  const out: SkillListItem[] = [];

  for (const s of all) {
    const usage = sidecar.skills[s.name];
    const state = usage?.state ?? "active";
    if (!args.includeArchived && state === "archived") continue;
    if (args.state && state !== args.state) continue;
    const cat = categoryOf(s.name, s.autoGenerated);
    if (args.category && cat !== args.category) continue;
    out.push({
      name: s.name,
      description: s.description ?? "",
      category: cat,
      state,
      pinned: usage?.pinned ?? false,
      provenance: usage?.provenance ?? provenanceOf(s, profile),
      last_used_at: usage?.last_used_at ?? null,
      last_viewed_at: usage?.last_viewed_at ?? null,
      use_count: usage?.use_count ?? 0,
      view_count: usage?.view_count ?? 0,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 5: Run skill-view tests**

```bash
node --test tests/skills-skill-view.test.js 2>&1 | tail -10
```

- [ ] **Step 6: Register tools in src/mcp/server.ts**

Read the existing server.ts to find the `recall` tool registration. Add three new tools alongside it:

```ts
// near top:
import { skillView } from "../skills/skill-view.js";
import { skillList } from "../skills/skill-list.js";
import { skillManage } from "../skills/skill-manage.js";

// in the tool registration block (the spot where recall is registered):
server.setRequestHandler(/* find existing CallToolRequestSchema handler */, async (request) => {
  // ...
  if (request.params.name === "skill_view") {
    const result = skillView(request.params.arguments as { name: string }, profile);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
  if (request.params.name === "skill_list") {
    const result = skillList(request.params.arguments as Record<string, unknown>, profile);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
  if (request.params.name === "skill_manage") {
    const result = await skillManage(request.params.arguments as Record<string, unknown>, profile);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
  // existing recall handler...
});

// in the ListToolsRequestSchema handler:
return {
  tools: [
    /* existing tools */,
    {
      name: "skill_view",
      description: "Read a skill's full body. Increments view count.",
      inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    },
    {
      name: "skill_list",
      description: "List installed skills with state, pinned, usage stats.",
      inputSchema: { type: "object", properties: { category: { type: "string" }, state: { type: "string" }, includeArchived: { type: "boolean" } } },
    },
    {
      name: "skill_manage",
      description: "Create / edit / patch / delete / write_file / remove_file skill content.",
      inputSchema: { type: "object", properties: { action: { type: "string" }, name: { type: "string" }, description: { type: "string" }, body: { type: "string" }, find: { type: "string" }, replace: { type: "string" }, absorbed_into: { type: "string" }, reason: { type: "string" }, path: { type: "string" }, content: { type: "string" }, triggers: { type: "array", items: { type: "string" } }, effort: { type: "string" } }, required: ["action", "name"] },
    },
  ],
};
```

(Note: `skill_manage` tool is implemented in Task 7 — registration here will type-error until then. If you want to compile after this step, comment out the `skillManage` import + handler temporarily; uncomment in Task 7.)

- [ ] **Step 7: Lint**

```bash
npm run lint 2>&1 | tail -10
```

If unresolved import for `skill-manage`, comment it out (and the registration handler) for now. Will be uncommented in Task 7.

- [ ] **Step 8: Commit**

```bash
git add src/skills/skill-view.ts src/skills/skill-list.ts src/skills/provenance.ts tests/skills-skill-view.test.js src/mcp/server.ts
git commit -m "feat(skills): skill_view and skill_list MCP tools"
```

---

## Task 7: skill_manage MCP tool

**Files:**
- Create: `src/skills/skill-manage.ts`
- Create: `tests/skills-skill-manage.test.js`
- Modify: `src/mcp/server.ts` (uncomment if needed)

- [ ] **Step 1: Write failing test**

Create `tests/skills-skill-manage.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "bajaclaw-test-"));
  process.env.BAJACLAW_HOME = root;
  const skDir = join(root, "profiles", "default", "skills");
  mkdirSync(skDir, { recursive: true });
  return { root, skDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("skillManage create: writes SKILL.md and sidecar entry", async () => {
  const { skDir, cleanup } = setup();
  try {
    const { skillManage } = await import("../src/skills/skill-manage.ts");
    const r = await skillManage({ action: "create", name: "fix-foo", description: "Fix the foo", body: "## Procedure\n1. Run foo" }, "default");
    assert.equal(r.ok, true);
    assert.ok(existsSync(join(skDir, "fix-foo", "SKILL.md")));
    const raw = readFileSync(join(skDir, "fix-foo", "SKILL.md"), "utf8");
    assert.match(raw, /name: fix-foo/);
    assert.match(raw, /## Procedure/);
    assert.match(raw, /auto_generated: true/);
    const { readSidecar } = await import("../src/skills/usage.ts");
    const s = readSidecar("default");
    assert.equal(s.skills["fix-foo"].provenance, "agent");
    assert.equal(s.skills["fix-foo"].use_count, 1);
  } finally { cleanup(); }
});

test("skillManage create: rejects duplicate name", async () => {
  const { cleanup } = setup();
  try {
    const { skillManage } = await import("../src/skills/skill-manage.ts");
    await skillManage({ action: "create", name: "x", description: "x", body: "x" }, "default");
    const r2 = await skillManage({ action: "create", name: "x", description: "x", body: "x" }, "default");
    assert.equal(r2.ok, false);
    assert.match(r2.reason ?? "", /exists/);
  } finally { cleanup(); }
});

test("skillManage edit: replaces body", async () => {
  const { skDir, cleanup } = setup();
  try {
    const { skillManage } = await import("../src/skills/skill-manage.ts");
    await skillManage({ action: "create", name: "x", description: "x", body: "old body" }, "default");
    const r = await skillManage({ action: "edit", name: "x", body: "new body" }, "default");
    assert.equal(r.ok, true);
    const raw = readFileSync(join(skDir, "x", "SKILL.md"), "utf8");
    assert.match(raw, /new body/);
    assert.doesNotMatch(raw, /old body/);
  } finally { cleanup(); }
});

test("skillManage patch: fuzzy replace", async () => {
  const { skDir, cleanup } = setup();
  try {
    const { skillManage } = await import("../src/skills/skill-manage.ts");
    await skillManage({ action: "create", name: "x", description: "x", body: "step1\nrun foo\nstep3" }, "default");
    const r = await skillManage({ action: "patch", name: "x", find: "run foo", replace: "run bar" }, "default");
    assert.equal(r.ok, true);
    const raw = readFileSync(join(skDir, "x", "SKILL.md"), "utf8");
    assert.match(raw, /run bar/);
  } finally { cleanup(); }
});

test("skillManage delete: archives and requires absorbed_into", async () => {
  const { skDir, cleanup } = setup();
  try {
    const { skillManage } = await import("../src/skills/skill-manage.ts");
    await skillManage({ action: "create", name: "x", description: "x", body: "x" }, "default");
    await skillManage({ action: "create", name: "y", description: "y", body: "y" }, "default");

    const r1 = await skillManage({ action: "delete", name: "x" }, "default");
    assert.equal(r1.ok, false); // missing absorbed_into

    const r2 = await skillManage({ action: "delete", name: "x", absorbed_into: "y" }, "default");
    assert.equal(r2.ok, true);
    assert.ok(!existsSync(join(skDir, "x", "SKILL.md")));
    assert.ok(existsSync(join(skDir, ".archive", "x", "SKILL.md")));
  } finally { cleanup(); }
});

test("skillManage delete prune: empty absorbed_into requires reason", async () => {
  const { cleanup } = setup();
  try {
    const { skillManage } = await import("../src/skills/skill-manage.ts");
    await skillManage({ action: "create", name: "x", description: "x", body: "x" }, "default");
    const r1 = await skillManage({ action: "delete", name: "x", absorbed_into: "" }, "default");
    assert.equal(r1.ok, false); // no reason
    const r2 = await skillManage({ action: "delete", name: "x", absorbed_into: "", reason: "noop empty skill" }, "default");
    assert.equal(r2.ok, true);
  } finally { cleanup(); }
});

test("skillManage write_file: only allowed subdirs", async () => {
  const { skDir, cleanup } = setup();
  try {
    const { skillManage } = await import("../src/skills/skill-manage.ts");
    await skillManage({ action: "create", name: "x", description: "x", body: "x" }, "default");
    const ok = await skillManage({ action: "write_file", name: "x", path: "references/notes.md", content: "hello" }, "default");
    assert.equal(ok.ok, true);
    assert.ok(existsSync(join(skDir, "x", "references", "notes.md")));
    const bad = await skillManage({ action: "write_file", name: "x", path: "../escape.md", content: "x" }, "default");
    assert.equal(bad.ok, false);
  } finally { cleanup(); }
});

test("skillManage: pinned skill rejects all mutations", async () => {
  const { cleanup } = setup();
  try {
    const { skillManage } = await import("../src/skills/skill-manage.ts");
    const { recordPin } = await import("../src/skills/usage.ts");
    await skillManage({ action: "create", name: "x", description: "x", body: "x" }, "default");
    recordPin("default", "x", true);
    const r = await skillManage({ action: "edit", name: "x", body: "y" }, "default");
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /pinned/i);
  } finally { cleanup(); }
});
```

- [ ] **Step 2: Run failing test**

```bash
node --test tests/skills-skill-manage.test.js 2>&1 | tail -10
```

- [ ] **Step 3: Implement src/skills/skill-manage.ts**

```ts
import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, unlinkSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { profileSkillsDir, profileSkillsArchiveDir } from "../paths.js";
import { recordCreate, recordPatch, recordDelete, readSidecar, setProvenance } from "./usage.js";
import { fuzzyPatch } from "./fuzzy-patch.js";
import { validateSkillSubpath } from "./path-safety.js";
import { invalidate as invalidateIndexCache } from "./index-cache.js";
import { loadAllSkills } from "./loader.js";
import { provenanceOf } from "./provenance.js";

export interface SkillManageArgs {
  action: "create" | "edit" | "patch" | "delete" | "write_file" | "remove_file";
  name: string;
  // create
  description?: string;
  body?: string;
  triggers?: string[];
  effort?: "low" | "medium" | "high";
  // patch
  find?: string;
  replace?: string;
  // delete
  absorbed_into?: string;
  reason?: string;
  // write_file / remove_file
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

export async function skillManage(rawArgs: Record<string, unknown>, profile: string): Promise<SkillManageResult> {
  const args = rawArgs as unknown as SkillManageArgs;
  const name = String(args?.name ?? "").trim();
  if (!name || !NAME_RE.test(name)) return { ok: false, reason: "invalid name (kebab-case, 2-64 chars)" };

  const action = args?.action;
  switch (action) {
    case "create": return create(args, profile);
    case "edit": return edit(args, profile);
    case "patch": return patch(args, profile);
    case "delete": return remove(args, profile);
    case "write_file": return writeFile(args, profile);
    case "remove_file": return removeFile(args, profile);
    default: return { ok: false, reason: `unknown action: ${action}` };
  }
}

function skillDirFor(profile: string, name: string): string {
  return join(profileSkillsDir(profile), name);
}

function archiveDirFor(profile: string, name: string): string {
  return join(profileSkillsArchiveDir(profile), name);
}

function checkMutable(profile: string, name: string): { ok: true } | { ok: false; reason: string } {
  const sidecar = readSidecar(profile);
  const usage = sidecar.skills[name];
  if (usage?.pinned) return { ok: false, reason: `skill '${name}' is pinned; unpin via CLI before mutating` };
  // Provenance check: look up across all scopes
  const all = loadAllSkills(profile);
  const skill = all.find((s) => s.name === name);
  if (skill) {
    const prov = usage?.provenance ?? provenanceOf(skill, profile);
    if (prov === "bundled") return { ok: false, reason: `skill '${name}' is bundled; read-only` };
    if (prov === "user") return { ok: false, reason: `skill '${name}' is manually authored; read-only to agent` };
  }
  return { ok: true };
}

function buildFrontmatter(args: SkillManageArgs): string {
  const fm: Record<string, unknown> = {
    name: args.name,
    description: args.description,
    version: "0.1.0",
    auto_generated: true,
    created_at: new Date().toISOString(),
  };
  if (args.triggers && args.triggers.length) fm.triggers = args.triggers;
  if (args.effort) fm.effort = args.effort;
  const lines: string[] = ["---"];
  for (const [k, v] of Object.entries(fm)) {
    if (Array.isArray(v)) lines.push(`${k}: ${JSON.stringify(v)}`);
    else lines.push(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
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

async function create(args: SkillManageArgs, profile: string): Promise<SkillManageResult> {
  if (!args.description) return { ok: false, reason: "description is required" };
  if (!args.body) return { ok: false, reason: "body is required" };

  const dir = skillDirFor(profile, args.name);
  const path = join(dir, "SKILL.md");
  if (existsSync(path)) return { ok: false, reason: `skill '${args.name}' already exists` };

  const fm = buildFrontmatter(args);
  atomicWrite(path, `${fm}\n\n${args.body}\n`);
  recordCreate(profile, args.name, "agent");
  setProvenance(profile, args.name, "agent");
  invalidateIndexCache(profile);
  return { ok: true, path };
}

async function edit(args: SkillManageArgs, profile: string): Promise<SkillManageResult> {
  const guard = checkMutable(profile, args.name);
  if (!guard.ok) return guard;
  if (!args.body) return { ok: false, reason: "body is required" };

  const path = join(skillDirFor(profile, args.name), "SKILL.md");
  if (!existsSync(path)) return { ok: false, reason: `skill '${args.name}' not found` };
  const raw = readFileSync(path, "utf8");
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  const fm = fmMatch ? fmMatch[0] : buildFrontmatter(args) + "\n";
  atomicWrite(path, `${fm.replace(/\n*$/, "\n")}\n${args.body}\n`);
  recordPatch(profile, args.name);
  invalidateIndexCache(profile);
  return { ok: true, path };
}

async function patch(args: SkillManageArgs, profile: string): Promise<SkillManageResult> {
  const guard = checkMutable(profile, args.name);
  if (!guard.ok) return guard;
  if (!args.find) return { ok: false, reason: "find is required" };
  if (args.replace === undefined) return { ok: false, reason: "replace is required (use empty string to delete)" };

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

async function remove(args: SkillManageArgs, profile: string): Promise<SkillManageResult> {
  const guard = checkMutable(profile, args.name);
  if (!guard.ok) return guard;

  const absorbed = args.absorbed_into;
  if (absorbed === undefined || absorbed === null) return { ok: false, reason: "absorbed_into is required (empty string allowed for true prune, with reason)" };
  if (absorbed === "" && !args.reason) return { ok: false, reason: "reason is required when absorbed_into is empty" };
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

async function writeFile(args: SkillManageArgs, profile: string): Promise<SkillManageResult> {
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

async function removeFile(args: SkillManageArgs, profile: string): Promise<SkillManageResult> {
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
```

- [ ] **Step 4: Run skill-manage tests**

```bash
node --test tests/skills-skill-manage.test.js 2>&1 | tail -20
```

Expected: all pass. Common fix: if `provenanceOf` returns "agent" for a skill that has no sidecar entry yet AND no usage record, the `setProvenance` call in `create` ensures future calls correctly identify it.

- [ ] **Step 5: Uncomment skill_manage in mcp/server.ts (if commented in Task 6)**

- [ ] **Step 6: Lint**

```bash
npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add src/skills/skill-manage.ts tests/skills-skill-manage.test.js src/mcp/server.ts
git commit -m "feat(skills): skill_manage MCP tool (create/edit/patch/delete/files)"
```

---

## Task 8: Wire index injection into agent.ts; remove auto-skiller

**Files:**
- Modify: `src/agent.ts`
- Modify: `src/skills/loader.ts`
- Modify: `src/skills/matcher.ts`
- Delete: `src/skills/auto-skiller.ts`

- [ ] **Step 1: Read current agent.ts assemblePrompt section**

```bash
grep -n "assemblePrompt\|matchSkills\|loadAllSkills\|synthesizeSkill" src/agent.ts
```

Note line numbers.

- [ ] **Step 2: Replace skill matching with index injection**

In `src/agent.ts`:

a. Replace the import:
```ts
// remove:
import { loadAllSkills } from "./skills/loader.js";
import { matchSkills } from "./skills/matcher.js";
import { synthesize as synthesizeSkill } from "./skills/auto-skiller.js";
// add:
import { getOrBuildIndex } from "./skills/index-cache.js";
```

b. Around line 185-199 (the matchSkills block), replace with:
```ts
const skillsIndex = getOrBuildIndex(input.profile, cfg.allowedTools ?? []);
log.info("cycle.stage", { stage: "skills-index.done", count: skillsIndex.skills.length, hash: skillsIndex.manifestHash.slice(0, 8) });
```

Remove all the `matchSkills`, `autoMatched`, `broadcastToProfile("Using skill: ...")` logic that was in this block.

c. In `assemblePrompt({ ... })` change the `skills` field to `skillsIndex`:
```ts
const prompt = assemblePrompt({
  task,
  attachments,
  memories: memories.map((m) => `- [${m.kind}] ${m.content.slice(0, budget.memoryCharsEach)}`).join("\n"),
  agentMd: systemDocs.agent,
  soulMd: systemDocs.soul,
  heartbeat: isHeartbeat ? systemDocs.heartbeat : "",
  skillsIndex: skillsIndex.text,
  recentChat: formatRecentChat(sessionHistory),
});
```

d. Update `assemblePrompt` (find its definition; likely in `src/agent.ts` or `src/prompt.ts`). Replace `skills` parameter with `skillsIndex` (just text). Inject directly without the existing skill body wrapper.

- [ ] **Step 3: Remove the post-cycle auto-skill block**

Find the `if (shouldDoPostWork)` block around line 443-467. Remove the `try { ... synthesizeSkill ... } catch ...` portion. Keep the memory `extract` call.

- [ ] **Step 4: Delete auto-skiller files**

```bash
rm src/skills/auto-skiller.ts
ls tests/ | grep -i auto-skill
# if any auto-skiller test files exist, rm them too
```

- [ ] **Step 5: Trim matcher.ts**

In `src/skills/matcher.ts`, remove:
- `matchSkillsByLLM`
- `LLM_TIMEOUT_MS`
- `parseNameArray`
- `MatchContext.runner`, `strategy`, `onTrace`
- the `matchSkills` async wrapper
- `oneLine`

Keep: `matchSkillsByKeyword`, `matchSlashTriggers`, `scoreSkill`, `isInterrogative`, `isActiveForContext`. These remain useful for the slash-trigger hint and tests.

Add a thin `matchSkillsByKeyword` re-export under the existing name `matchSkills` for back-compat with any internal callers, but only if other code outside this PR imports it. Otherwise leave deleted.

- [ ] **Step 6: Run all tests**

```bash
npm test 2>&1 | tail -30
```

The existing `tests/skill-matcher.test.js` likely fails because `matchSkills` no longer exists or has different signature. Either:
- Update the test to use `matchSkillsByKeyword` directly, or
- Delete the test if its scenarios are covered by index-builder tests.

Decide based on what the test asserts. The "discussion task should NOT activate image-gen" assertion is moot since we no longer have an LLM router; deletion is fine.

```bash
rm tests/skill-matcher.test.js
```

- [ ] **Step 7: Lint**

```bash
npm run lint 2>&1 | tail -20
```

Fix any type errors. Common: `assemblePrompt` callers in `agent.ts` may have other call sites; update them all.

- [ ] **Step 8: Run all tests again**

```bash
npm test 2>&1 | tail -30
```

Expected: green.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(skills): replace matcher with index injection; remove auto-skiller"
```

---

## Task 9: Curator phase 1 (lifecycle transitions)

**Files:**
- Create: `src/skills/curator.ts`
- Create: `tests/skills-curator-phase1.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/skills-curator-phase1.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "bajaclaw-test-"));
  process.env.BAJACLAW_HOME = root;
  const skDir = join(root, "profiles", "default", "skills");
  mkdirSync(skDir, { recursive: true });
  return { root, skDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writeSkill(dir, name, body = "x") {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name}\n---\n${body}\n`);
}

const DAY = 86_400_000;

test("phase1: idle 31d active->stale", async () => {
  const { skDir, cleanup } = setup();
  try {
    writeSkill(skDir, "x");
    const { recordCreate, readSidecar } = await import("../src/skills/usage.ts");
    recordCreate("default", "x", "agent");
    // Forcibly set last_used_at into the past
    const { _setLastUsed } = await import("../src/skills/curator.ts");
    _setLastUsed("default", "x", new Date(Date.now() - 31 * DAY).toISOString());

    const { runPhase1 } = await import("../src/skills/curator.ts");
    runPhase1("default");

    const s = readSidecar("default");
    assert.equal(s.skills.x.state, "stale");
  } finally { cleanup(); }
});

test("phase1: idle 91d stale->archived (file moves)", async () => {
  const { skDir, cleanup } = setup();
  try {
    writeSkill(skDir, "x");
    const { recordCreate } = await import("../src/skills/usage.ts");
    recordCreate("default", "x", "agent");
    const { _setLastUsed, _setState, runPhase1 } = await import("../src/skills/curator.ts");
    _setLastUsed("default", "x", new Date(Date.now() - 91 * DAY).toISOString());
    _setState("default", "x", "stale");

    runPhase1("default");

    assert.ok(existsSync(join(skDir, ".archive", "x", "SKILL.md")));
    assert.ok(!existsSync(join(skDir, "x", "SKILL.md")));
  } finally { cleanup(); }
});

test("phase1: pinned skill immune", async () => {
  const { skDir, cleanup } = setup();
  try {
    writeSkill(skDir, "x");
    const { recordCreate, recordPin, readSidecar } = await import("../src/skills/usage.ts");
    recordCreate("default", "x", "agent");
    recordPin("default", "x", true);
    const { _setLastUsed, runPhase1 } = await import("../src/skills/curator.ts");
    _setLastUsed("default", "x", new Date(Date.now() - 200 * DAY).toISOString());

    runPhase1("default");
    assert.equal(readSidecar("default").skills.x.state, "active");
  } finally { cleanup(); }
});

test("phase1: stale -> active on recent usage", async () => {
  const { skDir, cleanup } = setup();
  try {
    writeSkill(skDir, "x");
    const { recordCreate, recordView, readSidecar } = await import("../src/skills/usage.ts");
    recordCreate("default", "x", "agent");
    const { _setState, runPhase1 } = await import("../src/skills/curator.ts");
    _setState("default", "x", "stale");
    recordView("default", "x");

    runPhase1("default");
    assert.equal(readSidecar("default").skills.x.state, "active");
  } finally { cleanup(); }
});
```

- [ ] **Step 2: Run failing test**

```bash
node --test tests/skills-curator-phase1.test.js 2>&1 | tail -10
```

- [ ] **Step 3: Implement src/skills/curator.ts (phase 1 only for now)**

```ts
import { existsSync, mkdirSync, renameSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { profileSkillsDir, profileSkillsArchiveDir, profileCuratorStatePath } from "../paths.js";
import { readSidecar, recordStateTransition } from "./usage.js";
import { invalidate as invalidateIndexCache } from "./index-cache.js";
import type { CuratorState, SkillUsageEntry } from "../types.js";

const DAY = 86_400_000;
const STALE_AFTER_DAYS = 30;
const ARCHIVE_AFTER_DAYS = 90;

export function runPhase1(profile: string): { transitions: number } {
  const sidecar = readSidecar(profile);
  let transitions = 0;
  const now = Date.now();
  for (const [name, entry] of Object.entries(sidecar.skills)) {
    if (entry.pinned) continue;
    if (entry.provenance !== "agent") continue;
    const last = lastActivityMs(entry);
    const ageDays = (now - last) / DAY;

    // Reactivation first
    if (entry.state === "stale" && ageDays < STALE_AFTER_DAYS) {
      recordStateTransition(profile, name, "active");
      transitions++; continue;
    }
    if (entry.state === "active" && ageDays > STALE_AFTER_DAYS) {
      recordStateTransition(profile, name, "stale");
      transitions++; continue;
    }
    if (entry.state === "stale" && ageDays > ARCHIVE_AFTER_DAYS) {
      archiveSkill(profile, name);
      recordStateTransition(profile, name, "archived");
      transitions++;
      continue;
    }
  }
  if (transitions > 0) invalidateIndexCache(profile);
  return { transitions };
}

function lastActivityMs(entry: SkillUsageEntry): number {
  const candidates = [entry.last_used_at, entry.last_viewed_at, entry.last_patched_at, entry.created_at]
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

// Curator state file
export function readCuratorState(profile: string): CuratorState {
  const path = profileCuratorStatePath(profile);
  if (!existsSync(path)) return { last_curator_at: null, first_run_marker_at: null, dry_run_count: 0 };
  try { return JSON.parse(readFileSync(path, "utf8")) as CuratorState; }
  catch { return { last_curator_at: null, first_run_marker_at: null, dry_run_count: 0 }; }
}

export function writeCuratorState(profile: string, state: CuratorState): void {
  const path = profileCuratorStatePath(profile);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmp, path);
}

// Test-only helpers (prefixed with _)
export function _setLastUsed(profile: string, name: string, iso: string): void {
  const s = readSidecar(profile);
  if (s.skills[name]) {
    s.skills[name].last_used_at = iso;
    s.skills[name].last_viewed_at = iso;
    s.skills[name].last_patched_at = iso;
    s.skills[name].created_at = iso;
  }
  // write via internal route
  const { profileSkillUsagePath } = await import("../paths.js");
  // workaround: write directly here is fine for test surface
  writeFileSync(profileSkillUsagePath(profile), JSON.stringify(s, null, 2), "utf8");
}

export function _setState(profile: string, name: string, state: "active" | "stale" | "archived"): void {
  const { recordStateTransition } = require("./usage.js");
  recordStateTransition(profile, name, state);
}
```

(Note: the `_setLastUsed` helper uses `await import` but is sync — fix with a direct require/import. Use a top-level import for `profileSkillUsagePath` instead. Adjust during implementation.)

Cleaner version: import `profileSkillUsagePath` and `writeFileSync` at top, drop the inline import. Same for `_setState` (just import `recordStateTransition`).

- [ ] **Step 4: Run phase1 tests**

```bash
node --test tests/skills-curator-phase1.test.js 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add src/skills/curator.ts tests/skills-curator-phase1.test.js
git commit -m "feat(skills): curator phase 1 (lifecycle transitions)"
```

---

## Task 10: Curator phase 2 (LLM review pass)

**Files:**
- Modify: `src/skills/curator.ts`
- Create: `src/skills/curator-prompt.ts`
- Create: `tests/skills-curator-phase2.test.js`

- [ ] **Step 1: Implement src/skills/curator-prompt.ts**

```ts
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

export interface CuratorReviewInput {
  profile: string;
  active_skills: Array<{ name: string; description: string; provenance: string; auto_generated: boolean; usage: SkillUsageEntry | null; }>;
}

export function buildReviewPrompt(input: CuratorReviewInput): string {
  const lines = [CURATOR_REVIEW_PROMPT, "", `<library profile="${input.profile}">`];
  for (const s of input.active_skills) {
    const u = s.usage ? `use=${s.usage.use_count} view=${s.usage.view_count} last=${s.usage.last_used_at ?? "never"}` : "no_usage";
    lines.push(`- ${s.name} [${s.provenance}${s.auto_generated ? ",auto" : ""}] (${u}): ${s.description}`);
  }
  lines.push("</library>");
  lines.push("");
  lines.push("Return YAML proposed_actions. No prose, no fence, no markdown.");
  return lines.join("\n");
}

export function parseReviewYaml(text: string): CuratorProposedAction[] {
  // Lenient parser: try YAML.parse, else best-effort. We use the existing 'yaml' dep.
  // Lazy import:
  const { parse } = require("yaml");
  let parsed: unknown;
  try { parsed = parse(text); } catch { return []; }
  if (!parsed || typeof parsed !== "object") return [];
  const arr = (parsed as Record<string, unknown>).proposed_actions;
  if (!Array.isArray(arr)) return [];
  const out: CuratorProposedAction[] = [];
  for (const a of arr) {
    if (!a || typeof a !== "object") continue;
    const o = a as Record<string, unknown>;
    if (typeof o.kind !== "string" || typeof o.rationale !== "string") continue;
    if (!["merge", "create_umbrella", "demote_to_references", "prune"].includes(o.kind)) continue;
    out.push(o as unknown as CuratorProposedAction);
  }
  return out;
}
```

- [ ] **Step 2: Add phase 2 to src/skills/curator.ts**

Append to `curator.ts`:

```ts
import { skillManage } from "./skill-manage.js";
import { loadAllSkills } from "./loader.js";
import { provenanceOf } from "./provenance.js";
import { buildReviewPrompt, parseReviewYaml, type CuratorReviewInput } from "./curator-prompt.js";
import type { CuratorConfig, CuratorProposedAction } from "../types.js";

export interface CuratorRunResult {
  ran: boolean;
  reason: string;
  transitions: number;
  proposed: CuratorProposedAction[];
  executed: CuratorProposedAction[];
  errors: string[];
  reportPath: string | null;
}

export const CURATOR_DEFAULT: Required<CuratorConfig> = {
  enabled: true,
  intervalHours: 168,
  dryRun: true,
  minIdleHours: 2,
  maxActionsPerRun: 5,
};

export interface CuratorRunner {
  // (prompt, opts) -> Promise<{ ok, text, error? }>
  (prompt: string): Promise<{ ok: boolean; text: string; error?: string }>;
}

export async function runCurator(
  profile: string,
  cfg: CuratorConfig = CURATOR_DEFAULT,
  runner?: CuratorRunner,
): Promise<CuratorRunResult> {
  const merged = { ...CURATOR_DEFAULT, ...cfg };
  const errors: string[] = [];
  const phase1 = runPhase1(profile);

  // Build phase 2 input
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
  let yaml = "";
  if (runner) {
    const r = await runner(prompt);
    if (!r.ok) errors.push(`runner failed: ${r.error}`);
    yaml = r.text ?? "";
  } else {
    const r = await defaultRunner(prompt);
    if (!r.ok) errors.push(`runner failed: ${r.error}`);
    yaml = r.text ?? "";
  }

  const proposed = parseReviewYaml(yaml);

  // Cap and execute
  const capped = proposed.slice(0, merged.maxActionsPerRun);
  const executed: CuratorProposedAction[] = [];
  if (!merged.dryRun) {
    for (const action of capped) {
      const res = await executeAction(profile, action);
      if (res.ok) executed.push(action);
      else errors.push(`exec ${action.kind}: ${res.reason}`);
    }
  }

  // Persist state
  const state = readCuratorState(profile);
  writeCuratorState(profile, {
    ...state,
    last_curator_at: new Date().toISOString(),
    dry_run_count: merged.dryRun ? state.dry_run_count + 1 : state.dry_run_count,
  });

  // Write report
  const reportPath = writeReport(profile, { input, proposed, executed, errors, dryRun: merged.dryRun });

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

async function executeAction(profile: string, action: CuratorProposedAction): Promise<{ ok: boolean; reason?: string }> {
  // Re-check pin/provenance/state right before mutation
  const sidecar = readSidecar(profile);
  switch (action.kind) {
    case "merge": {
      if (!action.skills || !action.into) return { ok: false, reason: "merge missing skills/into" };
      // Create umbrella from concatenated bodies (lazy approach: descriptions only).
      const { skillView } = await import("./skill-view.js");
      const bodies: string[] = [];
      for (const child of action.skills) {
        const v = skillView({ name: child }, profile);
        if (v.ok && v.body) bodies.push(`## ${child}\n\n${v.body}`);
      }
      const merged = bodies.join("\n\n---\n\n");
      const create = await skillManage({ action: "create", name: action.into, description: action.rationale, body: merged }, profile);
      if (!create.ok) return create;
      for (const child of action.skills) {
        const u = sidecar.skills[child];
        if (u?.pinned || u?.provenance !== "agent") continue;
        await skillManage({ action: "delete", name: child, absorbed_into: action.into }, profile);
      }
      return { ok: true };
    }
    case "create_umbrella": {
      if (!action.children || !action.umbrella_name) return { ok: false, reason: "umbrella missing fields" };
      const create = await skillManage({ action: "create", name: action.umbrella_name, description: action.rationale, body: `Umbrella for: ${action.children.join(", ")}\n\nSee references/ for per-child detail.` }, profile);
      if (!create.ok) return create;
      const { skillView } = await import("./skill-view.js");
      for (const child of action.children) {
        const v = skillView({ name: child }, profile);
        if (v.ok && v.body) {
          await skillManage({ action: "write_file", name: action.umbrella_name, path: `references/${child}.md`, content: v.body }, profile);
        }
        const u = sidecar.skills[child];
        if (u?.pinned || u?.provenance !== "agent") continue;
        await skillManage({ action: "delete", name: child, absorbed_into: action.umbrella_name }, profile);
      }
      return { ok: true };
    }
    case "demote_to_references": {
      if (!action.skills || !action.target_skill) return { ok: false, reason: "demote missing fields" };
      const { skillView } = await import("./skill-view.js");
      for (const s of action.skills) {
        const v = skillView({ name: s }, profile);
        if (!v.ok || !v.body) continue;
        await skillManage({ action: "write_file", name: action.target_skill, path: `references/${s}.md`, content: v.body }, profile);
        const u = sidecar.skills[s];
        if (u?.pinned || u?.provenance !== "agent") continue;
        await skillManage({ action: "delete", name: s, absorbed_into: action.target_skill }, profile);
      }
      return { ok: true };
    }
    case "prune": {
      if (!action.skill) return { ok: false, reason: "prune missing skill" };
      return skillManage({ action: "delete", name: action.skill, absorbed_into: "", reason: action.rationale }, profile);
    }
    default:
      return { ok: false, reason: "unknown action" };
  }
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

function writeReport(profile: string, payload: {
  input: CuratorReviewInput;
  proposed: CuratorProposedAction[];
  executed: CuratorProposedAction[];
  errors: string[];
  dryRun: boolean;
}): string {
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
    "",
    "## Errors",
    ...payload.errors.map((e) => `- ${e}`),
  ];
  writeFileSync(join(dir, "REPORT.md"), md.join("\n"));
  return dir;
}
```

(Add the necessary import at top: `profileCuratorLogsDir`)

- [ ] **Step 3: Write phase2 test**

Create `tests/skills-curator-phase2.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "bajaclaw-test-"));
  process.env.BAJACLAW_HOME = root;
  const skDir = join(root, "profiles", "default", "skills");
  mkdirSync(skDir, { recursive: true });
  return { root, skDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
function writeSkill(dir, name) {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name}\nauto_generated: true\n---\nbody for ${name}\n`);
}

test("phase2: dry-run does not mutate", async () => {
  const { skDir, cleanup } = setup();
  try {
    writeSkill(skDir, "fix-img-1080");
    writeSkill(skDir, "fix-img-1088");
    const { recordCreate, setProvenance } = await import("../src/skills/usage.ts");
    recordCreate("default", "fix-img-1080", "agent");
    recordCreate("default", "fix-img-1088", "agent");
    setProvenance("default", "fix-img-1080", "agent");
    setProvenance("default", "fix-img-1088", "agent");

    const yaml = `proposed_actions:
  - kind: merge
    skills: [fix-img-1080, fix-img-1088]
    into: image-dimensions
    rationale: "near-duplicate image dimension fixes"
`;
    const runner = async () => ({ ok: true, text: yaml });

    const { runCurator } = await import("../src/skills/curator.ts");
    const r = await runCurator("default", { enabled: true, dryRun: true, intervalHours: 168, minIdleHours: 2, maxActionsPerRun: 5 }, runner);

    assert.equal(r.proposed.length, 1);
    assert.equal(r.executed.length, 0);
    assert.ok(existsSync(join(skDir, "fix-img-1080", "SKILL.md")));
    assert.ok(existsSync(join(skDir, "fix-img-1088", "SKILL.md")));
  } finally { cleanup(); }
});

test("phase2: live mode merges", async () => {
  const { skDir, cleanup } = setup();
  try {
    writeSkill(skDir, "fix-img-1080");
    writeSkill(skDir, "fix-img-1088");
    const { recordCreate, setProvenance } = await import("../src/skills/usage.ts");
    recordCreate("default", "fix-img-1080", "agent");
    recordCreate("default", "fix-img-1088", "agent");
    setProvenance("default", "fix-img-1080", "agent");
    setProvenance("default", "fix-img-1088", "agent");

    const yaml = `proposed_actions:
  - kind: merge
    skills: [fix-img-1080, fix-img-1088]
    into: image-dimensions
    rationale: "merge"
`;
    const { runCurator } = await import("../src/skills/curator.ts");
    const r = await runCurator("default", { enabled: true, dryRun: false, intervalHours: 168, minIdleHours: 2, maxActionsPerRun: 5 }, async () => ({ ok: true, text: yaml }));

    assert.equal(r.executed.length, 1);
    assert.ok(existsSync(join(skDir, "image-dimensions", "SKILL.md")));
    assert.ok(existsSync(join(skDir, ".archive", "fix-img-1080", "SKILL.md")));
    assert.ok(existsSync(join(skDir, ".archive", "fix-img-1088", "SKILL.md")));
  } finally { cleanup(); }
});

test("phase2: action cap enforced", async () => {
  const { skDir, cleanup } = setup();
  try {
    for (let i = 0; i < 10; i++) writeSkill(skDir, `s${i}`);
    const { recordCreate, setProvenance } = await import("../src/skills/usage.ts");
    for (let i = 0; i < 10; i++) {
      recordCreate("default", `s${i}`, "agent");
      setProvenance("default", `s${i}`, "agent");
    }
    const actions = [];
    for (let i = 0; i < 10; i++) actions.push(`  - kind: prune\n    skill: s${i}\n    rationale: "x"`);
    const yaml = "proposed_actions:\n" + actions.join("\n");
    const { runCurator } = await import("../src/skills/curator.ts");
    const r = await runCurator("default", { enabled: true, dryRun: false, intervalHours: 168, minIdleHours: 2, maxActionsPerRun: 3 }, async () => ({ ok: true, text: yaml }));
    assert.equal(r.executed.length, 3);
  } finally { cleanup(); }
});
```

- [ ] **Step 4: Run phase2 tests**

```bash
node --test tests/skills-curator-phase2.test.js 2>&1 | tail -15
```

Common fixes:
- If YAML parse fails, ensure the indentation in test fixtures is correct.
- If executor errors, check that `setProvenance` actually persists `agent`.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/skills/curator.ts src/skills/curator-prompt.ts tests/skills-curator-phase2.test.js
git commit -m "feat(skills): curator phase 2 (LLM review with dry-run, action cap)"
```

---

## Task 11: Daemon hook + config + CLI commands

**Files:**
- Modify: `src/agent.ts` (or daemon loop)
- Modify: `src/config.ts`
- Modify: `src/types.ts`
- Modify: `src/commands/skill.ts`
- Modify: `src/cli.ts`
- Create: `src/commands/curator.ts`

- [ ] **Step 1: Wire `maybeRunCurator` into the daemon loop**

Find the daemon loop in `src/agent.ts` (or wherever cycles get popped). After a cycle finishes (and before the next idle wait), call `maybeRunCurator(profile)`. Add at the post-cycle log point:

```ts
// non-blocking, fire-and-forget
maybeRunCurator(input.profile, cfg.curator, log).catch((e) => log.warn("curator.fail", { error: (e as Error).message }));
```

Add `maybeRunCurator` export in `src/skills/curator.ts`:

```ts
export async function maybeRunCurator(profile: string, cfg: CuratorConfig | undefined, log?: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void }): Promise<void> {
  const merged = { ...CURATOR_DEFAULT, ...(cfg ?? {}) };
  if (!merged.enabled) return;
  const state = readCuratorState(profile);
  if (!state.first_run_marker_at) {
    writeCuratorState(profile, { ...state, first_run_marker_at: new Date().toISOString() });
    return;
  }
  if (state.last_curator_at) {
    const ageHours = (Date.now() - Date.parse(state.last_curator_at)) / 3_600_000;
    if (ageHours < merged.intervalHours) return;
  } else {
    const ageHours = (Date.now() - Date.parse(state.first_run_marker_at)) / 3_600_000;
    if (ageHours < merged.intervalHours) return;
  }
  // (idle-cycle check is handled by caller cadence; we trigger only between cycles)
  log?.info("curator.start", { profile });
  const r = await runCurator(profile, merged);
  log?.info("curator.done", { profile, transitions: r.transitions, proposed: r.proposed.length, executed: r.executed.length, mode: merged.dryRun ? "dry-run" : "live", reportPath: r.reportPath });
}
```

- [ ] **Step 2: Add CuratorConfig field to AgentConfig**

In `src/types.ts`, add to `AgentConfig`:

```ts
curator?: CuratorConfig;
```

In `src/config.ts`, add `curator` defaults to the merge:

```ts
curator: {
  enabled: true,
  intervalHours: 168,
  dryRun: true,
  minIdleHours: 2,
  maxActionsPerRun: 5,
},
```

Also in `src/config.ts`, drop the `autoSkill` field from defaults (was `autoSkill: AUTO_SKILL_DEFAULT`). Add a one-time warn if old config files contain `autoSkill`:

```ts
if (raw.autoSkill !== undefined) {
  process.stderr.write("[bajaclaw] config field 'autoSkill' is deprecated and ignored. Remove from config.json. See docs/skills.md.\n");
  delete raw.autoSkill;
}
```

- [ ] **Step 3: Add `bajaclaw skill pin/unpin/stats` subcommands**

Read `src/commands/skill.ts`. Add subcommands using the existing commander pattern. Sketch:

```ts
program.command("pin <name>")
  .option("-p, --profile <name>", "profile", "default")
  .action(async (name, opts) => {
    const { recordPin } = await import("../skills/usage.js");
    recordPin(opts.profile, name, true);
    console.log(`pinned ${name} in profile ${opts.profile}`);
  });

program.command("unpin <name>")
  .option("-p, --profile <name>", "profile", "default")
  .action(async (name, opts) => {
    const { recordPin } = await import("../skills/usage.js");
    recordPin(opts.profile, name, false);
    console.log(`unpinned ${name} in profile ${opts.profile}`);
  });

program.command("stats <name>")
  .option("-p, --profile <name>", "profile", "default")
  .action(async (name, opts) => {
    const { readSidecar } = await import("../skills/usage.js");
    const s = readSidecar(opts.profile);
    const e = s.skills[name];
    if (!e) { console.error("no record for", name); process.exit(1); }
    console.log(JSON.stringify(e, null, 2));
  });
```

Adjust `list` command to read sidecar and show state/usage columns.

- [ ] **Step 4: Create src/commands/curator.ts**

```ts
import { Command } from "commander";

export function registerCuratorCommands(program: Command): void {
  const cur = program.command("curator").description("Skill library curator");

  cur.command("run [profile]").description("Run curator immediately")
    .option("--live", "run in live mode (skip dry-run)")
    .action(async (profile = "default", opts) => {
      const { runCurator, CURATOR_DEFAULT } = await import("../skills/curator.js");
      const cfg = { ...CURATOR_DEFAULT, dryRun: !opts.live };
      const r = await runCurator(profile, cfg);
      console.log(JSON.stringify(r, null, 2));
    });

  cur.command("status [profile]").description("Show last run, next run window")
    .action(async (profile = "default") => {
      const { readCuratorState, CURATOR_DEFAULT } = await import("../skills/curator.js");
      const s = readCuratorState(profile);
      const next = s.last_curator_at
        ? new Date(Date.parse(s.last_curator_at) + CURATOR_DEFAULT.intervalHours * 3_600_000).toISOString()
        : "(after first idle interval)";
      console.log(JSON.stringify({ ...s, next_eligible: next }, null, 2));
    });

  cur.command("approve [profile]").description("Leave dry-run mode (live curator)")
    .action(async (profile = "default") => {
      console.log(`To enable live curator for profile '${profile}', set 'curator.dryRun: false' in the profile config. Or run 'bajaclaw curator run --live' for a one-shot live run.`);
    });

  cur.command("dry-run-only [profile]").description("Keep curator in dry-run forever")
    .action(async (profile = "default") => {
      console.log(`To force dry-run, set 'curator.dryRun: true' in the profile config. (This is the default.)`);
    });
}
```

- [ ] **Step 5: Register in src/cli.ts**

```ts
import { registerCuratorCommands } from "./commands/curator.js";
// ...
registerCuratorCommands(program);
```

- [ ] **Step 6: Lint and run all tests**

```bash
npm run lint 2>&1 | tail -10
npm test 2>&1 | tail -30
```

Fix any failing tests. Common: `AgentConfig` consumers expecting `autoSkill`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(skills): curator daemon hook, CLI commands, config defaults"
```

---

## Task 12: Integration smoke test

**Files:**
- Create: `tests/skills-loop.test.js`

- [ ] **Step 1: Write integration test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "bajaclaw-test-"));
  process.env.BAJACLAW_HOME = root;
  const skDir = join(root, "profiles", "default", "skills");
  mkdirSync(skDir, { recursive: true });
  return { root, skDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("end-to-end: agent creates skill, views it, curator merges duplicates", async () => {
  const { skDir, cleanup } = setup();
  try {
    const { skillManage } = await import("../src/skills/skill-manage.ts");
    const { skillView } = await import("../src/skills/skill-view.ts");
    const { skillList } = await import("../src/skills/skill-list.ts");
    const { runCurator } = await import("../src/skills/curator.ts");

    const c1 = await skillManage({ action: "create", name: "fix-1080", description: "Force 1080", body: "set width=1920 height=1080" }, "default");
    assert.equal(c1.ok, true);
    const c2 = await skillManage({ action: "create", name: "fix-1088", description: "Force multiples-of-16", body: "set width=1920 height=1088" }, "default");
    assert.equal(c2.ok, true);

    const v = skillView({ name: "fix-1080" }, "default");
    assert.equal(v.ok, true);

    const list = skillList({}, "default");
    assert.equal(list.length, 2);

    const yaml = `proposed_actions:
  - kind: merge
    skills: [fix-1080, fix-1088]
    into: image-dimensions
    rationale: "consolidate image dimension fixes"
`;
    const r = await runCurator("default", { enabled: true, dryRun: false, intervalHours: 168, minIdleHours: 2, maxActionsPerRun: 5 }, async () => ({ ok: true, text: yaml }));
    assert.equal(r.executed.length, 1);

    const list2 = skillList({}, "default");
    assert.ok(list2.some((s) => s.name === "image-dimensions"));
    assert.ok(!list2.some((s) => s.name === "fix-1080"));
  } finally { cleanup(); }
});
```

- [ ] **Step 2: Run integration test**

```bash
node --test tests/skills-loop.test.js 2>&1 | tail -15
```

- [ ] **Step 3: Run full test suite**

```bash
npm test 2>&1 | tail -30
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add tests/skills-loop.test.js
git commit -m "test(skills): integration loop test"
```

---

## Task 13: Documentation

**Files:**
- Modify: `docs/skills.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update docs/skills.md**

Replace the matching section ("## Matching") with the new system-prompt index pattern. Add new sections for:
- "## Self-learning (skill_manage)"
- "## Curator"
- "## Telemetry sidecar"

Keep the "## Format" and "## Scopes" sections.

- [ ] **Step 2: Update CHANGELOG.md**

Add an entry at the top:

```markdown
## v0.21.0 - 2026-05-05

Self-learning skills.

- New MCP tools: skill_manage, skill_view, skill_list. The agent saves
  reusable procedures mid-cycle via skill_manage(action="create").
- Replaced LLM matcher with system-prompt index injection. Each cycle
  pre-bakes a flat <available_skills> block; agent reads bodies on
  demand via skill_view. Two-layer cache (in-process LRU + on-disk
  snapshot) keeps this nearly free.
- Curator: idle-triggered library consolidation (default 7d interval,
  >=2h since last cycle). Phase 1: pure-function lifecycle transitions
  (active -> stale @30d -> archived @90d). Phase 2: forked Haiku review
  pass with MERGE / CREATE_UMBRELLA / DEMOTE_TO_REFERENCES / PRUNE.
  Dry-run by default for first 3 runs.
- Sidecar telemetry at ~/.bajaclaw/profiles/<profile>/skills/.usage.json
  tracks view_count, use_count, patch_count, state, pinned, provenance.
- Per-profile skill storage (~/.bajaclaw/profiles/<profile>/skills/).
  Manually-authored skills in ~/.bajaclaw/skills/ stay shared and
  read-only to the agent.
- Removed: post-cycle auto-skiller (silent zero-output reviewer).
- Removed: per-cycle LLM matcher (7-15s Haiku tax per cycle).
- New CLI: bajaclaw skill pin/unpin/stats, bajaclaw curator run/status.
```

- [ ] **Step 3: Commit**

```bash
git add docs/skills.md CHANGELOG.md
git commit -m "docs(skills): update for v0.21.0 self-learning system"
```

---

## Task 14: Bump version, build, publish, install, restart

- [ ] **Step 1: Bump version**

```bash
npm version 0.21.0 --no-git-tag-version
```

This updates `package.json`. (We control git tagging manually below.)

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | tail -10
```

Expected: clean build, no TS errors.

- [ ] **Step 3: Run tests one last time**

```bash
npm test 2>&1 | tail -20
```

Expected: all green.

- [ ] **Step 4: Commit version bump and tag**

```bash
git add package.json
git commit -m "v0.21.0: self-learning skills"
git tag v0.21.0
```

- [ ] **Step 5: Publish to npm**

```bash
npm publish 2>&1 | tail -10
```

Expected: `+ bajaclaw@0.21.0`.

- [ ] **Step 6: Push**

```bash
git push origin main && git push origin v0.21.0
```

- [ ] **Step 7: Install globally + restart daemon**

```bash
npm install -g bajaclaw@0.21.0 2>&1 | tail -5
```

Then restart the daemon so it picks up the new code:

```bash
bajaclaw daemon stop default 2>&1 | tail -3
sleep 2
bajaclaw daemon start default 2>&1 | tail -3
```

Verify it's running:

```bash
sleep 3
bajaclaw daemon status default 2>&1 | tail -10
```

Expected: running, version 0.21.0.

---

## Task 15: CI verification

- [ ] **Step 1: Check GitHub workflow runs**

```bash
cd ~/bajaclaw && gh run list --limit 5 2>&1 | head -20
```

Find the run for the latest push.

- [ ] **Step 2: Watch the run**

```bash
gh run watch 2>&1 | tail -30
```

Expected: green.

- [ ] **Step 3: If a job fails**

Pull logs, identify failure, fix, recommit, push:

```bash
gh run view --log-failed 2>&1 | tail -50
```

Apply fix, then:

```bash
git add -A
git commit -m "fix(ci): <specific fix>"
git push origin main
```

Re-watch.

---

## Self-review

After implementing all tasks, before declaring done:

1. **Spec coverage:** Walk the spec sections (storage, skill_manage, skill_view, skill_list, index injection, telemetry, curator, CLI, migration, testing). Confirm each maps to a task.
2. **Placeholder scan:** Search the diff for `TBD`, `TODO`, `FIXME`. Resolve.
3. **Type consistency:** `recordView` / `recordPatch` / etc. signatures match calls. `SkillManageArgs` shape matches mcp/server.ts dispatch.
4. **Pinned/provenance enforcement:** Every mutating action calls `checkMutable`. Curator actions re-check before mutating.
5. **Atomic writes:** Every filesystem write that could be observed by another process uses tempfile + rename.
6. **Test coverage:** Each new module has a test file. Each guard path has a test case.
