# BajaClaw

```
 ██████╗  █████╗      ██╗ █████╗      ██████╗██╗      █████╗ ██╗    ██╗
 ██╔══██╗██╔══██╗     ██║██╔══██╗    ██╔════╝██║     ██╔══██╗██║    ██║
 ██████╔╝███████║     ██║███████║    ██║     ██║     ███████║██║ █╗ ██║
 ██╔══██╗██╔══██║██   ██║██╔══██║    ██║     ██║     ██╔══██║██║███╗██║
 ██████╔╝██║  ██║╚█████╔╝██║  ██║    ╚██████╗███████╗██║  ██║╚███╔███╔╝
 ╚═════╝ ╚═╝  ╚═╝ ╚════╝ ╚═╝  ╚═╝     ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝
          autonomous agents on your terms  ·  MIT  ·  v0.2.0
```

**BajaClaw** is a CLI + daemon that runs autonomous agents on top of the
`claude` command-line backend. No API keys for core operation. Cross-platform
(macOS, Windows, Linux). MIT.

## Requirements

- Node.js 20+
- The `claude` CLI backend on your PATH (BajaClaw drives it as a subprocess)

## Install

```
npx create-bajaclaw my-agent --template research
```

or

```
npm install -g create-bajaclaw
bajaclaw init my-agent --template research
```

## Quick start

```
bajaclaw doctor                      # check your setup
bajaclaw start my-agent --dry-run    # see the assembled prompt
bajaclaw start my-agent              # run one cycle

bajaclaw daemon install my-agent     # schedule heartbeat via OS scheduler
bajaclaw daemon start my-agent       # supervisor loop
bajaclaw dashboard my-agent          # http://localhost:7337

bajaclaw mcp register                # expose BajaClaw as an MCP server
bajaclaw update                      # check for and install a newer version
```

## Auto-update

BajaClaw checks for newer versions on the npm registry at most once per 24h.
When an update is available, a one-line notice appears after any command:

```
 ╭─────────────────────────────────────────────────────────────╮
 │  update available   0.2.0 → 0.3.0   ·   run: bajaclaw update │
 ╰─────────────────────────────────────────────────────────────╯
```

`bajaclaw update` re-runs the detection, prints the delta, and (with `--yes`)
either runs `npm install -g create-bajaclaw@latest` or `git pull + npm install
+ npm run build` depending on how you installed. Set
`BAJACLAW_NO_UPDATE_NOTICE=1` to silence the notice.

## Architecture

```
 scheduler → agent cycle → claude CLI (subprocess, --mcp-config)
                 │
                 ▼
         SQLite (FTS5)  ← dashboard / MCP server
```

See [`docs/architecture.md`](docs/architecture.md) for the full picture.

## Commands

Full table in [`docs/commands.md`](docs/commands.md). Summary:

| command | purpose |
|---|---|
| `init`      | scaffold a profile + agent descriptor |
| `start`     | run one cycle |
| `dry-run`   | show assembled prompt without executing |
| `status`    | profile stats |
| `health`    | breaker + rate-limit state |
| `doctor`    | verify toolchain + backend |
| `dashboard` | serve local UI |
| `daemon`    | heartbeat supervisor (start/stop/status/logs/install) |
| `mcp`       | consume + expose MCP servers |
| `skill`     | list / new / install / review skills |
| `profile`   | list / create / switch / delete profiles |
| `channel`   | telegram / discord bridges (optional) |
| `trigger`   | enqueue an external event |
| `migrate`   | import from a foreign profile directory |
| `update`    | check for / install a newer version |
| `banner`    | print the ASCII banner |

## Agent types

- `outreach` — email prospecting + follow-ups
- `research` — read-only research + synthesis
- `support`  — inbox triage + reply drafts
- `social`   — content creation + scheduling
- `code`     — orchestrator; delegates coding to a scoped sub-agent
- `custom`   — blank slate

## Integrations

- **CLI backend**: every cycle runs `claude -p` with the right flags. See
  [`docs/integration.md`](docs/integration.md) for the flag set.
- **MCP consume**: BajaClaw merges your desktop MCP config with the profile's
  own overrides. Every MCP server you've configured globally is inherited.
- **MCP expose**: `bajaclaw mcp register` drops a stdio server entry into the
  desktop MCP config so any MCP client can query BajaClaw's memories, cycles,
  and schedules.
- **Agent descriptor**: `bajaclaw init` writes a standard frontmatter `.md` at
  `~/.claude/agents/<profile>/<name>.md` so `@<name>` routing works wherever
  that convention is respected.
- **Skills**: shared format. Skills placed in `~/.claude/skills/` work in both
  BajaClaw and compatible clients.
- **Memory sync**: opt-in two-way sync with `~/.claude/memory/`.
- **Delegation**: coding-heavy tasks are handed to a scoped sub-session via
  `delegateCoding` in `src/delegation.ts`.

## Safety

- Circuit breaker (5 failures → 15min cooldown) and rate limiter (60 cycles/h
  default).
- `execa` with arg arrays, `shell: false`. No string concatenation into
  shell commands.
- Dry-run prints the full prompt + argv without calling the backend.
- Every skill install requires an explicit `BAJACLAW_CONFIRM=yes` env var.
- No telemetry. No phone-home. No DHT or peer discovery. Everything local.

See [`docs/security.md`](docs/security.md).

## Docs

- [`architecture.md`](docs/architecture.md)
- [`integration.md`](docs/integration.md)
- [`commands.md`](docs/commands.md)
- [`agents.md`](docs/agents.md)
- [`skills.md`](docs/skills.md)
- [`memory.md`](docs/memory.md)
- [`heartbeat.md`](docs/heartbeat.md)
- [`channels.md`](docs/channels.md)
- [`security.md`](docs/security.md)
- [`troubleshooting.md`](docs/troubleshooting.md)
- [`faq.md`](docs/faq.md)
- [`contributing.md`](docs/contributing.md)

## License

MIT. No company attribution.
