# Changelog

## 0.11.1

**Chat REPL: stay-alive fix.** `bajaclaw chat` was exiting back to
the shell after a single turn instead of looping. Three issues, all
now fixed:

- `cli.ts` was calling `program.parseAsync(...)` without `await`,
  so Node's top-level ESM module completed synchronously. That let
  the runtime think it was done before the chat action had a chance
  to actually run a second loop iteration.
- The chat loop used `readline.question()` in a `while (true) {
  await rl.question(...) }` pattern. Under some terminal conditions
  the outer promise chain would resolve unexpectedly between turns.
  Switched to event-based readline (`rl.on('line', …)`) wrapped in
  a single outer Promise that only resolves on the `close` event.
  The REPL now stays alive until you type `/exit` or hit Ctrl-D.
- Replaced the `ora` spinner with a simple interval-based dots
  animation. ora could leave terminal state inconsistent with
  readline in edge cases.

Also removed the custom `SIGINT` handler — Ctrl-C now exits cleanly
via the default behavior. Use `/exit` for a graceful session end
with the stats summary.

## 0.11.0

**`bajaclaw chat` — interactive REPL.** Drops you into a turn-by-turn
conversation with the agent. Each user message runs one BajaClaw
cycle; the last 10 turns are injected into the next prompt's `# Recent
Chat` section so the agent remembers the conversation within the
session. Post-cycle extraction still writes durable facts to the
memory DB for persistence across sessions.

Launch with `bajaclaw chat` or `bajaclaw chat <profile>`. Optional
`--model auto|haiku|sonnet|opus|<full-id>` overrides the model for
the session only (doesn't write to `config.json`).

**Status header** on session start:

```
╭─ BajaClaw chat · default · v0.11.0 ─────────────────────────╮
  agent      <persona name>
  model      auto (routes haiku/sonnet/opus per task)
  effort     medium
  context    200k tokens · 8-turn cap

  5h usage   3 cycles · 1.2k tokens · $0.012
  week       28 cycles · 18k tokens · $0.142
  (advisory counts from your local cycle log)

  /help for commands · /exit or Ctrl-D to quit
╰──────────────────────────────────────────────────────────────╯
```

**Per-turn status line** after every response:

```
· sonnet · medium · 1.2k in / 456 out · 3.2s · $0.003 · #42 ·
```

Fields: actual model used (auto-resolved), effort, input/output
tokens, wall-clock duration, cost, cycle id.

**Slash commands**:

| command | purpose |
|---|---|
| `/help` | list commands |
| `/exit` / `/quit` / `/q` | end session (or Ctrl-D) |
| `/clear` | clear session history (durable memory untouched) |
| `/stats` | session totals + 5h / 24h / 7d usage |
| `/context` or `/ctx` | context window + per-cycle budget |
| `/model [id\|alias]` | set session model (no config write) |
| `/effort [low\|medium\|high]` | set effort (persists) |
| `/compact` | run memory compaction now |
| `/history` | dump this session's turns |

**5h / weekly rate-limit usage** is tracked locally from the `cycles`
table. BajaClaw can't see Anthropic's server-side subscription
accounting — the displayed numbers are your local cycle counts and
token totals, which you can compare to your plan on anthropic.com.

**Underlying agent API changes** (useful if you embed `runCycle`):

- `CycleInput.sessionHistory?: ChatTurn[]` — prior turns, injected as
  `# Recent Chat`.
- `CycleOutput.inputTokens`, `outputTokens`, `turns`, `model`, `tier`
  are now populated from the backend JSON response.

New docs: `docs/chat.md`, updated `docs/commands.md`.

## 0.10.3

**Two install-time fixes.**

- **Cycle crash: `Warning: no stdin data received in 3s`**. The
  `claude` CLI backend expects stdin to be closed when invoked with
  `-p "<prompt>"`; otherwise it waits 3 seconds for piped input and
  writes a warning to stdout that contaminates the JSON output.
  BajaClaw now passes `stdin: "ignore"` to execa so the subprocess
  sees EOF immediately.
- **First-run welcome silently consumed by postinstall**. npm v7+
  captures postinstall stdout, so the welcome printed to the void and
  then marked done — meaning the user's first real `bajaclaw`
  invocation saw no welcome either. Now gated on `process.stdout.isTTY`
  so a non-TTY run (postinstall, pipes, CI) is a true no-op and
  doesn't touch the marker file. The welcome fires on the first
  interactive invocation.

If you were on 0.10.2 and never saw the welcome, delete
`~/.bajaclaw/.first-run-done` (or just run `bajaclaw welcome`) to
re-display it.

## 0.10.2

**Install UX: visible welcome, dep health check.**

npm v7+ captures postinstall stdout by default (`foreground-scripts:
false`), which is why `npm install -g bajaclaw` looked silent even
though the setup wizard was running. Fixed by:

- **Postinstall is now quiet and fast** — scaffolds the default
  profile silently (no wizard mid-install, which could hang), then
  emits a single-line notice to **stderr** (stderr survives npm's
  capture on most configs):

  ```
  ✓ BajaClaw v0.10.2 installed. Run `bajaclaw` to finish setup.
  ```

- **Dep health check**: verifies the `better-sqlite3` native binding
  loaded, and checks whether the `claude` CLI backend is on PATH.
  If either is missing, prints a clear warning with the fix command.

- **First-run welcome on the first `bajaclaw` invocation**. Shows
  the ASCII banner, backend status, first-time-setup commands, and
  common next steps. Marked via `~/.bajaclaw/.first-run-done` so it
  fires exactly once. Skipped for `--version`, `--help`, `uninstall`,
  `update`, `banner`, `welcome`.

- **`bajaclaw welcome`** — new command. Re-display the banner and
  next-steps list anytime.

- **Sudo safety**: postinstall under `sudo` without `SUDO_USER` no
  longer creates a root-owned `~/.bajaclaw`. Prints a notice asking
  the user to run `bajaclaw setup` as themselves instead.

## 0.10.1

**Published to npm.** BajaClaw is now on the npm registry as
[`bajaclaw`](https://www.npmjs.com/package/bajaclaw). Install is
canonical again:

```
npm install -g bajaclaw
```

- README, install scripts, docs, and the `setup-self-update` skill
  flipped back to the registry name.
- `bajaclaw update` reinstalls via `npm install -g bajaclaw@latest`.
  Forks can pin to a git spec via `bajaclaw.installSpec` in
  `package.json` (e.g. `"github:myuser/BajaClaw"`).
- The github-slug install path (`npm install -g
  github:backyarddd/BajaClaw`) still works for bleeding-edge / HEAD
  tracking — the `prepare` script added in 0.10.0 means git installs
  build `dist/` on the way in.

No behavior changes to the runtime — this release is install metadata
only. See 0.10.0 for the memory-compaction feature.

## 0.10.0

**Install flow groundwork for publishing.**

- Added `prepare: npm run build` so git installs build `dist/` before
  packing.
- Added `files` list in `package.json` so the packed tarball includes
  `bin/`, `dist/`, `scripts/`, `skills/`, and `templates/` (and
  excludes `src/`, `tests/`, `docs/`).

**Memory compaction — so the agent keeps learning without slowing
down over time.** BajaClaw's cycles are stateless (each one rebuilds
the prompt from scratch), so the model's context window never "fills
up" across cycles. What grows unbounded is the memory database.
Compaction = memory hygiene: summarize older rows into denser ones,
prune stale cycle log rows, VACUUM the SQLite file.

- **Two triggers, both on by default**:
  - **Threshold**: memory pool > 75% of a 200k-token reference window
    (configurable 0.1–0.99).
  - **Daily**: first cycle after a configurable UTC time (default
    `00:00`).
- **Pre-cycle check is ~free**: a single `COUNT/SUM(LENGTH)` on the
  memories table. Heavy work only runs if a trigger fires.
- **What it does**: per kind (fact/decision/preference/todo/reference),
  keep the newest 25 verbatim; batch the rest in groups of 40; ask
  Haiku to collapse each batch into one or two dense sentences that
  preserve load-bearing facts; replace originals with the summary.
  Then prune cycle-log rows older than 30 days and VACUUM.
- **New command `bajaclaw compact [profile]`**:
  `--dry-run` / `--force` / `--schedule` / `--threshold` /
  `--daily-at` / `--keep` / `--prune-days` / `--enable` / `--disable`.
- **Setup wizard**: the interactive `bajaclaw setup` now asks about
  compaction after the persona step. Choices: both / threshold / daily
  / off. Non-interactive installs get the default "both" policy.
- **New config block** under `compaction` in `config.json`. Every
  field has a safe default; partial overrides merge with defaults.
- **New built-in skill** `setup-compaction` (shows up in `bajaclaw
  guide compaction`). New doc `docs/compaction.md`. Memory doc
  (`docs/memory.md`) and command reference (`docs/commands.md`)
  updated.
- **Skipped on dry-run cycles**: `bajaclaw start --dry-run` never
  fires compaction, so dry runs remain zero-cost.

Ten new tests in `tests/compaction.test.js` covering
`shouldCompact` trigger math (disabled / off / threshold over / under
/ daily-with-recent), `mergeCompactionDefaults`, `evaluateThreshold`,
and `DEFAULT_COMPACTION`.

## 0.9.0

**Interactive persona wizard**. First TTY `bajaclaw setup` now asks for
the agent's name, what it should call you, tone
(concise/casual/friendly/formal/playful/terse), timezone, focus,
topics of interest, and hard "don't" rules. Answers write to
`persona.json` and render into `SOUL.md` as the identity block injected
into every cycle. Re-run any time with `bajaclaw persona --edit`.
Non-interactive installs (postinstall, `--silent`, pipes) ship defaults.

**Sub-agent system**: orchestrator + scoped helpers with physical
permission isolation.

- New fields: `parent` on child, `subAgents` on orchestrator.
- `bajaclaw subagent create <name> --parent <main>` scaffolds a scoped
  profile with its own template, tools, MCP config, memory, persona.
- `bajaclaw subagent list [parent]` prints the tree.
- `bajaclaw delegate <subagent> "<task>"` runs one cycle and streams
  the response text (or `--json` for full `CycleOutput`).
- New built-in skills: `delegate-to-subagent` (orchestrator routing
  rules), `setup-subagent` (guided walkthrough).
- Permission isolation is physical: the orchestrator literally cannot
  use a tool/MCP server it doesn't have; it must delegate.
- New doc: `docs/subagents.md`.

**HTTP API — precise model routing**. The `model` field in
`/v1/chat/completions` now supports overrides:

- `"default"` → profile's configured model (auto-routes if `auto`)
- `"default:claude-opus-4-7"` → force Opus for this request only
- `"auto"` / `"claude-opus-4-7"` → shortcut: default profile + that model

Overrides never mutate profile config. `/v1/models` now lists virtual
entries per profile × known model so OpenAI clients get a menu.
Documented in `docs/api.md`. Seven new tests.

## 0.8.0

**Renamed npm package**: `create-bajaclaw` → `bajaclaw`. Installs are
now `npm install -g bajaclaw`. The `create-bajaclaw` bin alias still
ships inside the package for back-compat if you type the old name out
of habit. Uninstall text, install scripts, update flow, docs, and
guides all updated.

**Bumped default model IDs** to the current tier:

- Opus: `claude-opus-4-5` → `claude-opus-4-7`
- Sonnet: `claude-sonnet-4-5` → `claude-sonnet-4-6`
- Haiku: `claude-haiku-4-5` (unchanged — still the newest Haiku)

`bajaclaw model` lists the new ids. `model: auto` (the default) routes
to these. Internal sub-calls updated:

- Sub-agent delegation (`src/delegation.ts`): Opus 4.7
- Reflection cycle (`src/self-improve.ts`): Opus 4.7
- Auto-skill synthesis (`src/skills/auto-skiller.ts`): Sonnet 4.6
- Post-cycle memory extract: Haiku 4.5 (unchanged)

`init` and `setup` CLI `--model` default: `auto`. The `--model` help
string now shows the new ids.

Existing profiles' explicit model settings are not rewritten on upgrade
— their `config.json` still points to whatever you set. Run
`bajaclaw model <new-id>` to bump.

## 0.7.0

**`model: auto` is the new default.** Before every cycle, a heuristic
classifier in `src/model-picker.ts` routes the task to a tier:

- Haiku — triage, status checks, heartbeats, very short tasks
- Sonnet — normal work (default fallback)
- Opus — planning, coding, refactoring, deep research, reflection

Zero extra backend calls — routing is pure heuristics.

**Token economy pass**, every cycle trimmed for cost:

- Context is now tiered per picked model: Haiku 3 memories + 1 skill +
  4 turns; Sonnet 5 + 2 + 8; Opus 7 + 3 + 14.
- Memory recall caps each memory at the tier's char budget (180/220/280)
  and dedupes near-duplicates.
- Only the heartbeat task injects `HEARTBEAT.md`; other cycles skip it.
- Post-cycle memory extractor shrinks the task slice (2000 → 800) and
  response slice (6000 → 2000); caps output at 3 facts (was 5).
- Auto-skill synthesizer shrinks task (4000 → 1500) and response slice
  (8000 → 3000), raises the default tool-use threshold (5 → 6), lowers
  the daily cap (10 → 5).
- Haiku-tier cycles skip post-cycle memory extract + auto-skill synth
  entirely. Cheap tasks stay cheap.
- Default `maxTurns` dropped from 20 to 10; tier budget can lower it
  further.
- Default rate limit dropped from 60/hr to 30/hr.
- Daemon poll interval raised from 30s to 60s.

**Cycle serialization.** `src/concurrency.ts` adds an in-process
per-profile queue. The HTTP API can no longer spawn parallel `claude`
subprocesses — two simultaneous requests for the same profile are
processed in order.

**Wrapper story documented.** New `docs/fair-use.md` spells out exactly
what BajaClaw does and doesn't do at the backend boundary: documented
flags only, no direct Anthropic API calls, no credential handling,
execa with `shell: false`, rate limiter + circuit breaker +
serialization as built-in backoff. Linked from `README.md` and
`docs/security.md`.

**`bajaclaw model` lists `auto` as an option** and tells you what each
tier is for. Setting `auto` prints a hint about the routing.

## 0.6.0

- **OpenAI-compatible HTTP endpoint**: `bajaclaw serve` exposes every
  BajaClaw profile behind an OpenAI-style `/v1/chat/completions` API.
  Anything that speaks the OpenAI chat API — Cursor, Open WebUI, the
  `openai` SDKs, curl, LangChain, LlamaIndex — can drive BajaClaw as if
  it were an LLM. Each request runs a full cycle (memory recall, skill
  matching, MCP inheritance, backend call, post-cycle extract).
- Endpoints:
  - `GET /health`
  - `GET /v1/models` — lists exposed profiles as OpenAI model entries
  - `POST /v1/chat/completions` — non-streaming and SSE streaming
  - `POST /v1/bajaclaw/cycle` — native full `CycleOutput`
  - `POST /v1/bajaclaw/tasks` — enqueue without waiting
- Auth: optional bearer token via `--api-key` or `api.apiKey` in
  `~/.bajaclaw/api.json`. Non-localhost binds without a key are refused.
- Model name maps to a profile (`"model": "default"` or
  `"model": "bajaclaw:default"`). Multi-message histories render as a
  prior transcript; the last message is the current task.
- CORS headers on every response; `OPTIONS` preflight handled.
- New built-in guide skill `setup-api` — ask your agent "help me set up
  the API" and it walks you through the whole flow.
- New docs: `docs/api.md` with full endpoint reference and client
  examples (Python SDK, Node SDK, curl streaming, Cursor/Open WebUI).

## 0.5.0

- **Self-knowledge skills**: BajaClaw now ships 13 built-in skills that
  document how to configure BajaClaw itself. Ask your agent "help me
  setup telegram" (or discord, heartbeat, daemon, dashboard, memory sync,
  etc.) and the matching skill fires — the agent knows the procedure
  without you writing one.
  - `setup-telegram`, `setup-discord`, `setup-heartbeat`, `setup-daemon`,
    `setup-dashboard`, `setup-mcp-port`, `setup-memory-sync`,
    `setup-profile`, `setup-self-update`, `setup-uninstall`
  - `configure-model`, `configure-effort`, `configure-tools`
- **`bajaclaw model [id] [profile]`**: show current model + known list
  (`claude-opus-4-5`, `claude-sonnet-4-5`, `claude-haiku-4-5`) with no
  args; set the model for a profile with an id. Any string is accepted
  — the backend validates against the subscription.
- **`bajaclaw effort [level] [profile]`**: show or set effort level
  (`low` / `medium` / `high`) per profile. Defaults to `medium`.
- **`bajaclaw guide [topic]`**: print a self-setup walkthrough or list
  all available guides. Lists any skill whose name starts with `setup-`
  or `configure-`.
- README + docs updated to surface these new commands and the
  self-knowledge pattern.

## 0.4.0

- **Skill isolation**: BajaClaw no longer reads `~/.claude/skills/` or
  `.claude/skills/` automatically. Skill scopes are now BajaClaw-only
  (agent, profile, user-global, built-in). Prevents cross-tool skill
  collisions.
- **MCP isolation**: BajaClaw no longer auto-merges the desktop CLI's
  MCP config on every cycle. It uses `~/.bajaclaw/mcp-config.json` instead.
  Opt back in with `"mergeDesktopMcp": true` in a profile's config.json.
- **`bajaclaw skill port`**: copy or symlink skills from `~/.claude/skills/`
  (or any source) into BajaClaw's scope. Per-skill or all-at-once, into
  user / profile / agent scope.
- **`bajaclaw mcp port`**: copy MCP servers from the desktop CLI config
  into `~/.bajaclaw/mcp-config.json`. BajaClaw's own entry is skipped.
- **Auto-skill synthesis**: after any cycle that uses 5+ tools (configurable),
  BajaClaw analyzes the task + tool sequence + response and — if the
  procedure is reusable — writes a structured `SKILL.md` with When-to-use /
  Quick-reference / Procedure / Pitfalls / Verification sections to
  `~/.bajaclaw/skills/auto/<name>/`. Frontmatter is marked
  `auto_generated: true` with a `source_cycle_id`. Configure via
  `autoSkill` in profile config.
- **`bajaclaw skill promote <name>`**: move an auto-generated candidate
  from `~/.bajaclaw/skills/auto/<name>/` into `~/.bajaclaw/skills/<name>/`.
- Docs: expanded `docs/skills.md` and `docs/integration.md` to cover the
  new isolation model, port commands, and auto-skill workflow.

## 0.3.0

- **Packaged install**: `npm install -g create-bajaclaw` auto-runs `bajaclaw
  setup` (via `postinstall` hook) to create the default profile, write the
  agent descriptor, and register the MCP server. No profile name to pick.
- **`bajaclaw setup`**: idempotent bootstrap. Safe to rerun at any time to
  repair integrations (MCP registration, agent descriptor) without touching
  existing data.
- **`bajaclaw uninstall`**: full teardown. Stops daemons, removes OS
  scheduler entries, removes agent descriptors, removes the MCP registration,
  removes memory sync files, and (unless `--keep-data`) removes `~/.bajaclaw/`.
  Requires `--yes` to actually apply.
- **Default profile**: `bajaclaw start` with no arguments now targets the
  `default` profile, auto-bootstrapping it on first use if missing. Override
  with `BAJACLAW_DEFAULT_PROFILE`.
- **Full tool access**: the `research`, `outreach`, `support`, `social`, and
  `custom` templates now ship without tool restrictions — agents can Write,
  Edit, and run Bash. The `code` template keeps its orchestrator pattern
  (read-only, delegates to sub-agent). Existing profiles are unaffected.
- **README**: comprehensive rewrite covering what the cycle does, the full
  Claude Code integration (agent descriptors, shared skills scopes, MCP
  consume/expose, memory sync, sub-agent delegation), auto-update, setup /
  uninstall, on-disk layout, safety, and the full command reference.
- **`create-bajaclaw`**: with no arguments, runs `setup`. With a name,
  scaffolds a new named profile via `init`.

## 0.2.0

- Auto-update: `bajaclaw update` checks the npm registry (or a configured raw
  URL) and installs the newer version. A one-line notice appears after any
  command when an update is available.
- ASCII banner: shown in `bajaclaw doctor` and `bajaclaw banner`.
- Renamed `CLAUDE.md` → `AGENT.md` across templates. The cycle loader still
  falls back to `CLAUDE.md` for profiles created under 0.1.x.
- De-branded prose and code comments. The CLI backend is referred to by its
  binary name (`claude`) or as "the CLI backend"; no product-name references.
- New docs: `commands.md`, `troubleshooting.md`, `faq.md`, `security.md`,
  `contributing.md`. `claude-integration.md` renamed to `integration.md`.
- `delegateCoding` replaces `delegateToClaudeCode` (old name kept as alias).

## 0.1.0 — initial release

- 13-step cycle loop driving the `claude` CLI as a subprocess
- SQLite + FTS5 memory store with pre-cycle recall and post-cycle extract
- Cross-platform scheduler: launchd / systemd-user / crontab / schtasks
- MCP consumer: merges the desktop MCP config + profile + agent configs
- MCP server: resources for profiles/agents/memories/cycles/schedules, tools
  for memory search / task creation / agent status / skill list
- Skills system: six scopes, shared format with other agent tooling
- Two-way memory sync with `~/.claude/memory/` (opt-in)
- Sub-agent delegation helper for coding-heavy work
- Agent templates: outreach / research / support / social / code / custom
- Dashboard (single HTML, vanilla + Tailwind CDN)
- Channel adapters: Telegram + Discord (optional, opt-in)
- Profiles with per-profile DB, logs, skills, MCP config
- `bajaclaw migrate --from-yonderclaw <dir>` (strips unwanted artifacts)
