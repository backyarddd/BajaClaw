# BajaClaw

```
 ██████╗  █████╗      ██╗ █████╗      ██████╗██╗      █████╗ ██╗    ██╗
 ██╔══██╗██╔══██╗     ██║██╔══██╗    ██╔════╝██║     ██╔══██╗██║    ██║
 ██████╔╝███████║     ██║███████║    ██║     ██║     ███████║██║ █╗ ██║
 ██╔══██╗██╔══██║██   ██║██╔══██║    ██║     ██║     ██╔══██║██║███╗██║
 ██████╔╝██║  ██║╚█████╔╝██║  ██║    ╚██████╗███████╗██║  ██║╚███╔███╔╝
 ╚═════╝ ╚═╝  ╚═╝ ╚════╝ ╚═╝  ╚═╝     ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝
          autonomous agents on your terms  ·  MIT  ·  v0.17.1
```

## What BajaClaw is

BajaClaw is an agentic wrapper around the [Claude Code](https://claude.com/claude-code) CLI. It turns the one-shot `claude -p <prompt>` command into a long-running autonomous agent with persistent memory, matched skills, a schedule, chat channels, a local dashboard, and full MCP integration.

Every cycle is a subprocess of the real `claude` CLI. BajaClaw never calls the Anthropic API directly and never sees credentials. Whatever Anthropic login the `claude` CLI is using, the BajaClaw agent is using. No separate API key, no separate subscription, no extra rate limit. If Claude Code works on the account, BajaClaw works on the account.

Around that subprocess, BajaClaw adds:

- **Persistent memory.** An FTS5 full-text index of facts, decisions, preferences, todos, and references. Every non-Haiku cycle extracts new memories automatically. Every subsequent cycle pulls the top matches into the prompt as context.
- **Skill matching.** Each cycle scores installed skills against the task body and injects the top matches as `# Active Skills` in the prompt. Compatible with the Claude Code `SKILL.md` format plus `openclaw` and `hermes` variants.
- **OS-native scheduling.** Heartbeat cycles run on `launchd`, `systemd`, `cron`, or `schtasks`, depending on the host. Agents keep working when no terminal is open.
- **Chat channels.** Two-way bridges to Telegram and Discord. Inbound messages become tasks; outbound replies route back through the same channel. Photos and videos land as attachments the agent can read directly.
- **Local dashboard.** A single-page HTML UI at `http://localhost:7337` with a live cycle feed, in-browser chat, memory search, clickable cycle drilldown, task queue, schedule editor, skill inventory, channel config, and a settings form.
- **MCP integration, both ways.** BajaClaw exposes its own MCP server with resources (profiles, memories, cycles, schedules) and tools (memory search, task create, agent status, skill list). It is also an MCP consumer and can inherit or port servers from Claude Code.
- **OpenAI-compatible HTTP endpoint.** `bajaclaw serve` exposes `/v1/chat/completions`, so Cursor, Open WebUI, LibreChat, LangChain, the `openai` SDK, or any tool that speaks the OpenAI API can drive the agent.
- **Auto-routing between Haiku, Sonnet, and Opus.** New profiles default to `model: auto`. A heuristic classifier routes trivial tasks to Haiku, normal work to Sonnet, and planning/coding/deep research to Opus. Zero extra backend calls for the routing decision.
- **Self-configuration.** BajaClaw ships with built-in setup guides for Telegram, Discord, memory sync, MCP porting, heartbeat scheduling, model switching, and more. If the procedure for setting something up is unclear, ask the agent in plain language ("help me set up Telegram"). The matching guide fires, and the agent walks through the full configuration, running the correct `bajaclaw` subcommands as needed. The same guides are available at the CLI via `bajaclaw guide <topic>`.

Each agent is a self-contained directory. Delete the directory, that agent is gone. Back it up, it's portable.

---

## Install

```
npm install -g bajaclaw
```

On unix terminals, the postinstall hook opens `/dev/tty` and runs the interactive setup wizard directly. It asks for:

- Agent name and the name the agent calls you
- Voice/tone (concise, friendly, formal, playful, etc.)
- Timezone
- Focus (one or two sentences on what the agent is for)
- Topics of interest and hard "don't" rules
- Memory compaction schedule
- Default model and effort level
- Telegram and Discord channels (optional, can skip and add later)

On Windows, CI, or environments without a controlling terminal, the postinstall falls back to a silent scaffold. The first interactive `bajaclaw` run will then launch the wizard automatically.

**Requirements:** Node 22+, and the [`claude` CLI](https://docs.claude.com/en/docs/claude-code/setup) on `PATH`. BajaClaw drives the CLI as a subprocess and inherits its authentication.

**Bleeding edge:** `npm install -g github:backyarddd/BajaClaw` installs from main and runs the `prepare` script to build `dist/`.

To rerun the wizard later or repair a broken install:

```
bajaclaw setup --interactive
```

---

## First run

```
bajaclaw chat          # interactive REPL with the default agent
bajaclaw start         # run one scheduled cycle
bajaclaw dashboard     # http://localhost:7337
bajaclaw daemon start  # always-on background supervisor
```

The default profile has full tool access (`Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob`, `WebSearch`, `WebFetch`, plus any MCP tools), `model: auto`, `effort: max`, and a 10-minute per-cycle timeout. To tighten, edit `~/.bajaclaw/profiles/default/config.json`.

Or let the agent configure itself:

```
bajaclaw chat
> help me tighten the tool list to just Read, Write, Edit, and Bash
```

More: [docs/chat.md](docs/chat.md), [docs/commands.md](docs/commands.md).

---

## How a cycle works

A BajaClaw cycle is 13 steps. Defined in [`src/agent.ts`](src/agent.ts).

1. Load the profile config
2. Open the SQLite DB and apply migrations
3. Check the circuit breaker and rate limiter
4. Pop the next pending task (or use the heartbeat default)
5. Full-text recall the top relevant memories
6. Load `AGENT.md`, `SOUL.md`, `HEARTBEAT.md`
7. Score all skills against the task, inject the top matches
8. Merge the MCP config (user + profile + desktop if enabled)
9. Assemble the final prompt
10. Exec `claude -p` with `--model`, `--effort`, `--allowedTools`, `--disallowedTools`, `--mcp-config`, `--output-format json`
11. Parse the response, persist the cycle row
12. Extract 0-5 durable memories into the FTS index (skipped for Haiku)
13. Dispatch follow-ups (channel replies, queued tasks, reflection)

Run one manually:

```
bajaclaw start                # execute against the default profile
bajaclaw start --dry-run      # print the assembled prompt + argv, no exec
bajaclaw start researcher     # different profile
```

Cycles are idempotent and safe to re-run. Deep dive: [docs/architecture.md](docs/architecture.md).

---

## Auto model routing

New profiles default to `model: auto`. A heuristic classifier runs before each cycle and routes the task:

| tier   | when it fires                                                      | budget                          |
|--------|---------------------------------------------------------------------|---------------------------------|
| Haiku  | triage, status checks, heartbeats, very short tasks                 | 3 memories, 1 skill             |
| Sonnet | normal questions, summaries, small edits                             | 5 memories, 2 skills            |
| Opus   | planning, coding, refactoring, deep research, reflection             | 7 memories, 3 skills            |

Haiku cycles skip post-cycle memory extraction and auto-skill synthesis to keep cheap tasks cheap.

Override per profile:

```
bajaclaw model                       # show current + list known
bajaclaw model auto                  # route per task
bajaclaw model claude-opus-4-7       # pin to a single model
bajaclaw effort max                  # biggest turn budget
```

---

## Profiles and templates

A profile is an agent. It has its own database, skills, schedule, logs, channels, and persona. Default comes scaffolded during install.

```
bajaclaw init researcher --template research
bajaclaw init triage --template support
bajaclaw init coder --template code
bajaclaw profile list
bajaclaw start researcher                         # run a cycle for one
BAJACLAW_PROFILE=triage bajaclaw daemon start     # or pin via env
```

Templates:

| template   | shape                                                                     |
|------------|---------------------------------------------------------------------------|
| `custom`   | blank slate, full tools (the default)                                     |
| `research` | research + synthesis + artifact writing, full tools                        |
| `outreach` | email prospecting and drafting                                             |
| `support`  | inbox triage and reply drafts                                              |
| `social`   | content drafting and scheduling                                            |
| `code`     | orchestrator that delegates to a read-only coding sub-agent                |

More: [docs/agents.md](docs/agents.md).

---

## Memory

Every cycle full-text-queries the profile's `memories` table against the current task text and injects the top matches as `# Recalled Memories`. After the cycle, a 1-turn Haiku pass reads the (task, response) pair and emits up to 5 structured facts:

```json
{
  "memories": [
    { "kind": "decision",   "content": "Use PostgreSQL 16 for the new service." },
    { "kind": "fact",       "content": "Alice owns the billing pipeline." },
    { "kind": "preference", "content": "User prefers tabs over spaces in config files." }
  ]
}
```

Those facts become FTS-indexed rows with `source=cycle` and `source_cycle_id=<id>`. Kinds are a soft taxonomy: `fact`, `decision`, `preference`, `todo`, `reference`, `claude-code`, `imported`.

**Compaction.** The pool is auto-compacted so recall stays sharp. Defaults to both triggers: when the pool hits 75% of the 200k reference context, or daily at 00:00 UTC. Configurable in `config.json`:

```json
{
  "compaction": {
    "enabled": true,
    "schedule": "both",
    "threshold": 0.75,
    "dailyAtUtc": "00:00",
    "keepRecentPerKind": 25,
    "pruneCycleDays": 30
  }
}
```

**Claude Code memory sync** (opt-in). Set `"memorySync": true` in the profile config and BajaClaw will ingest new files from `~/.claude/memory/` before each cycle and write a digest to `~/.claude/memory/bajaclaw-<profile>.md` after each cycle, so Claude Code sessions see what BajaClaw has been learning.

More: [docs/memory.md](docs/memory.md), [docs/compaction.md](docs/compaction.md).

---

## Skills

A skill is a `SKILL.md` file with YAML frontmatter plus a markdown body. Drop one into a skill directory and the matcher picks it up on the next cycle.

```
bajaclaw skill list                              # what's loaded
bajaclaw skill new my-skill                      # scaffold a new one
bajaclaw skill install clawhub:<slug>            # from the ClawHub registry
bajaclaw skill install <url>                     # from a tarball/zip/URL
bajaclaw skill install <local-path>              # from a local dir
bajaclaw skill search <query>                    # search ClawHub
bajaclaw skill port                              # copy from ~/.claude/skills
bajaclaw skill port --link                       # symlink (live sync from Claude Code)
```

**Matching rules.** A skill is scored against the task text. Trigger phrase hit: +5. Name token hit: +2. Description token hit: +1. Top N (where N depends on model tier) are injected.

**Directory priority** (highest wins):

| priority | path                                         |
|----------|----------------------------------------------|
| 1        | `<claude-agent-dir>/skills/`                 |
| 2        | `~/.bajaclaw/profiles/<name>/skills/`        |
| 3        | `~/.bajaclaw/skills/`                        |
| 4        | `<repo>/skills/` (built-in)                  |

`~/.claude/skills/` is **not** read automatically. Use `bajaclaw skill port` to copy them in or `--link` to symlink.

**Auto-generated skills.** After any cycle that uses 5+ tools (configurable), BajaClaw asks the backend whether the procedure is worth saving. If yes, it writes a structured `SKILL.md` (When to use / Quick reference / Procedure / Pitfalls / Verification) and activates it immediately for future cycles.

```json
{
  "autoSkill": {
    "enabled": true,
    "minToolUses": 5,
    "maxPerDay": 10
  }
}
```

**Foreign-format compat.** `SKILL.md` files from the `openclaw` and `hermes` ecosystems are read in their native metadata layouts (no conversion required). See [docs/skills.md](docs/skills.md).

**Bundled skills.** The repo ships with a baseline set so the agent is useful on first run:

| skill | what it does |
|---|---|
| `github` | PRs, issues, Actions, releases via `gh`; auto-installs + auth |
| `vercel` | deploy, env, promote/rollback, logs; auto-installs + auth |
| `supabase` | migrations, types, edge fns, advisors; auto-installs + auth |
| `pr-review` | four-pass systematic code review |
| `debug-methodology` | reproduce / bisect / hypothesize / test / fix loop |
| `conventional-commits` | commit messages the project expects |
| `ocr-pdf` | PDF and image to text via poppler + tesseract |
| `web-research` | multi-source search with citations |
| `email-triage`, `daily-briefing`, `delegate-to-subagent` | routine agent ops |
| `setup-*` | interactive configuration walkthroughs (telegram, discord, mcp, etc.) |

---

## Fluid tool bootstrap

Tool-facing skills (and any code path that depends on a system CLI) call `bajaclaw ensure <tool>` before their first command. It auto-installs the tool using whichever package manager is present on the box (brew/apt/dnf/pacman/winget/scoop/choco/npm/pipx), and with `--auth` it kicks off the tool's OAuth/login flow. The skill never tells the user "install X first" - it just runs and proceeds.

```
bajaclaw ensure gh --auth         # install gh, then run `gh auth login`
bajaclaw ensure vercel --auth
bajaclaw ensure supabase --auth
bajaclaw ensure ffmpeg            # no auth needed
bajaclaw ensure-list              # every tool bajaclaw knows how to bootstrap
```

Exit codes are structured so skills can branch: 0 ready, 10 install failed, 20 auth pending, 30 unsupported platform, 40 no package manager available. Works on macOS, Linux, and Windows.

---

## Channels (Telegram, Discord, iMessage)

Connect the agent to a chat platform so it can be reached from a phone.

```
bajaclaw channel add default telegram --token <BOT_TOKEN>
bajaclaw channel add default discord --token <BOT_TOKEN> --channel-id <ID> --user-id <YOUR_ID>
bajaclaw channel add default imessage --contact +15551234567 --contact friend@icloud.com
bajaclaw channel list default
bajaclaw channel remove default telegram
```

For Telegram, `--user-id` is the numeric ID from `@userinfobot`; it's stored as the allowlist. For Discord, `--channel-id` is the server channel; `--user-id` is optional and restricts who the bot responds to. For iMessage (macOS only), `--contact` is a phone number (any format) or an Apple ID email, repeatable; only messages from allowlisted handles route through.

Inbound messages (from allowlisted senders) are normalized into the tasks queue. The daemon picks them up on the next poll. Outbound replies route back through the same channel. Typing indicators appear while cycles run.

**Image and video attachments.** Telegram and Discord adapters download inline photos, image documents, videos, video notes, and video documents to a tmp path. Videos are pre-processed with `ffmpeg` and `ffprobe` into 8 evenly spaced frames. The agent receives the file paths in the task body and reads them with its `Read` tool.

**Live feedback on Sonnet/Opus channel cycles.** For multi-step tasks that route to Sonnet or Opus, the agent sends a short plan acknowledgment in its own voice before starting work, then optional milestone pings while it runs (capped at 3 per cycle). Short questions skip the ack and go straight to the final reply. The typing indicator stays on through both the pings and the final reply.

More: [docs/channels.md](docs/channels.md). Guided setup: `bajaclaw guide telegram` or `bajaclaw guide discord`.

---

## Scheduling and heartbeat

BajaClaw runs cycles on a schedule via OS-native scheduling.

```
bajaclaw daemon install          # writes launchd plist (macOS) / systemd unit (linux)
                                 #        / cron entry / schtasks (windows)
bajaclaw daemon uninstall        # removes the scheduler entry
bajaclaw daemon start            # run the supervisor loop in the foreground
bajaclaw daemon stop             # stop a background supervisor
bajaclaw daemon status           # show pid + uptime
bajaclaw daemon logs             # tail daemon.log
```

The heartbeat default prompt is "Heartbeat check. Review state, note anything worth action, and return a brief summary." Override by editing `HEARTBEAT.md` in the profile directory or adding cron-syntax schedule entries:

```
# ~/.bajaclaw/profiles/default/HEARTBEAT.md
*/30 * * * *   | Check the inbox for new support emails and triage them.
0 9 * * 1-5    | Draft a morning summary of active projects.
```

More: [docs/heartbeat.md](docs/heartbeat.md).

---

## Dashboard

```
bajaclaw dashboard              # http://localhost:7337
```

A single HTML file served by an in-process HTTP server. Nine views via sidebar navigation:

- **Overview.** Stat cards (cycles today/week, spend, tokens, memories), recent cycles, pending tasks.
- **Chat.** In-browser chat with the agent. Each message shows model, duration, cost, tokens, cycle id. History is persisted in `localStorage`.
- **Cycles.** Recent history. Rows are clickable and open a drawer with the full task body, prompt preview, response, raw error text, model, cost, tokens, timing, and the originating task row if the cycle came from a queue.
- **Memory.** FTS-searchable memory browser with a client-side filter.
- **Tasks.** Pending/running/done task queue.
- **Schedules.** Heartbeat schedule editor.
- **Skills.** Installed skills with origin color coding (bajaclaw, openclaw, hermes). Inactive skills show the reason.
- **Channels.** Configured Telegram/Discord channels with masked tokens and allowlist.
- **Settings.** Whitelisted form editor for model, effort, context window, dashboard port, autostart, memory sync, max budget.

The daemon auto-starts the dashboard when it boots. Disable via `"dashboardAutostart": false` or change the port via `"dashboardPort"` in `config.json`. Auto-refreshes every 5s except on chat and settings views.

---

## MCP (both directions)

**Expose.** BajaClaw is itself an MCP server. `bajaclaw setup` auto-registers it with Claude Desktop. Any MCP client can then query BajaClaw state directly.

Resources:

- `bajaclaw://profiles` - list of configured profiles
- `bajaclaw://profile/<name>/agents` - agents in that profile
- `bajaclaw://profile/<name>/memories` - FTS-searchable memory
- `bajaclaw://profile/<name>/cycles` - recent cycle history
- `bajaclaw://profile/<name>/schedules` - heartbeat entries

Tools:

- `bajaclaw_memory_search({ query, limit, profile })`
- `bajaclaw_task_create({ agent, task, priority })`
- `bajaclaw_agent_status({ agent })`
- `bajaclaw_skill_list({ profile })`

Run the server manually:

```
bajaclaw mcp serve --stdio            # for a client that expects stdio
bajaclaw mcp serve --port 8765        # HTTP/SSE on a port
bajaclaw mcp register                 # (re)register with Claude Desktop
```

**Consume.** BajaClaw uses its own MCP config by default. Claude Desktop's `mcpServers` list is **not** inherited unless opted in.

Merge order per cycle (highest wins):

1. `<profile>/agent-mcp-config.json`
2. `<profile>/mcp-config.json`
3. `~/.bajaclaw/mcp-config.json` (user-global BajaClaw)
4. Desktop config (only if `"mergeDesktopMcp": true` in the profile)

Port servers from Claude Code on demand:

```
bajaclaw mcp port --list              # show what Claude Code has
bajaclaw mcp port                     # copy every server into BajaClaw
bajaclaw mcp port --names fs git      # just these two
bajaclaw mcp port --force             # overwrite existing entries
bajaclaw mcp list                     # what BajaClaw sees
bajaclaw mcp add <name> --command <cmd>  # add one manually
bajaclaw mcp remove <name>
```

More: [docs/integration.md](docs/integration.md).

---

## OpenAI-compatible HTTP endpoint

`bajaclaw serve` exposes an OpenAI-shaped HTTP endpoint. Anything that speaks `POST /v1/chat/completions` works unmodified.

```
bajaclaw serve                                      # 127.0.0.1:8765, no auth
bajaclaw serve --api-key $(openssl rand -hex 32)    # with bearer auth
bajaclaw serve --host 0.0.0.0 --api-key <key>       # bind all interfaces (auth required)
```

Each request is a full cycle: memory recall, skill matching, MCP inheritance, backend call, post-cycle extraction. The `model` field in the request is the BajaClaw profile name.

```bash
curl http://localhost:8765/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "default",
    "messages": [{"role": "user", "content": "what is on my plate today"}]
  }'
```

```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:8765/v1", api_key="any")
r = client.chat.completions.create(
    model="default",
    messages=[{"role": "user", "content": "hello"}],
)
print(r.choices[0].message.content)
```

Endpoints:

- `GET /health`
- `GET /v1/models`
- `POST /v1/chat/completions` (non-stream + SSE)
- `POST /v1/bajaclaw/cycle` (native full `CycleOutput`)
- `POST /v1/bajaclaw/tasks` (enqueue without waiting)

Non-localhost binds require `--api-key`. More: [docs/api.md](docs/api.md). Guided setup: `bajaclaw guide api`.

---

## Self-configuration via built-in guides

BajaClaw ships a set of built-in `SKILL.md` guides that describe how to set up each integration. When the matching trigger phrase fires, the agent sees the full procedure with Quick Reference / Procedure / Pitfalls / Verification sections, and walks through the configuration.

Ask the agent in plain language:

```
> help me set up Telegram
> walk me through connecting Discord
> switch to Opus for this profile
> turn on memory sync
> port all my Claude Code skills into BajaClaw
```

Print a guide directly from the CLI:

```
bajaclaw guide                   # list all built-in guides
bajaclaw guide telegram          # the telegram setup walkthrough
bajaclaw guide mcp-port          # the MCP port walkthrough
```

Available topics: `telegram`, `discord`, `heartbeat`, `daemon`, `dashboard`, `mcp-port`, `memory-sync`, `profile`, `self-update`, `uninstall`, `model`, `effort`, `tools`, `api`.

---

## Chat REPL

```
bajaclaw chat
```

Turn-by-turn conversation with the agent in the terminal. Per-turn metadata (model, tokens, cost, duration) appears under each response. History persists in-session.

Slash commands:

- `/help` - show all commands
- `/model [id]` - switch or show model
- `/effort [level]` - switch or show effort
- `/stats` - 5-hour and weekly usage
- `/compact` - manual memory compaction
- `/exit` - leave

More: [docs/chat.md](docs/chat.md).

---

## Safety and fair use

BajaClaw is a thin wrapper around the `claude` CLI. It never sees credentials, never calls the Anthropic API directly, and only uses documented CLI flags.

Built-in guards:

- **Circuit breaker.** 5 consecutive failed cycles open the breaker for 15 minutes.
- **Rate limiter.** 30 cycles/hour/profile by default.
- **Cycle serialization.** At most one `claude` subprocess per profile at a time (see [`src/concurrency.ts`](src/concurrency.ts)). HTTP API hits queue instead of spawning parallel processes.
- **Auto tier caps.** Haiku cycles get fewer memories, skills, and turns than Sonnet, and Sonnet fewer than Opus. Small tasks stay small.
- **Per-cycle USD cap.** `"maxBudgetUsd": 5.0` in `config.json` aborts the cycle cleanly if it would exceed the cap.
- **Per-cycle timeout.** `"cycleTimeoutMs": 600000` (default 10 min). Increase for long-running tasks.
- **Dry run.** `bajaclaw start --dry-run` prints the full prompt and argv without executing.
- **Dry install.** `bajaclaw uninstall` without `--yes` prints the teardown plan and changes nothing.
- **No shell string concat.** Every `execa` call uses an argv array with `shell: false`.
- **Skill install confirmation.** Skills require `BAJACLAW_CONFIRM=yes` in env; the full `SKILL.md` is printed before writing.
- **Env scrub on subprocess.** Claude Desktop's injected `CLAUDE_CODE_*` env vars are stripped when spawning the backend, so the daemon can't accidentally inherit a stale OAuth token.
- **No telemetry.** The only outbound call BajaClaw makes on its own behalf is the once-per-24h update check to the npm registry.

More: [docs/security.md](docs/security.md), [docs/fair-use.md](docs/fair-use.md).

---

## Setup, reset, uninstall

```
bajaclaw setup                        # idempotent bootstrap; safe to re-run
bajaclaw setup --interactive          # force the wizard even if persona is set
bajaclaw setup --profile foo          # use a different default profile name
bajaclaw uninstall                    # dry-run; prints the teardown plan
bajaclaw uninstall --yes              # actually tear everything down
bajaclaw uninstall --yes --keep-data  # remove integrations, keep ~/.bajaclaw/
```

`setup` is the repair button. If the MCP registration is missing, the agent descriptor is gone, or the home directory moved, rerunning `setup` fixes it without touching existing data.

`uninstall --yes` removes:

- Running daemons (via pid file)
- OS scheduler entries (launchd plist / systemd unit / crontab line / schtasks)
- `~/.claude/agents/<profile>/` directories for every profile
- The `bajaclaw` MCP entry from every desktop MCP config
- `~/.claude/memory/bajaclaw-*.md` sync files
- `~/.bajaclaw/` (unless `--keep-data`)

It does **not** `npm uninstall` itself. The final command to run by hand is printed at the end.

---

## On-disk layout

```
~/.bajaclaw/
├── profiles/
│   └── default/
│       ├── config.json              # model, effort, tools, channels, budgets, timeouts
│       ├── bajaclaw.db              # SQLite + FTS5 (memory, cycles, tasks, schedules)
│       ├── AGENT.md                 # operating guide (freely editable)
│       ├── SOUL.md                  # persona / voice / identity
│       ├── HEARTBEAT.md             # cron-syntax schedule entries
│       ├── skills/                  # profile-scoped skills
│       ├── logs/YYYY-MM-DD.jsonl    # 30-day rotation
│       ├── mcp-config.json          # profile-scoped MCP servers
│       ├── .mcp-merged.json         # regenerated each cycle
│       └── daemon.pid / daemon.log  # present when daemon is running
├── skills/                          # user-global skills
├── mcp-config.json                  # user-global MCP servers
└── .update-check.json               # 24h update-check cache
```

Every profile is self-contained. Remove its directory and that agent is gone. Back one up and it's portable to any machine.

---

## Command reference

Full detail in [docs/commands.md](docs/commands.md). Summary:

| command | purpose |
|---|---|
| `setup` | idempotent bootstrap; run anytime to repair integrations |
| `uninstall` | full teardown (or `--keep-data` to keep profiles) |
| `init <name>` | scaffold a new named profile |
| `chat [profile]` | interactive REPL |
| `start [profile]` | run one cycle |
| `dry-run [profile]` | print assembled prompt and argv, no exec |
| `status [profile]` | per-profile stats |
| `health [profile]` | breaker + rate limit + recent cycles |
| `doctor` | toolchain + backend verification |
| `dashboard [profile]` | serve dashboard HTML |
| `daemon` | `start`/`stop`/`status`/`logs`/`install`/`run`/`restart` |
| `mcp` | `list`/`add`/`remove`/`serve`/`register`/`port` |
| `skill` | `list`/`new`/`install`/`search`/`review`/`promote`/`port` |
| `profile` | `list`/`create`/`switch`/`delete` |
| `channel` | `add`/`remove`/`list` Telegram + Discord bridges |
| `trigger [profile] <event>` | enqueue a task |
| `model [id] [profile]` | show/set the model |
| `effort [level] [profile]` | show/set effort |
| `guide [topic]` | print a built-in setup walkthrough |
| `persona [profile]` | edit the persona wizard answers |
| `compact [profile]` | manual memory compaction |
| `serve` | OpenAI-compatible HTTP endpoint |
| `update` | check for / install a newer version |
| `banner` | print the ASCII banner |
| `welcome` | print the welcome + next steps |
| `say <text>` | send a progress update (used from inside cycles) |

### Environment variables

| var | effect |
|---|---|
| `BAJACLAW_PROFILE` | default profile when `[profile]` is omitted |
| `BAJACLAW_DEFAULT_PROFILE` | override the literal name `"default"` |
| `BAJACLAW_HOME` | override `~/.bajaclaw/` |
| `CLAUDE_HOME` | override `~/.claude/` |
| `BAJACLAW_DRY_RUN=1` | force every cycle to dry-run |
| `BAJACLAW_VERBOSE=1` | mirror log events to stdout |
| `BAJACLAW_CONFIRM=yes` | allow `skill install` to write |
| `BAJACLAW_NO_UPDATE_NOTICE=1` | silence the post-command update notice |
| `CLAWHUB_REGISTRY` | override the ClawHub registry URL |

---

## Updating

BajaClaw checks the npm registry at most once per 24 hours. When a newer version is published, a one-line notice appears after any command.

```
bajaclaw update --check          # print delta, don't install
bajaclaw update --yes            # install immediately
```

On a global npm install, update runs `npm install -g bajaclaw@latest`. On a git clone, it runs `git pull && npm install && npm run build`. Silence the notice with `BAJACLAW_NO_UPDATE_NOTICE=1`.

---

## Docs

- [Architecture](docs/architecture.md) - module map, cycle, on-disk layout
- [Commands](docs/commands.md) - full command reference
- [Agents and profiles](docs/agents.md) - `AGENT.md`, `SOUL.md`, `HEARTBEAT.md`, templates
- [Chat REPL](docs/chat.md)
- [Skills](docs/skills.md) - scoping, matching, foreign formats, auto-generation
- [Memory](docs/memory.md) - FTS5 recall, post-cycle extract, Claude Code sync
- [Compaction](docs/compaction.md)
- [Heartbeat and scheduling](docs/heartbeat.md)
- [Channels (Telegram + Discord)](docs/channels.md)
- [HTTP API](docs/api.md) - OpenAI-compatible endpoint + native routes
- [Subagents](docs/subagents.md)
- [Integration with Claude Code](docs/integration.md) - MCP seams in detail
- [Security](docs/security.md) - threat model + mitigations
- [Fair use](docs/fair-use.md) - how BajaClaw stays a thin wrapper
- [Troubleshooting](docs/troubleshooting.md)
- [FAQ](docs/faq.md)
- [Contributing](docs/contributing.md) - dev setup, style, release

---

## License

MIT. No company attribution. Users own what their agents produce.
