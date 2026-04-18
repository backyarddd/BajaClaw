# Troubleshooting

## `bajaclaw doctor` fails on the CLI backend

BajaClaw can't find `claude` on your `PATH`.

- Install the backend. BajaClaw drives it as a subprocess - without it, no
  cycles can run.
- On macOS with Homebrew: ensure `/opt/homebrew/bin` (Apple Silicon) or
  `/usr/local/bin` (Intel) is in your shell PATH.
- On Windows: reopen the terminal after install so `where.exe claude`
  resolves.
- You can override detection by setting `PATH` explicitly in the shell from
  which `bajaclaw` is run.

## `FTS5` check fails in `doctor`

The SQLite binding was compiled without FTS5 support. This is very rare on
`better-sqlite3` because prebuilt binaries include FTS5, but happens if you
force a source build.

Fix: `rm -rf node_modules && npm install`.

## "circuit-breaker open" on `bajaclaw start`

Five consecutive failed cycles tripped the breaker.

- Wait 15 minutes - it auto-closes on cooldown.
- Or inspect the last error: `bajaclaw health <profile>` shows the breaker
  state and the `logs/<date>.jsonl` file has full detail.
- Run `bajaclaw start --dry-run` to confirm the prompt assembles cleanly.

## "rate limit exceeded (N/hr)"

BajaClaw caps cycles at 60/hour by default. Either wait, or edit the cap
passed in `safety.ts` via a profile-level setting if you need more.

## Daemon won't start - "already running (pid N)"

A stale `daemon.pid` file. If `bajaclaw daemon status` says "stale pid N",
delete the file under `~/.bajaclaw/profiles/<name>/daemon.pid` and retry.

## Auto-update notice won't go away

The notice respects three stops:

- `BAJACLAW_NO_UPDATE_NOTICE=1` in the environment
- A successful `bajaclaw update --yes` that brings you up to the latest
- Non-TTY stdout (e.g. piped output) - the notice is silently suppressed

If none of those apply and you still see it, delete
`~/.bajaclaw/.update-check.json` to reset the cache and rerun.

## Skills not being picked up

- Run `bajaclaw skill list` to confirm the scope and path.
- A skill with no `triggers` array and a very short `description` may score
  0 against a short task - add triggers or broaden the description.
- Only the top 3 matches are injected per cycle.

## MCP server in desktop client doesn't show BajaClaw

- Run `bajaclaw mcp register` and check the JSON it wrote.
- Restart the desktop client - MCP config is read on start.
- Run `bajaclaw mcp serve --stdio` manually in a terminal and send a JSON-RPC
  `initialize` request on stdin to confirm the server responds.

## Dashboard is empty

The dashboard reads from `~/.bajaclaw/profiles/<name>/bajaclaw.db`. If you've
never run a cycle, all tables are empty.

## Migration from older directories failed

`bajaclaw migrate --from-yonderclaw <path>` expects a directory with
`CLAUDE.md`, `SOUL.md`, `HEARTBEAT.md`, and optionally a `memory/` folder of
`.md` files. Any file not in that set is ignored. Unwanted legacy
references (QIS / Hive / peer-discovery artifacts) are stripped on import.
