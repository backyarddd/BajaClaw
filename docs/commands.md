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

### `bajaclaw trigger [profile] <event>`
Enqueue a task on the given profile.
Options: `--body <text>` to set the task body (default: the event name).

### `bajaclaw migrate [profile]`
Import from a foreign profile directory.
Options: `--from-yonderclaw <dir>` (required).
Strips references to unwanted legacy features.

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
