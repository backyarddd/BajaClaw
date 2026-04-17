# Skills

Skills are bundles of instructions that get injected into the agent's system
prompt when they match the current task. The format is a markdown file with
YAML frontmatter — compatible with other agent tools that use the same
convention.

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

- `name` — unique within its scope
- `description` — one sentence, shown in `bajaclaw skill list`
- `version` — semver, informational
- `tools` — tools the skill expects to use
- `triggers` — phrases that score highly in the matcher
- `effort` — `low` / `medium` / `high`

## Scopes

Resolved highest-priority first — first match wins:

1. `<agent-dir>/skills/` — agent-specific (in the profile directory)
2. `~/.bajaclaw/profiles/<name>/skills/` — same
3. `~/.bajaclaw/skills/` — user global
4. `<repo>/skills/` — BajaClaw built-ins
5. `~/.claude/skills/` — shared with other agent tools
6. `.claude/skills/` — project-local (cwd)

A skill in scope 5 works in BajaClaw and in anything else that reads that
directory. A skill in scopes 1–4 is readable by other tools if they look at
those paths.

## Matching

`src/skills/matcher.ts` scores each skill against the current task:

- Trigger hit: +5
- Name token hit: +2
- Description token hit: +1

Top 3 (by score > 0) are injected into the prompt as a `# Active Skills`
section.

## Commands

| command | purpose |
|---|---|
| `bajaclaw skill list [profile]` | all skills, with scope label |
| `bajaclaw skill new <name>` | scaffold a blank `SKILL.md` |
| `bajaclaw skill install <path\|url>` | install with confirmation (requires `BAJACLAW_CONFIRM=yes`) |
| `bajaclaw skill review` | list auto-generated candidates in `~/.bajaclaw/skills/auto/` |

`bajaclaw skill install` prints the full SKILL.md before writing and refuses
to continue unless `BAJACLAW_CONFIRM=yes` is set in the environment. There
is no registry, no auto-install, no network fetch without your explicit URL.

## Self-generated skills

Every 15 successful cycles (`src/self-improve.ts`), a reflection call reviews
recent runs. If it identifies a pattern worth capturing, it writes a
candidate `SKILL.md` to `~/.bajaclaw/skills/auto/<name>/`. `bajaclaw skill
review` shows the candidates; move approved ones to `~/.bajaclaw/skills/`
manually.

## Built-ins

- `daily-briefing` — morning briefing covering schedule, priorities, open threads
- `email-triage` — classify inbox; draft replies for routine items
- `web-research` — search + synthesize with inline citations
