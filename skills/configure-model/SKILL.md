---
name: configure-model
description: Change which backend model a BajaClaw profile uses
version: 0.1.0
tools: [Bash, Read, Edit]
triggers: ["change model", "switch model", "use opus", "use sonnet", "use haiku", "which model", "upgrade model"]
effort: low
---

## When to use
User wants a different model for a profile - e.g. Opus for deep reasoning,
Haiku for fast heartbeat triage, Sonnet as a balanced default.

## Quick reference
- Stored in `~/.bajaclaw/profiles/<profile>/config.json` → `"model"`.
- Special value: `auto` routes per-task (haiku / sonnet / opus).
- Known ids: `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5`.
  Any string is accepted - the backend CLI validates against your
  subscription.
- Tradeoffs: Opus > Sonnet > Haiku in capability; Haiku > Sonnet > Opus in
  speed and cost.

## Procedure
1. Show current: `bajaclaw model <profile>` (prints current + known models).
2. Set: `bajaclaw model <new-model> <profile>`.
   - Examples: `bajaclaw model auto`,
     `bajaclaw model claude-opus-4-7`,
     `bajaclaw model claude-haiku-4-5 researcher`.
3. Or edit `~/.bajaclaw/profiles/<profile>/config.json` directly and set
   `"model": "<id>"`.
4. Change takes effect on the next cycle.

## Pitfalls
- If the id is unknown to the backend, cycles will fail with a model-not-
  found error. Fall back to a known-good id.
- Opus burns tokens fast - for daily heartbeats, Sonnet or Haiku is usually
  the right call. Save Opus for reflection cycles or hard reasoning tasks.

## Verification
- `bajaclaw model <profile>` shows the new id.
- Next cycle's `command:` line (via `--dry-run`) includes `--model <id>`.
