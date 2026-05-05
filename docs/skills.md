# Skills

Skills are bundles of instructions that get injected into the agent's system
prompt when they match the current task. The format is a markdown file with
YAML frontmatter.

BajaClaw's skill store is **isolated** from the desktop CLI's skill store.
Skills don't leak across tools by accident. You can port skills in either
direction with `bajaclaw skill port`.

## Format

```
skills/<name>/SKILL.md
```

```markdown
---
name: email-triage
description: Triage inbox, draft replies for routine items
version: 0.1.0
tools: [Read, Write]
triggers: ["check email", "triage inbox"]
effort: medium
---

## Instructions

<markdown body injected verbatim into the system prompt>
```

Fields:

| field | purpose |
|---|---|
| `name` | unique within its scope |
| `description` | one sentence, shown in `bajaclaw skill list` |
| `version` | semver, informational |
| `tools` | tools the skill expects to use |
| `triggers` | phrases that score highly in the matcher |
| `effort` | `low` / `medium` / `high` |
| `auto_generated` | present when BajaClaw wrote this skill itself |
| `created_at` | ISO timestamp when the agent first wrote this skill |

## Scopes

BajaClaw reads these four directories, in priority order (first match wins):

1. `<agent-dir>/skills/` - agent-specific (per profile)
2. `~/.bajaclaw/profiles/<name>/skills/` - profile-scoped
3. `~/.bajaclaw/skills/` - user-global
4. `<repo>/skills/` - built-ins shipped with BajaClaw

**The desktop CLI's `~/.claude/skills/` is not read automatically.** If you
want a skill from that directory available to BajaClaw, port it in:

```
bajaclaw skill port                          # copies all from ~/.claude/skills
bajaclaw skill port --names my-skill         # copies a specific one
bajaclaw skill port --link                   # symlink instead of copy
bajaclaw skill port --scope profile --profile default   # port into the profile scope
bajaclaw skill port --source /some/dir       # custom source
```

`--link` creates a symlink so the desktop copy stays authoritative - edits
made via the desktop CLI show up in BajaClaw too. `--copy` (default) takes
a snapshot that BajaClaw owns independently.

## Discovery (system-prompt index)

Each cycle's system prompt embeds a flat skills index under
`<available_skills>`. Each line is `name: <truncated description>`,
grouped by category (General / Setup / Auto-generated). The agent reads
the full body of any skill on demand via the `skill_view` MCP tool.

Two-layer cache (in-process LRU + on-disk snapshot at
`.skills_prompt_snapshot.json`) keeps this nearly free. Cache key is the
manifest hash of all visible `SKILL.md` files (path, mtime, size).

When the user invokes a skill explicitly via `/<trigger>`, the prompt
includes a hint pointing the agent at it; otherwise the agent decides
which skills to view based on the description index alone.

## Self-learning (skill_manage)

The agent has a `skill_manage` MCP tool to save reusable procedures
mid-cycle. Actions: `create | edit | patch | delete | write_file |
remove_file`. Saved skills live in
`~/.bajaclaw/profiles/<profile>/skills/<name>/`.

Guards:

- **Pinned** skills reject all mutations. Use `bajaclaw skill pin
  <name>` to fence a skill against future agent edits.
- **Bundled** (`<repo>/skills/`) and **user-authored**
  (`~/.bajaclaw/skills/`) skills are read-only to the agent.
- `delete` requires `absorbed_into` - either the umbrella that absorbed
  the content, or empty string with a `reason` for true prune. Deletes
  archive to `.archive/<name>/` (recoverable), they're not hard-removed.

`patch` uses fuzzy matching: exact substring -> whitespace-normalized
-> character-level similarity (>=0.85). Multiple matches at any phase
reject as ambiguous.

## Curator

Idle-triggered library consolidation. Default 7-day interval, requires
the cycle queue to have been quiet for >=2 hours, dry-run mode for the
first runs.

**Phase 1** (pure-function lifecycle transitions, no LLM call):

- `active -> stale` after 30 days without usage
- `stale -> archived` after 90 days; physical move to `.archive/`
- `stale -> active` on any usage event

Pinned, bundled, and user-authored skills are immune.

**Phase 2** (forked Haiku review with separate prompt cache):

The auxiliary model receives the active skill index plus per-skill
usage stats and proposes one or more of:

- `merge` - consolidate near-duplicates into a single named skill
- `create_umbrella` - 3+ siblings sharing a procedure shape; originals
  demote to `references/<child>.md`
- `demote_to_references` - one-off skill becomes reference doc under a
  parent
- `prune` - never-used, no reusable shape

Per-run cap of 5 mutations (configurable). Reports written to
`~/.bajaclaw/profiles/<profile>/logs/curator/<ts>/REPORT.md`.

## Telemetry sidecar

`~/.bajaclaw/profiles/<profile>/skills/.usage.json` tracks per-skill:

| field | meaning |
|---|---|
| `use_count` | times `skill_manage` mutated it |
| `view_count` | times `skill_view` opened it |
| `patch_count` | edit / patch / write_file / remove_file |
| `last_used_at`, `last_viewed_at`, `last_patched_at` | ISO timestamps |
| `created_at` | when first observed |
| `state` | `active` \| `stale` \| `archived` |
| `pinned` | bool, set via `bajaclaw skill pin/unpin` |
| `provenance` | `agent` \| `user` \| `bundled` |

Atomic writes (tempfile + rename). No locking; cycles serialize per
profile and the curator never runs while a cycle is pending.

## Commands

| command | purpose |
|---|---|
| `bajaclaw skill list [profile]` | all skills visible, with scope label |
| `bajaclaw skill new <name>` | scaffold a blank `SKILL.md` |
| `bajaclaw skill install <path\|url>` | install with explicit confirmation |
| `bajaclaw skill port [--names …] [--link] [--scope …]` | copy/symlink from the desktop CLI scope |
| `bajaclaw skill pin <name>` | freeze a skill against agent mutations |
| `bajaclaw skill unpin <name>` | unfreeze |
| `bajaclaw skill stats <name>` | dump the sidecar entry |
| `bajaclaw curator run [profile]` | trigger a curator pass now (defaults to dry-run) |
| `bajaclaw curator status [profile]` | last/next run, recent reports |

## Configuration

In the profile's `config.json`:

```json
{
  "curator": {
    "enabled": true,
    "intervalHours": 168,
    "dryRun": true,
    "minIdleHours": 2,
    "maxActionsPerRun": 5
  }
}
```

- `enabled` - master switch (default `true`).
- `intervalHours` - cooldown between curator runs. Default 168 (7 days).
- `dryRun` - report what would happen without mutating. Default `true`.
- `minIdleHours` - cycle queue must have been quiet at least this long.
- `maxActionsPerRun` - hard cap on per-pass mutations. Default 5.

## Built-ins

Shipped in this repo under `skills/`.

### General-purpose

- `daily-briefing` - morning briefing covering schedule, priorities, open threads
- `email-triage` - classify inbox; draft replies for routine items
- `web-research` - search + synthesize with inline citations

### Self-knowledge (configure BajaClaw)

These skills teach the agent how to configure BajaClaw itself. When the
user types "help me setup telegram" or "switch to Opus", the matching
skill fires and the agent runs the procedure.

| skill | what it knows |
|---|---|
| `setup-telegram` | connect a Telegram bot, allowlist, gateway |
| `setup-discord` | connect a Discord bot with channel + intents |
| `setup-imessage` | wire up a two-way iMessage bridge (macOS only) |
| `setup-heartbeat` | schedule recurring cycles via the OS scheduler |
| `setup-daemon` | start/stop/install the heartbeat supervisor |
| `setup-dashboard` | launch and configure the local dashboard |
| `setup-mcp-port` | port MCP servers from the desktop config |
| `setup-memory-sync` | enable two-way sync with `~/.claude/memory/` |
| `setup-profile` | create an additional named profile |
| `setup-self-update` | check for and apply updates |
| `setup-uninstall` | teardown with or without data retention |
| `configure-model` | change the backend model for a profile |
| `configure-effort` | change the effort level for a profile |
| `configure-tools` | edit the allowed/disallowed tool list |

Developer workflows (tool-facing, all auto-install + auto-auth via `bajaclaw ensure`):

| skill | what it knows |
|---|---|
| `github` | drive `gh` CLI - PRs, issues, Actions, releases |
| `vercel` | deploy, env, promote/rollback, logs |
| `supabase` | migrations, type gen, edge functions, advisors |
| `pr-review` | four-pass systematic PR review |
| `debug-methodology` | reproduce / bisect / hypothesize / test / fix loop |
| `conventional-commits` | commit messages with the project's rules baked in |
| `ocr-pdf` | text-layer-first PDF + image to text via poppler + tesseract |

Read any of them directly:
```
bajaclaw guide                  # list all
bajaclaw guide telegram         # print the telegram walkthrough
```

Or talk to your agent in natural language - the skill matcher does the
routing.
