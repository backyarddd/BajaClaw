---
name: setup-uninstall
description: Safely tear down BajaClaw — integrations, schedulers, data, or all three
version: 0.1.0
tools: [Bash, Read]
triggers: ["uninstall", "remove bajaclaw", "delete bajaclaw", "clean up bajaclaw", "tear down"]
effort: low
---

## When to use
User wants BajaClaw off their machine — completely, or just the
integrations (keeping data), or just a specific profile.

## Quick reference
- Dry-run default: `bajaclaw uninstall` prints the plan, changes nothing.
- `--yes` applies. `--keep-data` preserves `~/.bajaclaw/`.
- Per-profile removal: `bajaclaw profile delete <name> --yes` is the
  scoped alternative.

## Procedure

### Full teardown
1. Show the plan: `bajaclaw uninstall`
2. Review — every item listed will be removed.
3. Apply: `bajaclaw uninstall --yes`
4. Remove the binary itself: `npm uninstall -g bajaclaw`

### Partial (keep data, remove integrations only)
1. `bajaclaw uninstall --yes --keep-data`
2. Removes OS scheduler entries, agent descriptors, MCP registration,
   memory sync files. Preserves `~/.bajaclaw/` — profiles, DB, skills, logs.

### Remove one profile
1. `bajaclaw profile delete <name> --yes`
2. Does NOT remove the global integrations (MCP registration, user-scope
   skills) — use full uninstall for that.

## What gets removed (full uninstall)
- Running daemons (SIGTERM)
- OS scheduler entries for every profile (launchd plist / systemd unit /
  crontab line / schtasks)
- `~/.claude/agents/<profile>/` for every profile
- Memory sync files at `~/.claude/memory/bajaclaw-*.md`
- BajaClaw's MCP entry in the desktop MCP config
- `~/.bajaclaw/` (unless `--keep-data`)

## Pitfalls
- Uninstall is irreversible without `--keep-data`. Back up
  `~/.bajaclaw/profiles/<name>/bajaclaw.db` first if you want history.
- The npm uninstall step is a separate command — `bajaclaw uninstall`
  cannot remove its own binary.

## Verification
- `ls ~/.bajaclaw/` → "no such file or directory"
- `bajaclaw` → "command not found" after the npm uninstall step
