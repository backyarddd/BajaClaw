---
name: setup-profile
description: Create an additional named BajaClaw profile beyond the default
version: 0.1.0
tools: [Bash, Read, Write]
triggers: ["new profile", "add profile", "another agent", "second agent", "create profile", "multiple agents"]
effort: low
---

## When to use
User wants more than one agent — e.g. one for research, one for inbox
triage, one for coding. Each profile gets its own DB, skills, schedule,
logs, and agent descriptor.

## Quick reference
- Location: `~/.bajaclaw/profiles/<name>/`
- Agent descriptor: `~/.claude/agents/<name>/<name>.md` (auto-written)
- Templates: `outreach | research | support | social | code | custom`
- Switch: positional arg or `BAJACLAW_PROFILE` env var.

## Procedure
1. Ask the user what this agent is for — that picks the template.
2. Run: `bajaclaw init <name> --template <tpl>`
   - Example: `bajaclaw init researcher --template research`
3. Optional: set model + effort at init:
   `bajaclaw init researcher --template research --model claude-opus-4-7 --effort high`
4. Edit `~/.bajaclaw/profiles/<name>/AGENT.md` and `SOUL.md` to tailor the
   agent's operating rules and identity.
5. Edit `~/.bajaclaw/profiles/<name>/HEARTBEAT.md` with schedule lines.
6. First run: `bajaclaw start <name> --dry-run` to verify the assembled
   prompt, then `bajaclaw start <name>` for a live cycle.

## Pitfalls
- Profiles don't share memory unless you enable `memorySync` (via
  `~/.claude/memory/` digests). They're independent by design.
- `bajaclaw profile delete <name> --yes` removes the profile directory.
  Not recoverable. Back up `bajaclaw.db` first if you want history.
- Two profiles can't run the dashboard on the same port. Pick different
  `dashboardPort` values in each `config.json`.

## Verification
- `bajaclaw profile list` shows the new profile
- `bajaclaw status <name>` returns stats
- `ls ~/.claude/agents/<name>/` shows the `<name>.md` descriptor
