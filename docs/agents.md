# Agents

An agent is a pairing of:

- `~/.bajaclaw/profiles/<name>/` - runtime config, DB, logs, schedules, skills
- `~/.claude/agents/<name>/<name>.md` - agent descriptor (shared with other
  tools that respect the convention)

## Templates

| template | purpose | default tools |
|---|---|---|
| `outreach` | email prospecting + follow-ups | no Bash |
| `research` | web research + synthesis | read/search only |
| `support`  | inbox triage | no Bash |
| `social`   | content drafting + scheduling | no Bash |
| `code`     | plans coding work, delegates to a sub-agent | read-only |
| `custom`   | blank slate | all |

## Creating an agent

```
npm install -g bajaclaw            # installs + auto-sets-up the default profile
bajaclaw init my-agent --template research               # additional named profile
bajaclaw init my-agent --template research --model claude-opus-4-7
```

This writes:

- `~/.bajaclaw/profiles/my-agent/` with `AGENT.md`, `SOUL.md`, `HEARTBEAT.md`,
  and a `bajaclaw.config.json`
- `~/.claude/agents/my-agent/my-agent.md` with agent frontmatter

## First run

```
bajaclaw doctor
bajaclaw start my-agent --dry-run   # inspect the assembled prompt
bajaclaw start my-agent             # run one cycle

bajaclaw daemon install my-agent    # schedule heartbeat
bajaclaw daemon start my-agent      # supervisor loop
bajaclaw dashboard my-agent         # http://localhost:7337
```

## AGENT.md / SOUL.md / HEARTBEAT.md

- `AGENT.md` - operating rules; how the agent should behave. Edits take
  effect on the next cycle.
- `SOUL.md` - identity; tone, priorities, what the agent cares about.
- `HEARTBEAT.md` - schedule entries in `<cron> | <task>` form, parsed into
  the DB on daemon first-boot.

BajaClaw pre-0.2 used `CLAUDE.md` in place of `AGENT.md`. The cycle loader
falls back to `CLAUDE.md` if `AGENT.md` is missing, so migrated profiles keep
working. Rename the file at your convenience.

## Per-agent model / effort / tools

`bajaclaw.config.json` in the profile dir is a free-form JSON override. The
cycle config merges over the global default. Example:

```json
{
  "name": "my-agent",
  "template": "research",
  "model": "claude-opus-4-7",
  "effort": "high",
  "maxTurns": 40,
  "allowedTools": ["Read", "Grep", "Glob", "WebSearch", "WebFetch"]
}
```

## Switching profiles

Two ways:

```
bajaclaw start my-agent                  # positional
BAJACLAW_PROFILE=my-agent bajaclaw start # env var
```

`bajaclaw profile list` shows all profiles. `bajaclaw profile delete <name>
--yes` removes one (irreversible).
