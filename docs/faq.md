# FAQ

### Do I need an API key?

No. BajaClaw drives the `claude` CLI backend as a subprocess. Whatever
authentication that CLI already has — subscription, API key, or otherwise —
is what BajaClaw uses. BajaClaw itself never sees your credentials.

### Does BajaClaw send data anywhere?

Only where the backend you've configured sends data. BajaClaw adds no
telemetry, no phone-home, no analytics. The optional auto-update check hits
the public npm registry once per 24 hours.

### How does BajaClaw differ from running `claude` in a loop?

The loop part is the easy part. BajaClaw adds:

- **Memory**: FTS5 recall before every cycle, extraction after
- **Skills**: scope-resolved injection based on task matching
- **MCP**: merged desktop + profile + agent config per cycle
- **Scheduling**: OS-native heartbeat + supervisor
- **Safety**: circuit breaker, rate limiter, dry-run, explicit confirmations
- **Observability**: dashboard, JSONL logs, cost + token tracking
- **Multi-agent**: per-profile DBs, channels, skills

### Can I run multiple agents?

Yes. Each profile is independent. `~/.bajaclaw/profiles/<name>/` has its own
DB, logs, skills, heartbeat. Install multiple OS scheduler entries (one per
profile).

### How is this different from a MCP server?

BajaClaw consumes MCP (passes your desktop config to the backend) and
exposes MCP (resources + tools for its own state). The agent loop itself is
not MCP — MCP is RPC; an agent loop is an autonomous scheduler.

### Why SQLite + FTS5 instead of a vector DB?

FTS5 is built into SQLite, zero-setup, and "good enough" for the memory
scale a single user generates. The public interface to recall is a function —
swapping in embeddings later is a ~50-line change.

### Can I run BajaClaw without the daemon?

Yes. `bajaclaw start <profile>` runs exactly one cycle. You can schedule
that via cron, systemd, launchd, Task Scheduler, or any external orchestrator
you prefer. The daemon is a convenience, not a requirement.

### Can I use a different AI backend?

BajaClaw's CLI wrapper is in one file (`src/claude.ts`). It expects the
backend to:

- Take `-p "<prompt>"` (print mode)
- Accept `--model`, `--max-turns`, `--allowedTools`, `--mcp-config`
- Produce either plain text or `--output-format json`

Anything that satisfies that shape can replace the default. Forks welcome.

### How do auto-updates work?

Once per 24h, `src/updater.ts` hits `https://registry.npmjs.org/<name>/latest`
for the current published version. If a newer version is available, a
one-line notice appears after your next command. `bajaclaw update` runs
either `npm install -g create-bajaclaw@latest` (if installed that way) or
`git pull + npm install + npm run build` (if installed from a clone).

Set `BAJACLAW_NO_UPDATE_NOTICE=1` to silence the notice. The check itself
still runs but stays silent.

### Is BajaClaw affiliated with any company?

No. MIT-licensed, no company attribution.

### Will skills auto-install from the internet?

No. Installation requires a local path or URL you pass explicitly, plus
`BAJACLAW_CONFIRM=yes` in the environment. The full SKILL.md is shown before
anything is written.

### Windows support?

Yes. Node 20+, `where.exe claude` for detection, `schtasks` for scheduling,
CRLF in `.bat`/`.ps1` files. Tested paths are POSIX-safe via `path.join`.
