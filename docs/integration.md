# Integration

BajaClaw keeps its state **separate** from the desktop CLI's state by
default. You opt in to sharing, skill by skill and server by server. This
document describes every seam.

## 1. The CLI backend

Every call BajaClaw makes to the backend goes through `src/claude.ts` as
`claude -p` (print mode). Flags used:

| flag | purpose |
|---|---|
| `-p "<prompt>"` | one-shot prompt |
| `--model <id>` | `claude-opus-4-7` / `claude-sonnet-4-6` / `claude-haiku-4-5` (resolved from `auto`) |
| `--max-turns <n>` | tool-call budget |
| `--allowedTools "..."` | comma-separated allowlist |
| `--disallowedTools "..."` | comma-separated denylist |
| `--mcp-config <path>` | merged MCP config for this cycle |
| `--output-format json` | parsed by BajaClaw (fallback is raw text) |

Detection: `findClaudeBinary()` uses `which claude` (POSIX) or `where.exe
claude` (Windows). If the binary is missing, `bajaclaw doctor` flags it and
`runCycle` returns `ok=false` with a clear error.

## 2. Skills — isolated by default

BajaClaw scans only BajaClaw-owned directories:

1. `<agent-dir>/skills/`
2. `~/.bajaclaw/profiles/<name>/skills/`
3. `~/.bajaclaw/skills/` (user-global)
4. `<repo>/skills/` (built-ins)

The desktop CLI's `~/.claude/skills/` is **not** read automatically. If you
want a skill available to BajaClaw, port it in:

```
bajaclaw skill port                           # copy all from ~/.claude/skills
bajaclaw skill port --names quick-math        # port one
bajaclaw skill port --link                    # symlink (live sync from desktop)
bajaclaw skill port --scope profile --profile default
bajaclaw skill port --source /path/to/skills  # arbitrary source
```

This works the other direction too — copy a BajaClaw skill into
`~/.claude/skills/` manually and the desktop CLI picks it up (format is
compatible).

See [`skills.md`](skills.md) for the full skill documentation.

## 3. MCP — isolated by default

BajaClaw uses its own MCP config, not the desktop CLI's. Merge order
(highest wins):

1. `<profile>/agent-mcp-config.json`
2. `<profile>/mcp-config.json`
3. `~/.bajaclaw/mcp-config.json` (user-global BajaClaw MCP)
4. Desktop CLI MCP config — **only if `mergeDesktopMcp: true`** in the
   profile's `config.json`

The merged file is written to `.mcp-merged.json` in the profile directory
before every cycle and passed via `--mcp-config`.

### Porting MCP servers from the desktop CLI

```
bajaclaw mcp port --list           # show what's configured for the desktop CLI
bajaclaw mcp port                  # copy every server into BajaClaw's user MCP
bajaclaw mcp port --names fs git   # port just these two
bajaclaw mcp port --force          # overwrite existing BajaClaw entries
```

BajaClaw's own MCP entry (`bajaclaw`) is skipped during port — no
self-references.

### Auto-inherit from desktop (opt-in)

If you want the pre-isolation behavior back — every desktop MCP server
inherited on every cycle — set this in the profile's `config.json`:

```json
{ "mergeDesktopMcp": true }
```

Per profile, not globally.

## 4. MCP — expose

BajaClaw is itself an MCP server (`src/mcp/server.ts`). `bajaclaw setup`
auto-registers it in every known desktop MCP config path for your OS.

**Resources:**

- `bajaclaw://profiles`
- `bajaclaw://profile/<n>/agents`
- `bajaclaw://profile/<n>/memories`
- `bajaclaw://profile/<n>/cycles`
- `bajaclaw://profile/<n>/schedules`

**Tools:**

- `bajaclaw_memory_search({ query, limit, profile })`
- `bajaclaw_task_create({ agent, task, priority })`
- `bajaclaw_agent_status({ agent })`
- `bajaclaw_skill_list({ profile })`

Transports:

- stdio: `bajaclaw mcp serve --stdio`
- SSE: `bajaclaw mcp serve --port 8765`

## 5. Agent descriptor

`bajaclaw init` writes two paired files:

- `~/.claude/agents/<profile>/<name>.md` — standard agent frontmatter
  (`name`, `description`, `model`, `effort`, `maxTurns`, `disallowedTools`,
  `isolation`, `background`). Any tool that respects this convention can
  pick up the agent via `@<name>`.
- `~/.bajaclaw/profiles/<name>/config.json` — BajaClaw's runtime config:
  heartbeat, channels, DB path, skill scopes.

The descriptor is written once. Edit it freely — BajaClaw only reads its
own config, never the descriptor.

## 6. Memory compatibility

Set `memorySync: true` in the profile config to enable two-way sync with
`~/.claude/memory/`:

- **In**: each cycle, new/modified `*.md` files under `~/.claude/memory/`
  become memories with `source=claude-code`.
- **Out**: `writeClaudeMemoryFile(profile)` writes a digest to
  `~/.claude/memory/bajaclaw-<profile>.md`.

Disabled by default.

## 7. Sub-agent delegation

For coding-heavy work, `src/delegation.ts` exports `delegateCoding(task,
opts)` which spawns a dedicated backend session with a writable toolset and
an isolated workdir. The orchestrating BajaClaw agent never writes code
directly.

## 8. Auto-skill synthesis

After a successful cycle that uses 5+ tools (configurable), BajaClaw calls
the backend once more to decide whether the procedure is worth saving. If
yes, a structured `SKILL.md` lands in `~/.bajaclaw/skills/auto/<name>/` for
review. The synthesized format includes `When to use`, `Quick reference`,
`Procedure`, `Pitfalls`, and `Verification` sections.

See [`skills.md`](skills.md) for configuration + review workflow.

---

## Summary

| surface | default behavior | opt-in path |
|---|---|---|
| skills | BajaClaw-only scopes | `bajaclaw skill port` |
| MCP | BajaClaw-only config | `bajaclaw mcp port` or `mergeDesktopMcp: true` |
| memory | isolated | `memorySync: true` |
| agent descriptor | always written | — |
| MCP server | registered on `setup` | — |
