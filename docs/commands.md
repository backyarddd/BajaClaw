# Commands

Full command reference. Every command accepts `--help`.

## Top-level

### `bajaclaw init <name>`
Scaffold a new profile and agent descriptor.

Options:
- `--template <name>` — `outreach` / `research` / `support` / `social` / `code` / `custom` (default: `custom`)
- `--model <id>` — model identifier (default: `claude-sonnet-4-5`)
- `--effort <level>` — `low` / `medium` / `high` (default: `medium`)
- `--force` — overwrite an existing profile

### `bajaclaw start [profile]`
Run a single cycle.

Options:
- `--task <text>` — override the task (otherwise: pull from tasks queue, or emit a heartbeat prompt)
- `--dry-run` — assemble the prompt, print the argv, skip exec

### `bajaclaw dry-run [profile]`
Shortcut for `start --dry-run`.

### `bajaclaw status [profile]`
One-line stats per profile (cycles, memories, pending tasks, last run).

### `bajaclaw health [profile]`
Circuit breaker state, rate limit headroom, last 24h cycle counts.

### `bajaclaw doctor`
Check Node version, backend binary presence + version, SQLite + FTS5, known
config paths. Prints the banner.

### `bajaclaw dashboard [profile]`
Serve the local dashboard on the port from `config.json` (default 7337).

### `bajaclaw serve`
Expose BajaClaw as an OpenAI-compatible HTTP endpoint.

Options:
- `--host <host>` — bind host (default `127.0.0.1`)
- `--port <n>` — bind port (default `8765`)
- `--api-key <key>` — require bearer auth; required for non-localhost binds
- `--expose <names...>` — allowlist of profile names; default exposes all
- `--stream-delay <ms>` — delay per pseudo-streamed chunk (default 20)

Persistent config: `~/.bajaclaw/api.json`. CLI flags override.
Endpoints: `GET /health`, `GET /v1/models`, `POST /v1/chat/completions`,
`POST /v1/bajaclaw/cycle`, `POST /v1/bajaclaw/tasks`. Full reference in
`docs/api.md`.

### `bajaclaw trigger [profile] <event>`
Enqueue a task on the given profile.
Options: `--body <text>` to set the task body (default: the event name).

### `bajaclaw migrate [profile]`
Import from a foreign profile directory.
Options: `--from-yonderclaw <dir>` (required).
Strips references to unwanted legacy features.

### `bajaclaw model [id] [profile]`
Show the configured model for a profile (with no id, lists known models
with the current one marked). Set the model with an id.

Known ids: `claude-opus-4-5`, `claude-sonnet-4-5`, `claude-haiku-4-5`.
Any string is accepted — the backend validates against your subscription.

### `bajaclaw effort [level] [profile]`
Show or set the effort level. Values: `low`, `medium`, `high`. Default:
`medium`.

### `bajaclaw guide [topic]`
Print a built-in setup walkthrough (e.g. `bajaclaw guide telegram`). With
no topic, lists every available guide. Guides are skills whose name starts
with `setup-` or `configure-`.

Options:
- `--profile <name>` — use the given profile's skill scopes when looking up the guide.

Built-in guide topics: `telegram`, `discord`, `heartbeat`, `daemon`,
`dashboard`, `mcp-port`, `memory-sync`, `profile`, `self-update`,
`uninstall`, `model`, `effort`, `tools`.

### `bajaclaw update`
Check for and install a newer version.

Options:
- `--check` — print delta but do not install
- `--yes` — skip the confirmation prompt

### `bajaclaw banner`
Print the ASCII banner.

## MCP

| command | purpose |
|---|---|
| `bajaclaw mcp list [profile]` | show all configured MCP servers (merged) |
| `bajaclaw mcp add [profile] <name> --command <cmd> [--args ...] [--env KEY=VAL ...]` | add a server to the profile config |
| `bajaclaw mcp remove [profile] <name>` | remove a server from the profile config |
| `bajaclaw mcp serve [--stdio] [--port <n>] [--profile <name>]` | run the MCP server (stdio or SSE) |
| `bajaclaw mcp register [profile]` | write the BajaClaw server entry into every known desktop MCP config |

## Skill

| command | purpose |
|---|---|
| `bajaclaw skill list [profile]` | list all skills across all scopes |
| `bajaclaw skill new <name>` | scaffold a `SKILL.md` in user or profile scope |
| `bajaclaw skill install <path\|url>` | install with explicit confirmation |
| `bajaclaw skill review` | list candidates in `~/.bajaclaw/skills/auto/` |

## Profile

| command | purpose |
|---|---|
| `bajaclaw profile list` | list profiles |
| `bajaclaw profile create <name> [--template t]` | alias for `init` |
| `bajaclaw profile switch <name>` | print how to switch |
| `bajaclaw profile delete <name> --yes` | irreversibly delete |

## Daemon

| command | purpose |
|---|---|
| `bajaclaw daemon start [profile] [--fg]` | background daemon (writes pid file) |
| `bajaclaw daemon stop [profile]` | SIGTERM the daemon |
| `bajaclaw daemon status [profile]` | show pid + state |
| `bajaclaw daemon restart [profile]` | stop + start |
| `bajaclaw daemon logs [profile] [--lines N]` | tail the daemon log |
| `bajaclaw daemon install [profile]` | install OS scheduler entry (launchd/systemd/schtasks/cron) |
| `bajaclaw daemon run [profile]` | foreground supervisor (used by OS scheduler) |

## Channel

Optional messaging bridges. Require `npm install` of the relevant optional
dep (already in package.json's optionalDependencies).

| command | purpose |
|---|---|
| `bajaclaw channel add [profile] <kind> --token <t> [--channel-id <id>]` | add a telegram/discord channel |
| `bajaclaw channel remove [profile] <kind>` | remove a channel |
| `bajaclaw channel list [profile]` | list configured channels |

## Environment variables

| var | effect |
|---|---|
| `BAJACLAW_PROFILE` | default profile when `[profile]` is omitted |
| `BAJACLAW_HOME` | override `~/.bajaclaw/` |
| `CLAUDE_HOME` | override `~/.claude/` |
| `BAJACLAW_DRY_RUN=1` | any `runCycle` becomes a dry-run (useful for tests) |
| `BAJACLAW_VERBOSE=1` | mirror log events to stdout/stderr |
| `BAJACLAW_CONFIRM=yes` | allow `skill install` to write |
| `BAJACLAW_NO_UPDATE_NOTICE=1` | suppress the post-command update notice |
| `BAJACLAW_DAEMON=1` | set automatically when running under the daemon supervisor |
