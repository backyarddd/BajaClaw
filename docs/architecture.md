# Architecture

BajaClaw is a CLI + long-running daemon that drives the `claude` CLI backend
to run autonomous agent cycles.

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
                                             │ (inherited)│
                                             └────────────┘
```

## 13-step cycle (`src/agent.ts`)

1. Load profile config
2. Open DB + check schema
3. Circuit-breaker + rate-limit gate
4. Select task (queue or heartbeat)
5. Recall relevant memories (FTS5)
6. Load AGENT.md / SOUL.md / HEARTBEAT.md
7. Match skills, inject top N
8. Build merged MCP config
9. Assemble prompt
10. Invoke the CLI backend (JSON output when supported)
11. Parse, persist cycle row
12. Extract durable memories
13. Dispatch follow-up actions

Each step is a pure function (where possible) and writes a structured log
entry. Step 10 is the only step that leaves the process boundary.

## Module map

| module | responsibility |
|---|---|
| `src/cli.ts` | commander entrypoint; command routing; post-command update notice |
| `src/agent.ts` | the 13-step loop |
| `src/claude.ts` | `claude` CLI wrapper: detect, build argv, exec, parse JSON |
| `src/db.ts` | SQLite open + migrations (idempotent) |
| `src/safety.ts` | circuit breaker + rate limiter |
| `src/logger.ts` | JSONL logger with 30-day rotation |
| `src/config.ts` | profile config load/save |
| `src/paths.ts` | cross-platform path helpers |
| `src/updater.ts` | version check + upgrade flow |
| `src/banner.ts` | ASCII banner |
| `src/memory/` | recall, extract, compat sync |
| `src/skills/` | scope scanner + matcher |
| `src/mcp/consumer.ts` | merge-order reader + subprocess config |
| `src/mcp/server.ts` | stdio + SSE JSON-RPC server |
| `src/scheduler/` | launchd / systemd / cron / schtasks adapters |
| `src/commands/` | one file per top-level command |
| `src/channels/` | optional telegram + discord gateway |
| `src/delegation.ts` | sub-agent delegation for coding tasks |

## On-disk layout

```
~/.bajaclaw/
  profiles/
    <name>/
      config.json
      bajaclaw.db
      AGENT.md  SOUL.md  HEARTBEAT.md
      skills/              # agent-scoped
      logs/                # JSONL, 30-day rotation
      mcp-config.json      # profile MCP additions
      .mcp-merged.json     # regenerated each cycle
      daemon.pid           # when daemon is running
      daemon.log           # background log
  skills/                  # user-global skills
    auto/                  # self-improve candidates awaiting review
  .update-check.json       # cache for updater (24h TTL)

~/.claude/
  agents/<profile>/<profile>.md      # agent descriptor
  skills/                            # cross-visible scope
  memory/bajaclaw-<profile>.md       # optional sync-out
```

## Error model

- Each cycle either succeeds (`ok=true`, row status `ok`) or fails
  (`ok=false`, row status `error`, `error` column populated).
- A failed cycle increments the circuit-breaker count. 5 consecutive failures
  open the breaker for 15 minutes.
- The rate limiter caps cycles at 60/hour by default (`src/safety.ts`).
- The daemon wraps the loop with exponential backoff (1s → 5min).
- All exec calls use `execa` with arg arrays and `shell: false`.
