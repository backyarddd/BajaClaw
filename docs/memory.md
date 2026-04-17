# Memory

BajaClaw maintains a per-profile SQLite database with a FTS5 virtual table for
full-text recall.

## Lifecycle

- **Pre-cycle**: query FTS with the current task, inject top 10 as
  `# Recalled Memories` in the prompt.
- **Post-cycle**: a lightweight Haiku call extracts up to 5 durable facts and
  writes them with `source=cycle` and `source_cycle_id=<id>`.

## Kinds

`fact`, `decision`, `preference`, `todo`, `reference`, `claude-code`, `imported`.
The list is not enforced — it's a soft taxonomy for filtering.

## Claude Code compatibility

Set `memorySync: true` in the profile config to enable two-way sync with
`~/.claude/memory/`:

- **From Claude Code**: each cycle, new/modified `*.md` files in `~/.claude/memory/`
  are imported as memories with `source=claude-code`.
- **To Claude Code**: `writeClaudeMemoryFile(profile)` drops a digest at
  `~/.claude/memory/bajaclaw-<profile>.md` so Claude Code sessions benefit.

## Dashboard

The dashboard at `/` hits `/api/memories` and supports a client-side filter box.
Full-text search over the DB is exposed via the MCP tool
`bajaclaw_memory_search`.
