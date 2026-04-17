# Claude Integration

BajaClaw is built to be a first-class citizen of the Claude ecosystem. This
document is the map of the seams.

## 1. Claude Code CLI as backend

All Claude calls go through `claude -p` (print mode) via `src/claude.ts`.
Flags used:

| flag | purpose |
|---|---|
| `-p "<prompt>"` | one-shot prompt |
| `--model <id>` | `claude-opus-4-5` / `claude-sonnet-4-5` / `claude-haiku-4-5` |
| `--max-turns <n>` | tool-call budget |
| `--allowedTools "..."` | comma-separated allowlist |
| `--disallowedTools "..."` | comma-separated denylist |
| `--mcp-config <path>` | merged MCP config for this cycle |
| `--output-format json` | parsed by BajaClaw (falls back if unsupported) |

Detection: `findClaudeBinary()` uses `which claude` (POSIX) or `where.exe claude`
(Windows). Missing binary → `bajaclaw doctor` reports and `runCycle` returns
ok=false with a clear error.

## 2. MCP — consume

Merge order (highest wins):
1. Claude Desktop global (`~/Library/Application Support/Claude/...` etc.)
2. `~/.bajaclaw/profiles/<name>/mcp-config.json`
3. `<agent-dir>/agent-mcp-config.json`

The merged file is written to `.mcp-merged.json` in the profile dir before each
cycle and passed via `--mcp-config`. Agents inherit every MCP server the user
has already configured for Claude Desktop.

Commands: `bajaclaw mcp list|add|remove`.

## 3. MCP — expose

BajaClaw exposes itself as an MCP server (`src/mcp/server.ts`). Resources:

- `bajaclaw://profiles`
- `bajaclaw://profile/<n>/agents`
- `bajaclaw://profile/<n>/memories`
- `bajaclaw://profile/<n>/cycles`
- `bajaclaw://profile/<n>/schedules`

Tools: `bajaclaw_memory_search`, `bajaclaw_task_create`, `bajaclaw_agent_status`,
`bajaclaw_skill_list`.

Transports: stdio (default, for config files) and SSE (`--port <n>`).

`bajaclaw mcp register [profile]` writes the correct config into every known
Claude Desktop path for your OS.

## 4. Agent frontmatter

`bajaclaw init` writes two paired files:

- `~/.claude/agents/<profile>/<name>.md` — native Claude Code frontmatter
  (`name`, `description`, `model`, `effort`, `maxTurns`, `disallowedTools`,
  `isolation`, `background`). Invokable from Claude Code via `@<name>`.
- `~/.bajaclaw/profiles/<name>/config.json` — heartbeat, channels, DB path.

Together they define a BajaClaw agent.

## 5. Skills

`SKILL.md` follows Claude Code's format exactly. Scopes, highest priority first:

1. `<agent-dir>/skills/`
2. `~/.bajaclaw/profiles/<name>/skills/`
3. `~/.bajaclaw/skills/`
4. `<repo>/skills/` (built-ins)
5. `~/.claude/skills/` (cross-visible)
6. `.claude/skills/` (project)

A skill placed in `~/.claude/skills/` works in Claude Code and in BajaClaw.

## 6. Memory compatibility

With `memorySync: true` in the profile config, each cycle reads `~/.claude/memory/`,
imports new/changed files into the FTS table, and optionally writes a summary
back to `~/.claude/memory/bajaclaw-<profile>.md` so Claude Code sessions see it too.

## 7. Sub-agent delegation

For coding tasks, `src/delegation.ts` spawns a dedicated `claude -p` with a
writable toolset and an isolated workdir. The orchestrating BajaClaw agent
never writes code; it plans, delegates, and summarizes.
