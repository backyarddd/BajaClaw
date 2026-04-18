# Memory

BajaClaw maintains a per-profile SQLite database with an FTS5 virtual table
for full-text recall.

## Schema

- `cycles` — one row per cycle (task, prompt preview, response preview,
  cost, tokens, status)
- `memories` — durable facts extracted from cycles
- `memories_fts` — FTS5 virtual table over memories.content
- `schedules` — heartbeat entries parsed from HEARTBEAT.md
- `tasks` — inbound tasks awaiting processing (priority: high/normal/low)
- `circuit_state` — key/value for the breaker + arbitrary state
- `prompts` — versioned system prompts for future A/B work

See `src/db.ts` for the migration SQL. Schema is additive — never drops.

## Lifecycle

- **Pre-cycle**: FTS query over the current task terms; top 10 memories are
  injected into the prompt under `# Recalled Memories`.
- **Post-cycle**: a lightweight backend call (Haiku, 1 turn) reads the task +
  response and emits 0-5 durable facts as structured JSON. Each is stored
  with `source=cycle` and `source_cycle_id=<id>`.

## Kinds

Soft taxonomy: `fact`, `decision`, `preference`, `todo`, `reference`,
`claude-code`, `imported`. Not enforced — pick whatever shape is useful in
the dashboard/filter.

## Cross-tool memory sync

Set `memorySync: true` in the profile config to enable two-way sync with
`~/.claude/memory/`:

- **In**: each cycle, new/modified `*.md` files under `~/.claude/memory/`
  become memories with `source=claude-code`.
- **Out**: `writeClaudeMemoryFile(profile)` writes a digest to
  `~/.claude/memory/bajaclaw-<profile>.md` so other tools benefit.

Disabled by default — memory sharing is deliberate, not automatic.

## Searching

Three access points:

- **Dashboard**: `/` → Memories panel with a client-side filter box
- **CLI**: no dedicated `bajaclaw memory search` command yet; use the MCP
  tool or open the DB directly
- **MCP tool**: `bajaclaw_memory_search({ query, limit, profile })` from any
  MCP client — returns the top matches as JSON

## Compaction

BajaClaw auto-compacts its memory pool so the agent can keep learning
without slowing down. See `docs/compaction.md` for the full writeup.

Short version:

- **Trigger**: either memory pool > `threshold` × 200k-token reference
  context window, OR daily at a configurable UTC time (default 00:00).
- **Action**: summarize older memories per kind into denser rows (keeps
  newest 25 per kind verbatim); prune cycle-log rows older than 30
  days; VACUUM the SQLite file.
- **Configure**: set via the setup wizard, via `bajaclaw compact
  --schedule both --threshold 0.75`, or in `config.json` under
  `compaction`.
- **Skipped on `--dry-run`**: a dry-run cycle never triggers backend
  calls.

## Backup

`~/.bajaclaw/profiles/<name>/bajaclaw.db` is a WAL-mode SQLite file. Copy
`bajaclaw.db`, `bajaclaw.db-wal`, and `bajaclaw.db-shm` together. Restore by
replacing the three files while the daemon is stopped.
