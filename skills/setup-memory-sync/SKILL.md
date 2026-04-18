---
name: setup-memory-sync
description: Enable two-way memory sync between BajaClaw and ~/.claude/memory/
version: 0.1.0
tools: [Bash, Read, Edit, Write]
triggers: ["memory sync", "share memory", "sync memory", "connect memory", "memory compat"]
effort: low
---

## When to use
User wants facts BajaClaw learns across cycles to show up in desktop CLI
sessions (and vice versa), without manual copy/paste.

## Quick reference
- Direction: bidirectional, per-profile, opt-in.
- BajaClaw side: FTS5 `memories` table in `bajaclaw.db`.
- Desktop side: plain markdown files under `~/.claude/memory/`.
- Implementation: `src/memory/claude-compat.ts`.

## Procedure
1. Edit `~/.bajaclaw/profiles/<profile>/config.json`. Add or update:
   ```json
   { "memorySync": true }
   ```
2. On the next cycle, BajaClaw will:
   - Ingest any new/modified `*.md` files under `~/.claude/memory/` into
     its FTS table with `source=claude-code`.
   - Write a digest to `~/.claude/memory/bajaclaw-<profile>.md` so desktop
     sessions see what BajaClaw has been learning.
3. Verify:
   - `bajaclaw dashboard <profile>` - Memories panel will include entries
     with kind `claude-code`.
   - Check `~/.claude/memory/bajaclaw-<profile>.md` for the digest file.

## Pitfalls
- Sync is deliberate, not automatic. Only profiles with `memorySync: true`
  participate.
- The digest file overwrites on each sync - it's a snapshot, not an
  append-log. Don't hand-edit it.
- Large `~/.claude/memory/` directories slow down cycles. If you have
  thousands of files there, consider pruning before enabling sync.

## Verification
- Post-cycle: `bajaclaw dashboard` shows memories with `kind=claude-code`
- `~/.claude/memory/bajaclaw-<profile>.md` exists and contains recent memories
