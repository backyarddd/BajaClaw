# Skills

Skills are bundles of instructions that get injected into the agent's system
prompt when they match the current task. Format matches Claude Code exactly.

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

## Scopes

Resolved highest-priority first — first match wins:

1. `<agent-dir>/skills/` — agent-specific
2. `~/.bajaclaw/skills/` — user global
3. `<repo>/skills/` — BajaClaw built-ins
4. `~/.claude/skills/` — Claude Code global
5. `.claude/skills/` — Claude Code project

A skill in scope 4 or 5 is automatically available to BajaClaw. A skill in
scopes 1-3 is readable by Claude Code too.

## Matching

`src/skills/matcher.ts` scores each skill against the current task. Triggers
weigh heaviest, then name tokens, then description tokens. Top 3 matches are
injected.

## Commands

- `bajaclaw skill list` — all skills, with scope label
- `bajaclaw skill new <name>` — scaffold SKILL.md
- `bajaclaw skill install <path|url>` — install with confirmation (requires
  `BAJACLAW_CONFIRM=yes`). Prints the full SKILL.md before writing.
- `bajaclaw skill review` — list auto-generated candidates in `~/.bajaclaw/skills/auto/`

There is no community registry. No auto-install. Every install is explicit.
