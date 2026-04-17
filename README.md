# BajaClaw

**Autonomous agents on your Claude subscription.**

BajaClaw is a CLI + daemon that drives the `claude` CLI to run agent cycles on
your Claude Max/Pro subscription. No API keys for core operation. Cross-platform
(macOS, Windows, Linux). MIT.

```
           _
    /\_/\_( )
   ( _ . . _)        bajaclaw
    \_ = _/
     |||||           autonomous agents on your claude subscription
    /|||||\
```

## Requirements

- Node.js 20+
- Claude Code CLI logged into your subscription (`claude --help`)

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

bajaclaw mcp register                # expose BajaClaw to Claude Desktop
```

## Architecture

```
 scheduler → agent cycle → claude CLI (subprocess, --mcp-config)
                 │
                 ▼
         SQLite (FTS5)  ← dashboard / MCP server
```

See `docs/architecture.md` for the full picture.

## Commands

| command | purpose |
|---|---|
| `init` | scaffold a profile + Claude Code agent file |
| `start` | run one cycle |
| `dry-run` | show assembled prompt without calling claude |
| `status` | profile stats |
| `health` | breaker + rate-limit state |
| `doctor` | verify toolchain |
| `dashboard` | serve local UI |
| `daemon` | heartbeat supervisor (start/stop/status/logs/install) |
| `mcp` | consume + expose MCP servers |
| `skill` | list/new/install/review skills |
| `profile` | list/create/switch/delete profiles |
| `channel` | telegram/discord bridges (optional) |
| `trigger` | enqueue an external event |
| `migrate` | import from a YonderClaw directory |

## Agent types

- `outreach` — email prospecting + follow-ups
- `research` — read-only research + synthesis
- `support`  — inbox triage + reply drafts
- `social`   — content creation + scheduling
- `code`     — orchestrator; delegates coding to Claude Code
- `custom`   — blank slate

## Claude ecosystem integration

BajaClaw plays well with the rest of your Claude stack:

- **CLI backend**: every call is `claude -p` with the right flags.
- **MCP consume**: your Claude Desktop MCP servers are inherited automatically.
- **MCP expose**: `bajaclaw mcp register` makes BajaClaw queryable from Claude
  Desktop, Cursor, and any MCP client.
- **Agent frontmatter**: `bajaclaw init` writes a Claude Code-native agent file.
- **Skills**: shared format. Skills in `~/.claude/skills/` work in BajaClaw;
  BajaClaw skills are readable by Claude Code.
- **Memory**: opt-in sync with `~/.claude/memory/`.
- **Delegation**: coding-heavy tasks are handed to a scoped Claude Code
  sub-agent.

Full notes in `docs/claude-integration.md`.

## License

MIT.
