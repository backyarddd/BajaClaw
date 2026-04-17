# Agents

An agent is a pairing of:

- `~/.bajaclaw/profiles/<name>/` — config, DB, logs, schedules, skills
- `~/.claude/agents/<name>/<name>.md` — Claude Code agent frontmatter

## Templates

| template | purpose | default tools |
|---|---|---|
| `outreach` | email prospecting + follow-ups | no Bash |
| `research` | web research + synthesis | read/search only |
| `support`  | inbox triage | no Bash |
| `social`   | content drafting + scheduling | no Bash |
| `code`     | plans coding work, delegates to Claude Code | read-only |
| `custom`   | blank slate | all |

## Creating an agent

```
npx create-bajaclaw my-agent --template research
# or:
bajaclaw init my-agent --template research --model claude-sonnet-4-5
```

This writes both files above and leaves you with a working profile. Next:

```
bajaclaw doctor
bajaclaw start my-agent --dry-run
bajaclaw daemon install my-agent   # schedules heartbeat
bajaclaw dashboard my-agent        # http://localhost:7337
```

## CLAUDE.md / SOUL.md / HEARTBEAT.md

- `CLAUDE.md` — operating rules; how the agent should behave.
- `SOUL.md` — identity; who it is, what tone, what it cares about.
- `HEARTBEAT.md` — schedule entries in `<cron> | <task>` form, parsed into DB.

Edit them in the profile dir. Changes take effect on the next cycle.
