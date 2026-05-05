# Self-learning skills

Status: approved
Date: 2026-05-05
Target release: v0.21.0 (single bundled release)

## Motivation

Bajaclaw's existing skill system has two structural problems:

1. The post-cycle auto-skiller (`src/skills/auto-skiller.ts`) has produced
   zero skills across 407 cycles. A context-blind reviewer reading
   `(task, response, tool_seq)` after the fact cannot reliably decide what
   was a reusable procedure. The decision is also invisible (no log on
   "NONE" returns), so operators cannot tell whether the system is broken
   or just being conservative.

2. The per-cycle LLM matcher spends 7 to 15 seconds of Haiku per cycle to
   pick top-N skills and almost always returns `[]` because the available
   library is dominated by one-time `setup-*` skills. Pure overhead.

The new shape: the agent itself decides mid-cycle whether to save a
skill (via a `skill_manage` tool), and skills are advertised through a
system-prompt index that the agent reads with a `skill_view` tool. A
separate Curator process consolidates the library on idle.

This design adapts that pattern to bajaclaw with a few changes:
per-profile storage instead of single-user, sidecar telemetry, and an
explicit dry-run period for the curator before live mutations.

## Architecture overview

```
PRE-CYCLE
  Build skills index (cached) -> inject into system prompt
  No LLM matcher call. No body inlining.

CYCLE (claude -p subprocess)
  skill_view(name)     read skill body on demand
  skill_manage(...)    create / edit / patch / delete / write_file / remove_file
  skill_list(...)      filter by state / category

POST-CYCLE
  Update .usage.json for any skill_view'd / skill_manage'd skills
  Memory extraction (unchanged)
  No auto-skiller (deleted)

IDLE (background, gated by maybe_run_curator)
  Trigger: idle >=2h, last curator >=7d, not first run
  Phase 1: pure-function lifecycle transitions
           (active -> stale @30d, stale -> archived @90d)
  Phase 2: forked Haiku review pass
           (MERGE, CREATE_UMBRELLA, DEMOTE_TO_REFERENCES, PRUNE)
```

## Storage layout

Per-profile skills directory at `~/.bajaclaw/profiles/<profile>/skills/`:

```
skills/
  .usage.json                    sidecar telemetry (atomic writes)
  .skills_prompt_snapshot.json   cached index (mtime-keyed)
  .curator_state.json            { last_curator_at, first_run_marker_at }
  .archive/                      archived skills (recoverable)
    <name>/
  <name>/
    SKILL.md                     frontmatter + body
    references/                  optional: session-specific detail
    templates/                   optional: reusable snippets
    scripts/                     optional: runnable helpers
    assets/                      optional: static files
```

Skill lookup precedence (load order, first wins):

1. `~/.bajaclaw/profiles/<profile>/skills/`         agent + per-profile manual
2. `~/.bajaclaw/profiles/<profile>/.bajaclaw/skills/` legacy, kept
3. `~/.bajaclaw/skills/`                            user-shared, manual
4. `<repo>/skills/`                                 bundled builtins

### .usage.json

```json
{
  "schema_version": 1,
  "skills": {
    "<name>": {
      "use_count": 0,
      "view_count": 0,
      "patch_count": 0,
      "last_used_at": null,
      "last_viewed_at": null,
      "last_patched_at": null,
      "created_at": "2026-05-05T...",
      "state": "active",
      "pinned": false,
      "provenance": "agent"
    }
  },
  "deleted": {
    "<name>": {
      "absorbed_into": "<other>",
      "deleted_at": "...",
      "reason": "..."
    }
  }
}
```

Atomic write via tempfile + rename. No lock; cycles already serialize
per profile and the curator never runs while a cycle is pending.

### Frontmatter additions

Conditional activation fields live under `metadata.bajaclaw.*`:

```yaml
metadata:
  bajaclaw:
    requires_tools: [...]
    fallback_for_tools: [...]
    requires_toolsets: [...]
    fallback_for_toolsets: [...]
    config: [...]
```

Provenance is sidecar-tracked, not frontmatter:

- `agent`: written by `skill_manage`. Curator may mutate.
- `user`: manually authored in `~/.bajaclaw/skills/`. Read-only to agent and curator.
- `bundled`: shipped in `<repo>/skills/`. Read-only.

## Component: skill_manage MCP tool

Single agent-facing tool. Lives in `src/mcp/server.ts`.

Actions:

- `create`: new skill from `name`, `description`, `body`, `triggers?`, `effort?`.
- `edit`: full replace of body.
- `patch`: fuzzy-match local edit. `find` (>=3 lines, must match uniquely) -> `replace`.
- `delete`: archive to `.archive/<name>/`. Requires `absorbed_into` (target name or empty string with `reason`).
- `write_file`: write content to relative path under skill dir. Allowed subdirs: `references`, `templates`, `scripts`, `assets`.
- `remove_file`: remove a file under the skill dir.

Guards:

- `pinned: true` rejects all mutating actions.
- `provenance: bundled` rejects all mutating actions.
- `provenance: user` rejects all mutating actions.
- Agent can only mutate `provenance: agent` skills.
- `delete` requires `absorbed_into` (non-null). If empty string, `reason` is required. If non-empty, the named target must exist on disk and be `provenance: agent` and not archived.
- Path safety on `write_file`/`remove_file`: relative only, no `..`, must resolve inside skill dir, only allowed subdirs.

Atomic write contract: every action that touches the filesystem writes
to a tempfile in the same dir, fsyncs, then renames. Failure leaves the
prior state intact. Telemetry update happens after rename succeeds.

Patch action implementation:

1. Read current SKILL.md body.
2. Try exact match of `find`. If unique match -> replace, done.
3. If multiple exact matches -> reject ("ambiguous, narrow context").
4. If no exact match, normalize whitespace (collapse runs, trim line ends) on both sides and retry.
5. If still no match, character-level fuzzy match with similarity >=0.85. If multiple candidates pass, reject. If one passes, replace at that range.
6. Return the line range that was modified.

Telemetry side effects:

- `create`: new entry, `created_at`, `provenance: "agent"`, `state: "active"`, `use_count: 1`.
- `edit`/`patch`/`write_file`/`remove_file`: `patch_count++`, `last_patched_at`.
- `delete`: entry moves under `deleted` block with `absorbed_into` and `reason`.
- Any action reactivates: `state: "stale" -> "active"`.

Logging: every call logs `skill_manage.<action>` with `{name, ok, ms, path}`.

## Component: skill_view MCP tool

```ts
skill_view({ name }) -> { name, description, body, path, frontmatter, state }
```

- Resolves `name` against the skill loader (same lookup precedence as the index).
- Returns full SKILL.md body, no truncation.
- Increments `view_count` and sets `last_viewed_at`.
- 404 if not found.
- 410 if archived (with hint to call `skill_list({state:"archived"})`).

## Component: skill_list MCP tool

```ts
skill_list({ category?, state? }) -> [{ name, description, category, state, last_used_at, pinned, provenance }, ...]
```

Sidecar-backed. Cheap. Lets the agent see archived skills (the index in
the system prompt only covers active set).

## Component: skills index injection

Replaces the LLM matcher entirely. Lives in `src/skills/index-builder.ts`.

Index format injected into every cycle's system prompt:

```
<available_skills>
The following skills are installed for this profile. Each line is `name: description`.
To use a skill, call skill_view(name) to read its full content, then follow it.

# General
- code-review: Review a pull request or local diff against project conventions
- graphify: Turn any input (code, docs, papers) into a clustered knowledge graph

# Setup
- setup-daemon: Configure the bajaclaw daemon for a new profile
- setup-discord: Wire a Discord bot to a profile as a channel source

# Auto-generated
- fix-image-dimensions-1080p: Force image generation to exact 1920x1080 across providers

Before answering, scan this list. If any skill is even partially relevant to the
task, you MUST call skill_view(name) to read its body and follow its instructions.
Err on the side of viewing.

If during a cycle you discover a non-trivial reusable procedure, save it via
skill_manage(action="create"). Don't wait to be asked.
</available_skills>
```

Categories from `metadata.bajaclaw.category`, with defaults:
`setup-*` -> "Setup", `auto_generated: true` -> "Auto-generated",
otherwise -> "General".

Description truncation: 120 chars. Whole index target: under 4KB for
typical 30-100 skill libraries. Warn at >8KB.

Two-layer cache:

1. In-process LRU keyed by `(profile, manifest_hash)`. Holds rendered string. Bounded.
2. On-disk snapshot at `.skills_prompt_snapshot.json` with `{manifest_hash, rendered_index, generated_at}`.

Manifest hash: `sha256(sorted [(rel_path, mtime_ms, size)])` over every
SKILL.md visible to the profile (across all four lookup scopes).

Cache miss: walk skills dirs -> parse frontmatter -> render -> write
snapshot -> return. Sub-50ms typical.

Slash trigger fast path stays: if task starts with `/foo` and a skill has
`triggers: ["/foo"]`, the prompt gets a hint "User invoked /foo, mapping
to skill: foo. Call skill_view('foo')." Agent still goes through
`skill_view` so telemetry stays consistent.

## Component: usage telemetry

Module: `src/skills/usage.ts`

API:

```ts
recordView(profile, name)
recordCreate(profile, name)
recordPatch(profile, name)
recordDelete(profile, name, absorbed_into, reason?)
recordPin(profile, name, pinned)
recordStateTransition(profile, name, newState)
readSidecar(profile) -> Sidecar
writeSidecar(profile, sidecar)  // atomic
```

Atomic writes via `<dir>/.usage.json.tmp.<rand>` + `fsync` + `rename`.

`view_count` vs `use_count`: view = `skill_view` was called. use =
`skill_manage` activated it (created or mutated). High view + low patch
= stable workhorse. High patch + low view = churn. Zero of both + age
> 30d = stale.

Schema migrations gated on `schema_version` bump. `v1` is initial.

## Component: curator

Module: `src/skills/curator.ts`. Plus a daemon-loop hook in `src/agent.ts`.

### Trigger logic

```ts
function maybeRunCurator(profile, log) {
  if (curatorRunning(profile)) return;
  const state = readCuratorState(profile);
  if (firstRun(state)) { setFirstRunMarker(profile); return; }
  if (minutesSinceLastCycle(profile) < 120) return;
  const cfg = readCuratorConfig(profile);
  if (hoursSince(state.last_curator_at) < cfg.intervalHours) return;
  if (activeCyclePending(profile)) return;
  return runCurator(profile, log);
}
```

State at `.curator_state.json`. Per-profile.

### Phase 1: pure-function lifecycle transitions

For each skill in profile (skipping `pinned`, `bundled`, `user`):

```
state transitions:
  active   -> stale     if days_since(any usage) > 30
  stale    -> archived  if days_since(any usage) > 90
                        physical move: skills/<name>/ -> skills/.archive/<name>/
  stale    -> active    if any usage event since last curator run
```

Reactivation runs first.

### Phase 2: forked Haiku review

Inputs: active skill index with `last_used_at`, `use_count`, `provenance`,
`auto_generated`. Plus diff since last curator run.

Auxiliary client: separate `runOnce` invocation, session ID
`curator:<profile>:<ts>`, no shared cache with active cycles.

Prompt asks for YAML report with proposed actions:

```yaml
proposed_actions:
  - kind: merge
    skills: [a, b, c]
    into: combined-name
    rationale: "..."

  - kind: create_umbrella
    children: [setup-foo, setup-bar]
    umbrella_name: setup-things
    children_become: references
    rationale: "..."

  - kind: demote_to_references
    skills: [one-off-fix]
    target_skill: parent
    rationale: "..."

  - kind: prune
    skill: dead-skill
    rationale: "..."
```

Curator executes via the same `skill_manage` codepath (no special bypass).

### Safety rails

- Dry-run mode by default for the first 3 curator runs of any profile. Writes report to `~/.bajaclaw/profiles/<profile>/logs/curator/<ts>/REPORT.md`. After 3 runs, user runs `bajaclaw curator approve` to switch to live mode (or `bajaclaw curator dry-run-only` to keep it advisory forever).
- Per-run action cap: at most 5 mutations.
- `absorbed_into` enforced on all curator deletes.
- Archive, never hard-delete. (Lazy GC of `.archive/` after 90 more days is a future change, out of scope here.)
- Idempotency: re-runs on same skill set produce zero actions.
- Concurrency: phase 1 holds an in-process curator lock for the whole run. Phase 2 releases the lock before the async LLM call and re-acquires it before executing actions. If a cycle started during phase 2, the action executor re-checks `pinned`/`provenance`/`state` for each target before mutating; stale actions are skipped with a logged reason.

### Per-run report

`~/.bajaclaw/profiles/<profile>/logs/curator/<ts>/`:

- `run.json` input snapshot, proposed actions, executed actions, errors
- `REPORT.md` human-readable summary

CLI: `bajaclaw curator status` shows last run, next run window, recent reports.

## CLI changes

Add:

```
bajaclaw skill pin <name> [--profile X]
bajaclaw skill unpin <name> [--profile X]
bajaclaw skill stats <name> [--profile X]
bajaclaw skill list [--profile X] [--state active|stale|archived]
bajaclaw curator run <profile>            manual trigger
bajaclaw curator status [profile]         last/next run, recent reports
bajaclaw curator approve <profile>        leave dry-run mode
bajaclaw curator dry-run-only <profile>   keep advisory forever
```

## Migration and deprecation

Code deleted:

- `src/skills/auto-skiller.ts` whole file
- `src/skills/matcher.ts` LLM router path: `matchSkillsByLLM`, slash-match helper, `LLM_TIMEOUT_MS`. Keep keyword scorer for fuzzy-suggest on `skill_view` 404 and for the slash-trigger hint.
- `synthesizeSkill` import + call in `src/agent.ts`
- `auto-skill.*` log events
- `AutoSkillConfig` from `src/types.ts`

Code refactored:

- `src/agent.ts` prompt assembly: `loadAllSkills` + `matchSkills` replaced by `buildSkillsIndex(profile)`. `assemblePrompt` gets a `skillsIndex` param replacing the existing `skills` body-bundle param.
- `src/skills/loader.ts` `passesRuntimeChecks`: `requires_tools`/`fallback_for_tools` gates move out of load-time into index-visibility-time.

Existing skills migration:

- Manually-authored skills in `~/.bajaclaw/skills/` (3 currently: code-review, port-from-claude, graphify) stay where they are as `provenance: user`.
- Bundled skills stay as `provenance: bundled`.
- Per-profile auto-generated skills: none currently exist.

Config migration:

- Add `curator: { enabled: true, intervalHours: 168, dryRun: true }` block to profile config defaults in `src/config.ts`.
- Remove `autoSkill` block. Silently ignore if present in existing config files; log one-time warn.

## Release plan

Single bundled release: `v0.21.0`. All components ship together.

Release discipline (per saved memory): bump version, npm publish, git
commit + tag + push, no Co-Authored-By, no em dashes. Local install
auto-run after publish.

## Testing strategy

Unit tests (Vitest, existing `tests/` convention):

- `tests/skills/usage.test.ts` atomic write, schema versioning, all `record*` functions
- `tests/skills/index-builder.test.ts` rendering, category grouping, truncation, manifest hash stability
- `tests/skills/index-cache.test.ts` LRU eviction, on-disk snapshot survives restart, hash mismatch invalidates
- `tests/skills/skill-manage.test.ts` every action, every guard, atomic-write rollback, fuzzy-patch happy + ambiguous
- `tests/skills/skill-view.test.ts` telemetry side effects, 404, 410, frontmatter parse-out
- `tests/skills/curator-phase1.test.ts` pure transitions, time gates, pin immunity, reactivation precedence
- `tests/skills/curator-phase2.test.ts` mocked LLM runner returning known YAML, action execution, dry-run, action cap

Integration tests (using temp `BAJACLAW_HOME` per test):

- `tests/integration/skills-loop.test.ts` full simulated cycle: agent calls skill_view, telemetry updates, curator runs, transitions apply
- `tests/integration/skills-migration.test.ts` boot daemon with old config, verify migration adds curator defaults and warns on autoSkill

Snapshot fixtures:

- Existing manually-authored skills (code-review, graphify, port-from-claude) still parse and appear in the index.

Out of scope:

- Real LLM calls (curator phase 2 mocks the runner)
- Multi-profile concurrency edge cases beyond "two profiles don't see each other's sidecars"

## Open questions resolved

1. Storage scope: per-profile.
2. Matcher fate: replace entirely with index injection.
3. Auto-skiller fate: delete.
4. Delete semantics: archive, not hard rm.
5. Release shape: one bundled v0.21.0.
