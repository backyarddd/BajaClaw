# BajaClaw

```
 ██████╗  █████╗      ██╗ █████╗      ██████╗██╗      █████╗ ██╗    ██╗
 ██╔══██╗██╔══██╗     ██║██╔══██╗    ██╔════╝██║     ██╔══██╗██║    ██║
 ██████╔╝███████║     ██║███████║    ██║     ██║     ███████║██║ █╗ ██║
 ██╔══██╗██╔══██║██   ██║██╔══██║    ██║     ██║     ██╔══██║██║███╗██║
 ██████╔╝██║  ██║╚█████╔╝██║  ██║    ╚██████╗███████╗██║  ██║╚███╔███╔╝
 ╚═════╝ ╚═╝  ╚═╝ ╚════╝ ╚═╝  ╚═╝     ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝
          autonomous agents on your terms  ·  MIT  ·  v0.13.2
```

**BajaClaw is a long-running agent runtime for the `claude` CLI.** It turns
the one-shot `claude -p` command into an always-on, scheduled, memory-backed,
skill-matching autonomous agent — with a local dashboard, multiple profiles,
OS-native scheduling, and first-class MCP integration.

You install it once. It sets itself up. You run `bajaclaw start`. It goes.

---

## Install

```
npm install -g bajaclaw
```

That's it. The post-install runs `bajaclaw setup` automatically, which:

- Creates the default profile at `~/.bajaclaw/profiles/default/`
- Writes the matching agent descriptor at `~/.claude/agents/default/default.md`
- Registers BajaClaw as an MCP server in your desktop MCP config
- Runs the health check and tells you if anything's off

**Requirements**: Node 20+ and the `claude` CLI backend on your `PATH`.
BajaClaw drives the backend as a subprocess — whatever login/subscription
that CLI uses is what BajaClaw uses. BajaClaw itself never sees credentials.

First run, end-to-end:

```
npm install -g bajaclaw       # installs + auto-setup
bajaclaw chat                 # interactive REPL (new in v0.11)
bajaclaw start                # or run one scheduled cycle
```

`bajaclaw chat` drops you into a turn-by-turn conversation with your
agent. Shows model / effort / context / 5h & weekly usage in the
header; per-turn status line reports tokens, cost, duration. Slash
commands: `/help`, `/model`, `/effort`, `/stats`, `/compact`, `/exit`.
See [docs/chat.md](docs/chat.md).

> Prefer to track the bleeding edge? `npm install -g github:backyarddd/BajaClaw`
> installs straight from main (runs the `prepare` script to build `dist/`).

No profile name to pick. No config to fill in. No decisions to make.

---

## What it actually does

A BajaClaw **cycle** is one pass of the 13-step loop in
[`src/agent.ts`](src/agent.ts):

1. Load the profile config
2. Open the SQLite DB and apply migrations
3. Check the circuit breaker + rate limiter
4. Pop a task from the queue (or generate a heartbeat prompt if empty)
5. Full-text recall the top 10 relevant memories
6. Load `AGENT.md`, `SOUL.md`, `HEARTBEAT.md`
7. Score all available skills against the task; inject the top 3
8. Merge the MCP config (desktop + profile + agent)
9. Assemble the final system prompt
10. Exec `claude -p` with `--model`, `--max-turns`, `--allowedTools`,
    `--disallowedTools`, `--mcp-config`, `--output-format json`
11. Parse the JSON response; persist the cycle row
12. Post-cycle Haiku call extracts 0-5 durable memories into the FTS table
13. Dispatch follow-ups (channel replies, queued tasks, reflection cycle)

You can run a cycle manually (`bajaclaw start`), schedule it (`bajaclaw
daemon install`), or trigger it externally (`bajaclaw trigger <event>`).
Cycles are idempotent — safe to re-run.

---

## Integration with the Claude ecosystem

BajaClaw is designed to slot *into* your existing Claude Code setup, not
replace it. Everything you've already configured for `claude` is inherited
for free.

### Claude Code agent descriptors

Every BajaClaw profile writes a standard agent frontmatter file to
`~/.claude/agents/<profile>/<name>.md`. That means the moment you run
`bajaclaw setup`, a new `@default` agent appears inside Claude Code itself.
You can invoke it from a Claude Code session the same way you invoke any
other agent. The BajaClaw profile is the durable side; the Claude Code
descriptor is the handle.

### Claude Code skills — compatible format, **isolated scope**

A BajaClaw skill is a `SKILL.md` file with YAML frontmatter — byte-for-byte
the same shape Claude Code uses. But BajaClaw reads only BajaClaw-owned
directories:

| priority | path |
|---|---|
| 1 | `<agent-dir>/skills/` |
| 2 | `~/.bajaclaw/profiles/<name>/skills/` |
| 3 | `~/.bajaclaw/skills/` |
| 4 | `<repo>/skills/` (built-ins) |

`~/.claude/skills/` is **not** read automatically — that keeps the two
agents from stepping on each other's skill libraries.

**Porting skills from Claude Code is a one-liner:**

```
bajaclaw skill port                     # copy all from ~/.claude/skills
bajaclaw skill port --names my-skill    # just one
bajaclaw skill port --link              # symlink (live sync from Claude Code)
bajaclaw skill port --scope profile --profile default
```

When BajaClaw matches skills for a cycle, scoring is:
- Trigger phrase hit: +5
- Name token hit: +2
- Description token hit: +1

Top 3 (where score > 0) are injected into the system prompt as `# Active
Skills`. See [`docs/skills.md`](docs/skills.md).

### Self-knowledge (built-in guides)

BajaClaw knows how to configure itself. Ship 13 built-in skills describe
the procedure for every integration — ask your agent in plain language:

> "Help me set up Telegram."
> "Walk me through connecting Discord."
> "Switch to Opus for this profile."
> "Turn on memory sync."

The matching skill (`setup-telegram`, `setup-discord`, `configure-model`,
`setup-memory-sync`, …) fires, the agent sees the full procedure with
Quick Reference / Procedure / Pitfalls / Verification sections, and walks
you through it (running the right `bajaclaw` subcommands via Bash when
useful).

Run them directly from the CLI too:

```
bajaclaw guide                    # list all guides
bajaclaw guide telegram           # print the telegram setup walkthrough
bajaclaw guide mcp-port           # print the MCP port walkthrough
```

Built-in guides cover: `telegram`, `discord`, `heartbeat`, `daemon`,
`dashboard`, `mcp-port`, `memory-sync`, `profile`, `self-update`,
`uninstall`, `model`, `effort`, `tools`.

### Auto-generated skills

After any cycle that uses 5+ tools (configurable), BajaClaw calls the
backend once more to decide whether the procedure is worth saving. If yes,
it writes a structured `SKILL.md` with When-to-use / Quick-reference /
Procedure / Pitfalls / Verification sections into
`~/.bajaclaw/skills/auto/<name>/` for review.

This is BajaClaw's take on the "create a skill after a complex task"
behavior from agents like Hermes — capture procedures the first time you
solve them so repeats are faster.

Candidates live in `auto/` until you promote them:

```
bajaclaw skill review              # print every candidate
bajaclaw skill promote <name>      # move candidate into user scope
```

Tune the trigger in the profile's `config.json`:

```json
{ "autoSkill": { "enabled": true, "minToolUses": 5, "maxPerDay": 10 } }
```

### MCP — isolated by default

BajaClaw uses its own MCP config. The desktop CLI's `mcpServers` is **not**
inherited by default. Merge order per cycle (highest wins):

1. `<profile>/agent-mcp-config.json`
2. `<profile>/mcp-config.json`
3. `~/.bajaclaw/mcp-config.json` (user-global BajaClaw)
4. Desktop CLI config — **only if `mergeDesktopMcp: true`** in the profile

Port servers from Claude Code on demand:

```
bajaclaw mcp port --list            # show what Claude Code has
bajaclaw mcp port                   # copy every server into BajaClaw
bajaclaw mcp port --names fs git    # just these two
bajaclaw mcp port --force           # overwrite existing BajaClaw entries
```

Or set `"mergeDesktopMcp": true` in a profile's config to inherit the
desktop MCP list on every cycle (pre-0.4 behavior).

BajaClaw's own MCP entry (`bajaclaw`) is skipped automatically during port
to avoid self-references.

### MCP — expose

BajaClaw is itself an MCP server. `bajaclaw setup` auto-registers it so your
desktop MCP client (Claude Desktop and anything else that reads that config)
can query BajaClaw's state directly.

**Resources:**

- `bajaclaw://profiles` — list of profiles
- `bajaclaw://profile/<n>/agents`
- `bajaclaw://profile/<n>/memories` — FTS5-searchable
- `bajaclaw://profile/<n>/cycles` — recent cycle history
- `bajaclaw://profile/<n>/schedules`

**Tools:**

- `bajaclaw_memory_search({ query, limit, profile })`
- `bajaclaw_task_create({ agent, task, priority })`
- `bajaclaw_agent_status({ agent })`
- `bajaclaw_skill_list({ profile })`

Which means: from any MCP client, you can ask "what does BajaClaw remember
about X?" or "queue a task for the default agent" — without leaving your
current session.

Run it manually with `bajaclaw mcp serve --stdio` or as HTTP SSE with
`bajaclaw mcp serve --port 8765`.

### Claude Code memory sync

Set `memorySync: true` in the profile config and BajaClaw will:

- Ingest new/modified files in `~/.claude/memory/` into its FTS table before
  each cycle
- Write a digest to `~/.claude/memory/bajaclaw-<profile>.md` after each
  cycle, so Claude Code sessions can see what BajaClaw has been learning

Disabled by default — memory sharing is deliberate, not automatic. See
[`docs/memory.md`](docs/memory.md).

### Sub-agent delegation

For heavy coding work, an agent using the `code` template plans and then
delegates to a dedicated Claude Code sub-session via `delegateCoding` in
[`src/delegation.ts`](src/delegation.ts). The orchestrator never writes code
itself — that keeps its transcript reviewable before any code exists. See
[`docs/integration.md`](docs/integration.md).

---

## First-run

```
bajaclaw start                 # runs a cycle against the default profile
bajaclaw start --dry-run       # shows the assembled prompt + exact argv
bajaclaw dashboard             # http://localhost:7337 — live cycle feed, memories
bajaclaw daemon install        # schedule a 15-minute heartbeat via your OS
bajaclaw daemon start          # supervisor loop with exponential backoff
```

The default profile has **full tool access** — Read, Write, Edit, Bash,
Grep, Glob, WebSearch, WebFetch, plus every MCP tool you've configured. It's
a real autonomous agent, not a sandboxed assistant.

To tighten it later, edit `~/.bajaclaw/profiles/default/config.json`:

```json
{
  "name": "default",
  "template": "custom",
  "model": "auto",
  "effort": "medium",
  "maxTurns": 10,
  "allowedTools": ["Read", "Write", "Edit", "Bash"],
  "disallowedTools": []
}
```

---

## Multiple agents (optional)

The default profile is enough for most people. If you want more:

```
bajaclaw init researcher --template research
bajaclaw init triage --template support
bajaclaw init coder --template code
```

Each gets its own DB, skills, schedule, logs. Switch between them with:

```
bajaclaw start researcher
BAJACLAW_PROFILE=triage bajaclaw daemon start
```

**Templates:**

| template | shape |
|---|---|
| `custom`   | blank slate, full tools — the default |
| `research` | research + synthesis + artifacts; full tools |
| `outreach` | email prospecting + drafting |
| `support`  | inbox triage + reply drafts |
| `social`   | content drafting + scheduling |
| `code`     | orchestrator; delegates to a coding sub-agent (read-only itself) |

---

## Auto model (default)

New profiles ship with `model: auto`. Before every cycle, BajaClaw
classifies the task and routes it to the cheapest capable model:

| tier | when it fires | context budget |
|---|---|---|
| **Haiku**  | triage, status checks, heartbeats, very short tasks | 3 memories, 1 skill, 4 turns |
| **Sonnet** | normal work, answers, summaries | 5 memories, 2 skills, 8 turns |
| **Opus**   | planning, coding, refactoring, deep research, reflection | 7 memories, 3 skills, 14 turns |

The classifier is a heuristic — zero extra backend calls for routing.
Post-cycle memory extract + auto-skill synthesis are **skipped**
entirely for Haiku cycles. This keeps cheap tasks cheap.

Override per profile:

```
bajaclaw model                     # show current + list
bajaclaw model auto                # (default) route per task
bajaclaw model claude-opus-4-7     # pin to a single model
```

## Use BajaClaw as an OpenAI-compatible HTTP endpoint

```
bajaclaw serve                                   # 127.0.0.1:8765, no auth
bajaclaw serve --api-key $(openssl rand -hex 32) # with auth
bajaclaw serve --host 0.0.0.0 --api-key <key>    # bind all (auth required)
```

Anything that speaks the OpenAI chat API — Cursor, Open WebUI, LibreChat,
`openai` SDKs, curl, LangChain, LlamaIndex — can drive BajaClaw as an LLM.
The request's `model` field is a profile name; each request is one full
cycle (memory recall, skill matching, MCP inheritance, backend call,
post-cycle extract).

```
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

Endpoints: `GET /health`, `GET /v1/models`, `POST /v1/chat/completions`
(non-stream + SSE), `POST /v1/bajaclaw/cycle` (native full `CycleOutput`),
`POST /v1/bajaclaw/tasks` (enqueue without waiting). Non-localhost binds
require `--api-key`. Full reference + client examples in
[`docs/api.md`](docs/api.md). Guided setup: `bajaclaw guide api`.

---

## Auto-update

BajaClaw checks the npm registry at most once per 24h. When a newer version
is published, a one-line notice appears after any command:

```
 ╭──────────────────────────────────────────────────────────────╮
 │  update available   0.3.0 → 0.4.0   ·   run: bajaclaw update │
 ╰──────────────────────────────────────────────────────────────╯
```

Commands:

```
bajaclaw update --check        # print delta, don't install
bajaclaw update --yes          # install immediately
```

On a global npm install, update runs `npm install -g bajaclaw@latest`.
On a git clone, it runs `git pull && npm install && npm run build`. Silence
the notice with `BAJACLAW_NO_UPDATE_NOTICE=1`.

---

## Setup / Reset / Uninstall

```
bajaclaw setup                 # idempotent bootstrap; safe to re-run
bajaclaw setup --profile foo   # use a different default profile name
bajaclaw uninstall             # dry-run — shows what would be removed
bajaclaw uninstall --yes       # actually tear everything down
bajaclaw uninstall --yes --keep-data  # remove integrations, keep ~/.bajaclaw/
```

`setup` is the re-run button. If the MCP registration gets knocked out of
the desktop config, or the agent descriptor is missing, or you moved your
home directory — `bajaclaw setup` fixes it all without touching existing
data.

`uninstall` tears down everything BajaClaw has created:

- Stops any running daemons (via pid file)
- Removes OS scheduler entries (launchd plist / systemd unit / crontab line
  / schtasks entry) for every profile
- Removes `~/.claude/agents/<profile>/` dirs for every profile
- Removes the `bajaclaw` MCP entry from every desktop MCP config it finds
- Removes `~/.claude/memory/bajaclaw-*.md` sync files
- Removes `~/.bajaclaw/` entirely (unless `--keep-data`)

It does **not** `npm uninstall` itself — that's one command you still run by
hand, printed at the end of the teardown.

---

## What's in `~/.bajaclaw/`

```
~/.bajaclaw/
├── profiles/
│   └── default/
│       ├── config.json                  # name, template, model, tools, channels
│       ├── bajaclaw.db                  # SQLite + FTS5
│       ├── AGENT.md                     # operating guide (edited freely)
│       ├── SOUL.md                      # identity / voice
│       ├── HEARTBEAT.md                 # `<cron> | <task>` schedule entries
│       ├── skills/                      # profile-scoped skills
│       ├── logs/YYYY-MM-DD.jsonl        # 30-day rotation
│       ├── mcp-config.json              # profile MCP additions
│       ├── .mcp-merged.json             # regenerated each cycle
│       └── daemon.pid / daemon.log      # when daemon is running
├── skills/                              # user-global skills
│   └── auto/                            # reflection-generated candidates
└── .update-check.json                   # 24h update-check cache
```

Every profile is self-contained. Delete one directory and that profile is
gone. Back one up and you can restore it anywhere.

---

## Memory

Every cycle queries an FTS5 virtual table over `memories.content` with the
current task's terms; the top 10 matches land in the prompt as `# Recalled
Memories`. After the cycle finishes, a 1-turn Haiku call reads the
(task, response) pair and emits up to 5 structured facts as JSON:

```json
{"memories": [
  {"kind": "decision", "content": "Use PostgreSQL 16 for the new service."},
  {"kind": "fact",     "content": "Alice owns the billing pipeline."}
]}
```

Those facts become FTS-indexed rows with `source=cycle` and
`source_cycle_id=<id>`. Next cycle, they're eligible for recall again.

Kinds are a soft taxonomy — BajaClaw doesn't enforce them: `fact`,
`decision`, `preference`, `todo`, `reference`, `claude-code`, `imported`.

Full detail: [`docs/memory.md`](docs/memory.md).

---

## Channels (optional)

BajaClaw ships optional adapters for **Telegram** and **Discord** bots.
They're `optionalDependencies` — not installed unless you use them.

```
bajaclaw channel add default telegram --token <BOT_TOKEN>
bajaclaw channel add default discord --token <BOT_TOKEN> --channel-id <ID>
```

Inbound messages (from an allowlist of sender IDs) are normalized into the
tasks queue. The next cycle picks them up. Outbound replies route back
through the same channel.

Details + allowlist config: [`docs/channels.md`](docs/channels.md).

Out of scope in v0.3: WhatsApp, Signal, iMessage, Slack, voice.

---

## Dashboard

```
bajaclaw dashboard
```

Single HTML file served at `http://localhost:7337` (port in `config.json`).
Dark theme, vanilla JS, Tailwind CDN. Live cycle feed, FTS-searchable
memory browser, schedule editor, inbox/tasks list. Reads directly from the
SQLite DB — no extra service.

---

## Safety + fair use

BajaClaw is a thin wrapper around the `claude` CLI. It never sees your
credentials, never calls the Anthropic API directly, and only uses
documented CLI flags. See [`docs/fair-use.md`](docs/fair-use.md) for
the full boundary story.

Built-in guards:

- **Circuit breaker**: 5 consecutive failed cycles open the breaker for 15
  minutes.
- **Rate limiter**: 30 cycles/hour/profile by default.
- **Cycle serialization**: at most one `claude` subprocess per profile at
  a time (see [`src/concurrency.ts`](src/concurrency.ts)). HTTP API hits
  queue instead of spawning parallel processes.
- **Auto tier caps**: Haiku cycles use fewer memories/skills/turns than
  Sonnet, and Sonnet less than Opus. Small tasks stay small.
- **Dry run**: `bajaclaw start --dry-run` prints the full prompt + exact
  argv without executing.
- **Dry install**: `bajaclaw uninstall` without `--yes` prints the plan and
  changes nothing.
- **No shell string concat**: every `execa` call uses an argv array with
  `shell: false`.
- **Skill install requires confirmation**: `BAJACLAW_CONFIRM=yes` in env,
  full SKILL.md printed before writing.
- **No telemetry**: the only outbound call BajaClaw makes on its own behalf
  is the once-per-24h update check to the npm registry.

See [`docs/security.md`](docs/security.md) and
[`docs/fair-use.md`](docs/fair-use.md).

---

## Command reference

Full detail in [`docs/commands.md`](docs/commands.md). Summary:

| command | purpose |
|---|---|
| `setup` | idempotent first-run bootstrap; run anytime to repair integrations |
| `uninstall` | full teardown (or `--keep-data` to keep your profiles) |
| `init <name>` | scaffold an additional named profile |
| `start [profile]` | run one cycle (auto-bootstraps default profile if missing) |
| `dry-run [profile]` | print the assembled prompt + argv, no exec |
| `status [profile]` | per-profile stats |
| `health [profile]` | breaker + rate-limit state |
| `doctor` | toolchain + backend verification |
| `dashboard [profile]` | serve dashboard HTML |
| `daemon` | supervisor loop (start/stop/status/logs/install/run/restart) |
| `mcp` | consume + expose (list/add/remove/serve/register/port) |
| `skill` | list/new/install/review/promote/port |
| `profile` | list/create/switch/delete |
| `channel` | add/remove/list telegram + discord bridges |
| `trigger [profile] <event>` | enqueue a task |
| `migrate [profile]` | import from a foreign profile dir |
| `model [id] [profile]` | show/set the model (lists known if no id) |
| `effort [level] [profile]` | show/set effort (low/medium/high) |
| `guide [topic]` | print a built-in setup walkthrough |
| `serve` | OpenAI-compatible HTTP endpoint |
| `update` | check for / install a newer version |
| `banner` | print the ASCII banner |

**Environment variables:**

| var | effect |
|---|---|
| `BAJACLAW_PROFILE` | default profile when `[profile]` is omitted |
| `BAJACLAW_DEFAULT_PROFILE` | override the "default" profile name |
| `BAJACLAW_HOME` | override `~/.bajaclaw/` |
| `CLAUDE_HOME` | override `~/.claude/` |
| `BAJACLAW_DRY_RUN=1` | force all cycles to dry-run |
| `BAJACLAW_VERBOSE=1` | mirror log events to stdout |
| `BAJACLAW_CONFIRM=yes` | allow `skill install` to write |
| `BAJACLAW_NO_UPDATE_NOTICE=1` | silence the post-command update notice |

---

## Architecture

```
 OS scheduler         ┌──────────────────┐
 (launchd /  ─────▶   │ agent cycle (13) │
  systemd /           │   runOnce → CLI  │
  cron /              └─────┬────────────┘
  schtasks)                 │
                            ▼
 ┌───────────┐    ┌──────────────┐    ┌────────────┐
 │ dashboard │ ◀──│ SQLite (WAL) │    │ claude CLI │
 │  (HTML)   │    │ + FTS5       │ ◀──│ subprocess │
 └───────────┘    └──────────────┘    │  --mcp     │
                                       └─────┬──────┘
 ┌───────────┐                               │
 │ desktop   │                         ┌─────▼──────┐
 │ MCP client│ ◀─── bajaclaw://  ◀──── │ MCP servers│
 └───────────┘      (resources +       │ (inherited)│
                    tools)             └────────────┘
```

Deeper in [`docs/architecture.md`](docs/architecture.md).

---

## Docs

- [`architecture.md`](docs/architecture.md) — module map, cycle, on-disk layout
- [`integration.md`](docs/integration.md) — Claude Code + MCP seams in detail
- [`commands.md`](docs/commands.md) — full command reference
- [`agents.md`](docs/agents.md) — profiles, templates, AGENT.md / SOUL.md / HEARTBEAT.md
- [`skills.md`](docs/skills.md) — scoping, matching, self-generated skills
- [`memory.md`](docs/memory.md) — FTS5 recall + extract, cross-tool sync
- [`heartbeat.md`](docs/heartbeat.md) — scheduling + supervisor
- [`channels.md`](docs/channels.md)
- [`api.md`](docs/api.md) — OpenAI-compatible HTTP endpoint — Telegram + Discord
- [`security.md`](docs/security.md) — threat model + mitigations
- [`fair-use.md`](docs/fair-use.md) — how BajaClaw stays a thin wrapper
- [`troubleshooting.md`](docs/troubleshooting.md) — common fixes
- [`faq.md`](docs/faq.md) — frequently asked
- [`contributing.md`](docs/contributing.md) — dev setup, style, release

---

## License

MIT. No company attribution. You own what your agent makes.
