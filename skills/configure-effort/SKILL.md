---
name: configure-effort
description: Change the effort level (low/medium/high) a BajaClaw profile uses
version: 0.1.0
tools: [Bash, Read, Edit]
triggers: ["change effort", "more effort", "less effort", "high effort", "low effort", "thinking harder", "faster cycles"]
effort: low
---

## When to use
User wants cycles to think longer or finish faster - e.g. bump to `high`
for a weekly reflection, drop to `low` for noisy triage heartbeats.

## Quick reference
- Stored in `~/.bajaclaw/profiles/<profile>/config.json` → `"effort"`.
- Levels: `low`, `medium`, `high`. Maps to the backend CLI's `--effort` flag.
- Default: `medium`.

## Procedure
1. Show current: `bajaclaw effort <profile>`.
2. Set: `bajaclaw effort <level> <profile>`.
   - `bajaclaw effort high` (sets on default profile)
   - `bajaclaw effort low triage`
3. Or edit `config.json` directly: `"effort": "high"`.
4. Change takes effect on the next cycle.

## Pitfalls
- Higher effort ≠ better answers for trivial tasks - it just burns more
  tokens.
- Triage cycles at `high` slow the entire queue. Keep routine work at
  `low` or `medium`.

## Verification
- `bajaclaw effort <profile>` shows the new level.
- Dry-run shows `--effort <level>` in the command line if the flag is
  present.
