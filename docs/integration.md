# Integration

BajaClaw is designed to slot into an existing `claude`-CLI setup without
overlaying itself on top of your tools. This document describes every seam.

## 1. The CLI backend

Every call BajaClaw makes to the backend goes through `src/claude.ts` as
`claude -p` (print mode). Flags used:

| flag | purpose |
|---|---|
| `-p "<prompt>"` | one-shot prompt |
| `--model <id>` | `claude-opus-4-5` / `claude-sonnet-4-5` / `claude-haiku-4-5` |
| `--max-turns <n>` | tool-call budget |
| `--allowedTools "..."` | comma-separated allowlist |
| `--disallowedTools "..."` | comma-separated denylist |
| `--mcp-config <path>` | merged MCP config for this cycle |
| `--output-format json` | parsed by BajaClaw (fallback is raw text) |

Detection: `findClaudeBinary()` uses `which claude` (POSIX) or `where.exe
claude` (Windows). If the binary is missing, `bajaclaw doctor` flags it and
`runCycle` returns `ok=false` with a clear error.

`supportsJsonOutput()` probes `--help` once per process and caches the
result. Older backends without `--output-format` still work — BajaClaw
parses the final text directly.

## 2. MCP — consume

Merge order (highest wins):

1. The desktop MCP config:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Linux: `~/.config/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
2. `~/.bajaclaw/profiles/<name>/mcp-config.json`
3. `~/.bajaclaw/profiles/<name>/agent-mcp-config.json`

The merged file is written to `.mcp-merged.json` in the profile directory
before every cycle and passed via `--mcp-config`. Whatever MCP servers you've
configured for your desktop client are automatically available to every
BajaClaw cycle.

Commands: `bajaclaw mcp list | add | remove`.

## 3. MCP — expose

BajaClaw exposes itself as an MCP server (`src/mcp/server.ts`). Resources:

- `bajaclaw://profiles`
- `bajaclaw://profile/<n>/agents`
- `bajaclaw://profile/<n>/memories`
- `bajaclaw://profile/<n>/cycles`
- `bajaclaw://profile/<n>/schedules`

Tools: `bajaclaw_memory_search`, `bajaclaw_task_create`,
`bajaclaw_agent_status`, `bajaclaw_skill_list`.

Transports:

- stdio (default, for config files): `bajaclaw mcp serve --stdio`
- SSE / HTTP (for remote clients): `bajaclaw mcp serve --port 8765`

`bajaclaw mcp register [profile]` writes an entry into every known desktop
MCP config path for your OS. After that, restart the desktop client and it
can query BajaClaw state directly.

## 4. Agent descriptor

`bajaclaw init` writes two paired files:

- `~/.claude/agents/<profile>/<name>.md` — standard agent frontmatter
  (`name`, `description`, `model`, `effort`, `maxTurns`, `disallowedTools`,
  `isolation`, `background`). Any tool that recognises this convention can
  pick up the agent via `@<name>`.
- `~/.bajaclaw/profiles/<name>/config.json` — BajaClaw's runtime config:
  heartbeat, channels, DB path, skill scopes.

Together they define a BajaClaw agent.

## 5. Skills

`SKILL.md` is a markdown file with frontmatter — identical format to
skills in other agent tools. Scopes, highest priority first:

1. `<agent-dir>/skills/`
2. `~/.bajaclaw/profiles/<name>/skills/`
3. `~/.bajaclaw/skills/`
4. `<repo>/skills/` (built-ins)
5. `~/.claude/skills/` (cross-visible with the CLI backend)
6. `.claude/skills/` (project-local)

A skill in scope 5 is available to BajaClaw and any other tool that reads
that directory. A BajaClaw built-in skill is a plain file that can be
copied into scope 5 if you want it visible elsewhere.

## 6. Memory compatibility

With `memorySync: true` in the profile config, each cycle:

- Reads `~/.claude/memory/`, imports new/changed files into the FTS table as
  memories with `source=claude-code`.
- Optionally writes a digest back to
  `~/.claude/memory/bajaclaw-<profile>.md` so sessions of other tools see
  BajaClaw's extracted facts.

Disabled by default. Sync is a per-profile setting — some profiles will want
shared memory, others won't.

## 7. Sub-agent delegation

For heavy coding work, `src/delegation.ts` exports `delegateCoding(task,
opts)` which spawns a dedicated backend session with a writable toolset and
an isolated workdir. The orchestrating BajaClaw agent never writes code
directly — it plans, delegates, and summarizes. This keeps the orchestrator's
transcript reviewable before any code exists.
