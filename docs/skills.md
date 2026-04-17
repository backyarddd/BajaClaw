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
| `source_cycle_id` | which cycle produced an auto-generated skill |

## Scopes

BajaClaw reads these four directories, in priority order (first match wins):

1. `<agent-dir>/skills/` — agent-specific (per profile)
2. `~/.bajaclaw/profiles/<name>/skills/` — profile-scoped
3. `~/.bajaclaw/skills/` — user-global
4. `<repo>/skills/` — built-ins shipped with BajaClaw

**The desktop CLI's `~/.claude/skills/` is not read automatically.** If you
want a skill from that directory available to BajaClaw, port it in:

```
bajaclaw skill port                          # copies all from ~/.claude/skills
bajaclaw skill port --names my-skill         # copies a specific one
bajaclaw skill port --link                   # symlink instead of copy
bajaclaw skill port --scope profile --profile default   # port into the profile scope
bajaclaw skill port --source /some/dir       # custom source
```

`--link` creates a symlink so the desktop copy stays authoritative — edits
made via the desktop CLI show up in BajaClaw too. `--copy` (default) takes
a snapshot that BajaClaw owns independently.

## Matching

`src/skills/matcher.ts` scores each skill against the current task:

- Trigger hit: +5
- Name token hit: +2
- Description token hit: +1

Top 3 (score > 0) are injected into the prompt as `# Active Skills`.

## Commands

| command | purpose |
|---|---|
| `bajaclaw skill list [profile]` | all skills visible, with scope label |
| `bajaclaw skill new <name>` | scaffold a blank `SKILL.md` |
| `bajaclaw skill install <path\|url>` | install with explicit confirmation |
| `bajaclaw skill port [--names …] [--link] [--scope …]` | copy/symlink from the desktop CLI scope |
| `bajaclaw skill review` | list auto-generated candidates in `~/.bajaclaw/skills/auto/` |
| `bajaclaw skill promote <name>` | move an auto-generated candidate into the user scope |

## Auto-generated skills

BajaClaw watches every cycle. When a cycle uses enough tools (5+ by default)
to look like a real procedure, a follow-up call analyzes the task, the tool
sequence, and the response, and — if the procedure is reusable — writes a
structured SKILL.md to `~/.bajaclaw/skills/auto/<name>/`.

This is BajaClaw's take on the "create a skill after a complex task"
behavior popularized by agents like Hermes. The implementation is our own;
the idea is: **if the agent just figured out how to do something non-trivial,
capture the procedure so the next time is faster.**

### Synthesized skill shape

Auto-generated skills follow the same SKILL.md format plus these sections,
which guide the synthesizer:

```markdown
## When to use
<conditions>

## Quick reference
<key facts, 3-5 lines>

## Procedure
1. ...
2. ...

## Pitfalls
- ...

## Verification
- ...
```

The frontmatter is always marked `auto_generated: true` and carries the
`source_cycle_id`. This lets you filter auto-generated skills and trace them
back to the cycle that produced them.

### Configuration

In the profile's `config.json`:

```json
{
  "autoSkill": {
    "enabled": true,
    "minToolUses": 5,
    "maxPerDay": 10
  }
}
```

- `enabled` — master switch (default `true`).
- `minToolUses` — tool-use count required to trigger synthesis. Tasks that
  used fewer tools are considered too trivial to capture.
- `maxPerDay` — hard cap on auto-generated candidates per day. Protects
  against runaway synthesis.

### Review + promote

Auto-skills live in `~/.bajaclaw/skills/auto/<name>/` until you review them.
They are **not** injected into prompts from there — only after you promote.

```
bajaclaw skill review                  # print each candidate's SKILL.md
bajaclaw skill promote <name>          # move <name> from auto/ to user scope
bajaclaw skill promote <name> --force  # overwrite an existing user skill
```

Or, to discard a candidate:

```
rm -rf ~/.bajaclaw/skills/auto/<name>
```

### Trimming the auto dir

Candidates you never promote accumulate in `~/.bajaclaw/skills/auto/`. They
are harmless — unreviewed candidates don't affect prompts. Occasional
cleanup:

```
rm -rf ~/.bajaclaw/skills/auto
```

Nothing will notice.

## Built-ins

Shipped in this repo under `skills/`:

- `daily-briefing` — morning briefing covering schedule, priorities, open threads
- `email-triage` — classify inbox; draft replies for routine items
- `web-research` — search + synthesize with inline citations
