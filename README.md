# BajaClaw

```
 ██████╗  █████╗      ██╗ █████╗      ██████╗██╗      █████╗ ██╗    ██╗
 ██╔══██╗██╔══██╗     ██║██╔══██╗    ██╔════╝██║     ██╔══██╗██║    ██║
 ██████╔╝███████║     ██║███████║    ██║     ██║     ███████║██║ █╗ ██║
 ██╔══██╗██╔══██║██   ██║██╔══██║    ██║     ██║     ██╔══██║██║███╗██║
 ██████╔╝██║  ██║╚█████╔╝██║  ██║    ╚██████╗███████╗██║  ██║╚███╔███╔╝
 ╚═════╝ ╚═╝  ╚═╝ ╚════╝ ╚═╝  ╚═╝     ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝
          autonomous agents on your terms  ·  MIT  ·  v0.14.20
```

I wanted my `claude` CLI to keep working in the background. BajaClaw does that.

It adds memory, skill matching, scheduled cycles, telegram and discord bridges, a local dashboard, and MCP integration on top of the regular claude CLI. Uses whatever login your `claude` already uses. I don't store credentials anywhere.

Named after Baja Blast. The dashboard is that same teal on purpose.

## Install

```
npm install -g bajaclaw
```

Post-install runs `bajaclaw setup` for you. It creates a default profile at `~/.bajaclaw/profiles/default/`, registers BajaClaw as an MCP server, and runs a health check.

Needs Node 22+ and the `claude` CLI on your PATH.

Bleeding edge: `npm install -g github:backyarddd/BajaClaw`.

## First run

```
bajaclaw chat          # interactive REPL
bajaclaw start         # run one cycle against the default profile
bajaclaw dashboard     # http://localhost:7337
bajaclaw daemon start  # run continuously in the background
```

The default profile has full tool access and auto model routing. Edit `~/.bajaclaw/profiles/default/config.json` to tighten.

More: [docs/chat.md](docs/chat.md), [docs/commands.md](docs/commands.md).

## What a cycle is

One cycle: pop a task, recall memories, match skills, merge MCP, run `claude -p`, store the result, extract new memories.

Full loop: [docs/architecture.md](docs/architecture.md).

## Channels

Connect your agent to telegram or discord so you can chat from your phone.

```
bajaclaw channel add default telegram --token <BOT_TOKEN>
bajaclaw channel add default discord --token <BOT_TOKEN> --channel-id <ID>
```

Images and videos in the chat get downloaded, video frames get extracted with ffmpeg, all of it gets attached to the task. On sonnet or opus cycles the agent sends a plan ack up front and milestone pings while it works, so you know it's actually doing the thing.

[docs/channels.md](docs/channels.md)

## Skills

Drop a `SKILL.md` in `~/.bajaclaw/skills/<name>/`. The matcher picks it up on the next cycle and injects it into the prompt when the triggers hit. Compatible with the Claude Code skill format plus openclaw and hermes variants.

```
bajaclaw skill install clawhub:<slug>
bajaclaw skill port               # copy from ~/.claude/skills
bajaclaw skill new my-skill
```

Auto-generated skills land automatically after complex cycles and activate right away.

[docs/skills.md](docs/skills.md)

## MCP

BajaClaw is an MCP server and also consumes MCP.

As a server, it exposes your profiles, memories, cycles, and schedules as resources, plus tools for memory search, task create, agent status, and skill list. Auto-registers with Claude Desktop during `bajaclaw setup`.

As a consumer, it reads its own MCP config by default. Port servers from Claude Code on demand:

```
bajaclaw mcp port --list
bajaclaw mcp port
bajaclaw mcp serve --stdio
```

[docs/integration.md](docs/integration.md)

## OpenAI-compatible HTTP endpoint

Drive any OpenAI-compatible tool with your agent.

```
bajaclaw serve                                   # localhost:8765
bajaclaw serve --api-key $(openssl rand -hex 32) # with auth
```

Works with Cursor, Open WebUI, LibreChat, LangChain, the `openai` SDK, anything that posts to `/v1/chat/completions`. The `model` field in the request is a profile name. Each request is a full cycle.

[docs/api.md](docs/api.md)

## Multiple agents

```
bajaclaw init researcher --template research
bajaclaw init triage --template support
bajaclaw init coder --template code
bajaclaw start researcher
```

Templates: `custom`, `research`, `outreach`, `support`, `social`, `code`. Each profile gets its own DB, skills, schedule, and logs.

[docs/agents.md](docs/agents.md)

## Auto model routing

New profiles default to `model: auto`. Before each cycle, a heuristic routes the task:

| tier | when |
|---|---|
| Haiku  | triage, status checks, heartbeats, very short tasks |
| Sonnet | normal work, answers, summaries |
| Opus   | planning, coding, refactoring, deep research |

Zero extra backend calls for routing. Haiku cycles skip post-cycle memory extract and auto-skill synthesis to keep cheap tasks cheap.

```
bajaclaw model                  # show current
bajaclaw model claude-opus-4-7  # pin a model
bajaclaw model auto             # back to routing
```

## Memory

Every cycle pulls the top 10 relevant memories via FTS5 full-text search and injects them into the prompt. Post-cycle, a fast haiku pass reads the (task, response) pair and writes 0-5 new facts.

Optional two-way sync with Claude Code memory via `memorySync: true` in `config.json`.

[docs/memory.md](docs/memory.md)

## Dashboard

```
bajaclaw dashboard
```

Single HTML file at `http://localhost:7337`. Nine views: Overview, Chat, Cycles, Memory, Tasks, Schedules, Skills, Channels, Settings. Chat lives in-dashboard with full cycle metadata per message. Cycle rows are clickable and open a drawer with the prompt preview, response, model, cost, tokens, and timing.

Daemon auto-starts the dashboard when it boots. Change the port in `config.json`.

## Safety

- Circuit breaker: 5 consecutive failed cycles open it for 15 minutes.
- Rate limit: 30 cycles/hour/profile.
- Cycle serialization: one `claude` subprocess per profile at a time.
- `bajaclaw start --dry-run` prints the full prompt and argv without executing.
- `bajaclaw uninstall` without `--yes` prints the teardown plan and changes nothing.
- Per-cycle USD cap via `maxBudgetUsd` in `config.json`.
- Per-cycle timeout via `cycleTimeoutMs` (default 10 min).
- No telemetry. The only outbound call on its own behalf is the once-per-24h update check to the npm registry.

[docs/security.md](docs/security.md) · [docs/fair-use.md](docs/fair-use.md)

## Setup, reset, uninstall

```
bajaclaw setup                         # safe to rerun; repairs integrations
bajaclaw uninstall                     # dry-run plan
bajaclaw uninstall --yes               # actually tear down
bajaclaw uninstall --yes --keep-data   # keep ~/.bajaclaw/, remove integrations
```

## On-disk layout

```
~/.bajaclaw/
  profiles/
    default/
      config.json        # model, effort, tools, channels, timeouts, budgets
      bajaclaw.db        # SQLite + FTS5
      AGENT.md           # operating guide (edit freely)
      SOUL.md            # identity / voice
      HEARTBEAT.md       # schedule entries
      skills/            # profile-scoped skills
      logs/YYYY-MM-DD.jsonl
  skills/                # user-global skills
  mcp-config.json        # user-global MCP servers
```

## Command cheat sheet

| command | purpose |
|---|---|
| `chat` | interactive REPL |
| `start [profile]` | run one cycle |
| `dashboard` | serve HTTP UI |
| `daemon start/stop/status/logs/install` | background supervisor |
| `channel add/remove/list` | telegram + discord bridges |
| `skill install/port/new/review/promote` | skill lifecycle |
| `mcp port/serve/register/add/remove/list` | MCP consume + expose |
| `profile init/list/switch/delete` | manage profiles |
| `serve` | OpenAI-compatible HTTP endpoint |
| `model / effort / guide` | per-profile knobs |
| `setup / uninstall / update / doctor` | lifecycle |

Full reference in [docs/commands.md](docs/commands.md).

Environment variables: `BAJACLAW_PROFILE`, `BAJACLAW_HOME`, `CLAUDE_HOME`, `BAJACLAW_DRY_RUN`, `BAJACLAW_VERBOSE`, `BAJACLAW_NO_UPDATE_NOTICE`.

## Docs

- [Architecture](docs/architecture.md)
- [Commands](docs/commands.md)
- [Agents and profiles](docs/agents.md)
- [Chat REPL](docs/chat.md)
- [Skills](docs/skills.md)
- [Memory](docs/memory.md)
- [Heartbeat and scheduling](docs/heartbeat.md)
- [Channels (telegram + discord)](docs/channels.md)
- [HTTP API](docs/api.md)
- [Subagents](docs/subagents.md)
- [Compaction](docs/compaction.md)
- [Integration with Claude Code](docs/integration.md)
- [Security](docs/security.md)
- [Fair use](docs/fair-use.md)
- [Troubleshooting](docs/troubleshooting.md)
- [FAQ](docs/faq.md)
- [Contributing](docs/contributing.md)

## License

MIT. No company attribution. You own what your agent makes.
