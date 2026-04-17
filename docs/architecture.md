# BajaClaw Architecture

BajaClaw is a CLI + long-running daemon that drives the `claude` CLI to run
autonomous agent cycles on the user's Claude subscription.

```
 ┌─────────────┐   heartbeat / task-queue    ┌──────────────────┐
 │ scheduler   │ ──────────────────────────▶ │ agent cycle (13) │
 │ (launchd/   │                             │   runOnce → CLI  │
 │  systemd/   │                             └─────┬────────────┘
 │  schtasks)  │                                   │
 └─────────────┘                                   ▼
                                             ┌────────────┐
 ┌─────────────┐         ┌──────────────┐    │ claude CLI │
 │  dashboard  │ ◀────── │ SQLite (WAL) │ ◀──┤ subprocess │
 │  (HTML)     │         │  + FTS5      │    │   --mcp    │
 └─────────────┘         └──────────────┘    └─────┬──────┘
                                                   │
                                             ┌─────▼──────┐
                                             │ MCP servers│
                                             │ (desktop)  │
                                             └────────────┘
```

## 13-step cycle (src/agent.ts)

1. Load profile config
2. Open DB + schema
3. Circuit-breaker + rate-limit gate
4. Select task (queue or heartbeat)
5. Recall relevant memories (FTS5)
6. Load CLAUDE.md / SOUL.md / HEARTBEAT.md
7. Match skills, inject top N
8. Build merged MCP config
9. Assemble prompt
10. Invoke claude CLI (JSON output)
11. Parse, persist cycle row
12. Extract durable memories
13. Dispatch follow-up actions

## On-disk layout

```
~/.bajaclaw/
  profiles/
    <name>/
      config.json
      bajaclaw.db
      CLAUDE.md  SOUL.md  HEARTBEAT.md
      skills/              # agent-scoped
      logs/                # JSONL, 30-day rotation
      mcp-config.json      # profile MCP additions
      .mcp-merged.json     # regenerated each cycle

~/.claude/
  agents/<profile>/<profile>.md      # Claude Code-native agent file
  skills/                            # cross-visible scope
  memory/bajaclaw-<profile>.md       # optional sync-out
```

## Safety

- `src/safety.ts` implements a per-profile circuit breaker (5 failures → open,
  15 min cooldown) and a simple rate limiter (60 cycles/hour default).
- `claude` is invoked with `execa` using arg arrays, `shell: false`.
- Dry-run prints the assembled prompt and the exact argv without executing.
