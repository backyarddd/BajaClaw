# Changelog

## 0.14.17

**Kill the duplicate-reply pattern: fold plan acknowledgment into
the main cycle instead of firing a separate haiku pass.**

### Fixes

1. **No more double messages on follow-up questions.** 0.14.14
   introduced a separate haiku "intake ack" call that ran before the
   main cycle and sent a short "got it" message to the chat. Two
   problems: (1) the haiku call did NOT receive session history, so
   on a follow-up like "which model did you use for bajaclaw's?" it
   would ask a clueless clarifying question ("which model for what
   part?") while the main sonnet reply right after had the actual
   contextual answer, and (2) every task produced two messages which
   felt like spam. Removed the separate backend call entirely.
2. **Plan ack now happens inside the main cycle.** The progress
   instructions block now tells the main agent (which has full
   session history, memories, skills, and the user's soul) that on
   genuinely multi-part tasks it should emit its plan ack via
   \`bajaclaw say\` as its first action - then do the work. For
   simple single-question tasks it skips the ack entirely and goes
   straight to the final reply. One cycle, one voice, one reply.
3. **Hard cap of 3 \`bajaclaw say\` calls per cycle** (including the
   plan ack). Zero is valid.

## 0.14.16

**Fix regression: 0.14.14/15's progress-chat block was making sonnet
cycles stop halfway through multi-part tasks.**

### Fixes

1. **Progress instructions now subordinate to the task.** Previous
   wording ("you're texting the person who asked you to do a thing,
   not narrating a build log") put the agent in chat mode. On a
   multi-step task like "add a model picker AND run the qwen tests
   and give me findings", it would do part 1, send a `bajaclaw say`
   update, then produce a final reply as if it were done - leaving
   half the task unfinished. The block is rewritten to lead with
   "CRITICAL: your job is to fully complete the task; the chat tool
   does not replace doing the work", caps pings at 3 per cycle,
   explicitly bans "announcing what you're about to do" ("on it!",
   "starting now"), and reinforces that the final reply must cover
   every part the user asked about.

## 0.14.15

**Channel feedback sounds like a person now.**

### Fixes

1. **Intake ack drops the "Heard: X. Plan: Y." template.** 0.14.14
   shipped with a rigid structured ack that felt robotic. The intake
   haiku call now receives the profile's SOUL.md as identity context
   and is prompted to reply the way the user would actually text
   back - one natural short message, same voice as the rest of the
   agent's chat replies. Bullet lists, section headings, and canned
   openers ("Sure!", "Got it!") are explicitly out.
2. **Progress pings read like chat messages, not status lines.** The
   `bajaclaw say` prompt block was rewritten to describe tone
   ("you're texting the person who asked you to do a thing, not
   narrating a build log") and drops the formulaic "Built X. Wiring
   Y now." examples. Past/present tense is no longer mandated; the
   agent matches its own voice.

## 0.14.14

**Live feedback on channel cycles. Agent confirms what it heard,
then keeps you posted while it works.**

### Features

1. **Intake ack on sonnet/opus channel cycles.** When a task lands
   from telegram or discord and routes to sonnet or opus, a fast
   haiku pass paraphrases the request and states a plan ("Heard: X.
   Plan: Y.") and sends it to the channel before the main cycle
   starts. User gets confirmation in ~1-2s instead of staring at a
   typing indicator wondering if anything is happening. Haiku tasks
   and heartbeats skip it (already fast) and dry runs skip it (no
   spending).
2. **Mid-flight progress via `bajaclaw say`.** New CLI command that
   POSTs a short update to the dashboard's `/api/progress` endpoint.
   The daemon's gateway forwards it to the originating channel
   without ending the typing indicator. For sonnet/opus channel
   cycles, a prompt block instructs the agent to call this between
   major phases ("Built the endpoint. Wiring it into the dashboard
   now.") and skip it on short tasks. Context passed via env vars
   (`BAJACLAW_PROFILE`, `BAJACLAW_SOURCE`, `BAJACLAW_DASHBOARD_PORT`)
   injected into the claude spawn, so the agent invokes it through
   its regular Bash tool - no MCP plumbing needed.
3. **`ClaudeOptions.env` passthrough.** Per-spawn env merging on top
   of the scrubbed inherit-env from 0.14.13, used by the progress
   plumbing above. Generalizes to any future per-cycle context that
   needs to reach the subprocess.

## 0.14.13

**Image + video attachments land in channel tasks. Auto-skills go live
immediately. Daemon stops inheriting Claude Desktop's OAuth token.**

### Fixes

1. **Desktop-managed env no longer poisons daemon subprocesses.**
   When `bajaclaw daemon start` ran from a shell spawned by the Claude
   Desktop app, the daemon inherited `CLAUDE_CODE_OAUTH_TOKEN`,
   `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST`, `CLAUDE_CODE_ENTRYPOINT`,
   `CLAUDE_CODE_EXECPATH`, `CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH`, and
   `CLAUDECODE`. Every `claude` subprocess the daemon spawned then
   used the Desktop-managed OAuth token instead of the user's on-disk
   credentials; once that token rotated, every cycle failed with
   `401 Invalid authentication credentials` while the user's terminal
   `claude` CLI still worked. `src/claude.ts` now scrubs those six
   vars in every `runOnce` / `runStream` spawn, and
   `src/commands/daemon.ts` scrubs them once when forking the detached
   daemon so they never enter its process tree.

### Features

2. **Channel image + video attachments.** Telegram and Discord
   adapters now download inline photos, image documents, videos,
   video notes, and video documents into a tmp path and append the
   local paths to the task. Videos are pre-processed with `ffmpeg` /
   `ffprobe` into 8 evenly spaced frames. The agent receives an
   `[Images attached - use the Read tool to view each file: ...]`
   block appended to the task body. Stored per-task in the new
   `tasks.attachments` column (JSON array, migration v2).
3. **Auto-skills are live on write.** `src/skills/auto-skiller.ts`
   used to drop candidates into `~/.bajaclaw/skills/auto/<name>/`
   gated behind a `bajaclaw skill review` + `skill promote` step.
   Now writes straight into the user skills dir so the matcher picks
   them up on the next cycle. Daily cap still honored; we detect
   auto-generated skills by the `auto_generated: true` frontmatter
   marker, which the loader surfaces on the `Skill` type.
4. **Proactive channel notifications.** `broadcastToProfile` sends a
   one-liner to the last active chat when the agent activates a
   matched auto-skill or writes a new one. Keeps the human in the
   loop on what the agent is learning without asking for anything.

## 0.14.12

Published to npm but never committed to git - contents are folded
into 0.14.13 above.

## 0.14.11

**Chat prompt lands on the right line. Welcome is slimmer. Cycle fails
are debuggable. Dashboard has a Logs view + clickable cycle drilldown.**

### Fixes

1. **Prompt sandwich scroll-safe.** 0.14.10 used CSI save/restore
   cursor (`\x1b[s`/`\x1b[u`). If the terminal scrolled at the moment
   the sandwich was drawn (common when welcome content pushes the
   first prompt near the bottom of the viewport), the saved row
   became stale and the cursor landed halfway up with the bottom
   rule far below. Swap to relative moves: `\x1b[1F` (previous-line
   col 0) + `\x1b[3C` (right 3 cols past " › "). Scroll doesn't
   invalidate relative positions.
2. **Skill inventory gone from welcome.** The two-column header
   (identity + skill list) was noisy and, when the viewport was
   narrow, forced the prompt to wrap awkwardly. Back to a single
   column: agent name, model, profile, effort, context, version,
   cwd, usage line. Skill inventory lives on the dashboard now.

### Features

3. **Detailed cycle-fail output in chat.** On `!r.ok` the chat now
   prints:
   - friendly summary (`formatCycleError`)
   - `haiku · 4.2s · $0.0012 · 2 turns · #42` meta line
   - `raw: <first line of error>` (up to 500 chars)
   - `drill: open http://localhost:7337/ → cycle #42`
4. **`/api/logs` endpoint.** `?lines=N&level=a,b` reads recent jsonl
   log entries from the profile's log dir. Merges across rolled
   files newest-first.
5. **`/api/cycles/:id` endpoint.** Returns the full cycle row plus
   the originating task row (if any). Powers the drill-down modal.
6. **Dashboard Logs view.** New sidebar entry. Table of 300 most-
   recent events: time, level badge, event name, detail bits. Level
   filter (all / info / warn+error / error).
7. **Clickable cycle rows.** Anywhere a cycle shows in the dashboard,
   click it to open a modal with: status badge, started/finished,
   model, cost, tokens, turns, full task, prompt preview, response
   preview, raw error text (if any), source task JSON (if any).

## 0.14.10

**Bottom rule actually renders now.** In 0.14.9 the bottom rule was
drawn separately after the prompt. On every keystroke readline's
`_refreshLine` calls `clearScreenDown`, which erased the bottom rule
between each character. So you saw top rule + prompt and nothing
below.

### Fix

Embed the bottom rule INSIDE the prompt string that `rl.question`
receives, wrapped in CSI save-cursor (`\x1b[s`) / CSI restore-cursor
(`\x1b[u`). Now every time readline rewrites the prompt (the initial
draw and every keystroke), it re-emits the escape sequence + bottom
rule. The restore pulls the visible cursor back to the prompt line so
typing lands in the right place.

CSI `\x1b[s`/`\x1b[u` were picked over DECSC/DECRC (`\x1b7`/`\x1b8`)
because Node's `stripVTControlCharacters` only understands the CSI
form. Without clean stripping, readline counts the escape bytes as
visible prompt width and mis-positions the cursor.

## 0.14.9

**Active prompt wrapped in top + bottom rules.** The 0.14.8 layout
dropped the sandwich entirely - the user wanted it kept on the active
prompt but removed from history. Done. While you're typing, the
prompt looks like:

```
─────────────────
 › _                    ← cursor here
─────────────────
```

When you submit, ANSI cursor-save (`\x1b[s`) and cursor-restore
(`\x1b[u`) let us park the bottom rule below the cursor without
readline stepping on it. After Enter, the whole sandwich is cleared
(`\x1b[2A\r\x1b[0J`) and just the plain `› user input` line lands in
scrollback. The agent response and stats line render below that,
unframed, then the next turn's sandwich draws fresh.

### Known limits

- If input wraps past terminal width while typing, readline's echo
  overwrites the bottom rule. The erase math only accounts for 2
  rule lines, so wrapped inputs may leave stray glyphs. Real queries
  tend to fit on one line; raise an issue if this bites.
- Save/restore cursor (`DECSC` / `DECRC`) relies on terminal support.
  Every modern terminal (iTerm, Terminal.app, alacritty, kitty,
  gnome-terminal) handles it. Exotic or legacy terminals may glitch.

## 0.14.8

**Chat CLI: scrolling-clean layout inspired by Hermes + Claude Code.**
The rule-sandwich from 0.14.7 left history looking cluttered (every
past turn framed in horizontal rules). Ripped out. The new layout
scrolls cleanly with bullet prefixes: `> user` and `● agent`.

### What changed

1. **Welcome**: big "BAJACLAW" block-letter banner followed by a
   two-column info block — left column has agent name, model,
   profile, effort, context, version, cwd; right column is the live
   **Available Skills** inventory with counts per origin (bajaclaw /
   openclaw / hermes). Usage line (5h + week) rendered muted below.
2. **Per-turn**: `> user input` on submit, `● agent response` after
   the cycle, indented stats line directly under the response, blank,
   next prompt. No framing rules in scrollback.
3. **"thinking…"** placeholder renders as `● thinking…` then gets
   replaced in place when the real response arrives.
4. **Errors**: same bullet style, `● error: …` in red.

### Tradeoff vs. Claude Code

Claude Code paints a sticky bottom status bar with a live sandwich
around the active prompt. Doing that without dropping into alt-screen
mode is messy and breaks scrollback. For now the active prompt is
just the plain `›` cursor, no rules. If we want the sticky bar later
it's a separate refactor (probably full-screen + custom input
handling).

## 0.14.7

**CLI chat: rule-sandwich layout.** Matches the Claude Code welcome
screen style - each turn's input lives between two horizontal rules,
with the model/duration/cost/turns line rendered directly under the
bottom rule instead of lumped with the next prompt.

### Per-turn layout

```
──────────────────── (top rule, terminal width, capped 120 cols)
 › user input
──────────────────── (bottom rule)
 · haiku · 4.2s · $0.0012 · 2 turns · #42

 emily › response text

────────────────────  (next turn's top rule)
 › 
```

- `writeHRule()` prints `chalk.dim("─".repeat(min(cols, 120)))`.
- The "thinking…" line under the bottom rule is swapped in place
  (`\x1b[1A\x1b[2K`) for the real stats once the cycle returns.
- Meta line ends at the last token (no trailing bullet).
- Empty enter leaves an adjacent double-rule - accepted visual
  glitch over adding cursor-manipulation complexity.

HANDOFF.md rewritten to capture everything that shipped in 0.13.x +
0.14.x: gateway lifecycle, dashboard internals, channel conversation
memory, the em-dash ban, the no-Co-Authored-By rule, and the Node >=22
engine floor.

## 0.14.6

**Raise Node engine to >=22, drop 20 from CI.** The test suite imports
`.ts` files directly via `await import("../src/foo.ts")`, which relies
on Node 22.6+'s built-in type stripping (`--experimental-strip-types`,
enabled by default in 22.7+). Node 20 has no such feature and fails
every test with `Unknown file extension ".ts"`. Node 20 is EOL as of
April 2026 anyway, so dropping it from the CI matrix is aligned with
upstream support. CI now runs on Node 22 + 24 across mac/linux/windows.

## 0.14.5

**Fix CI on Node 20.** `npm test` was `node --test "tests/**/*.test.js"`
which works on Node 22 (native glob support in the test runner) but
fails on Node 20 with "Could not find 'tests/**/*.test.js'" because
20 treats the pattern as a literal path. Replaced with a tiny wrapper
`scripts/run-tests.js` that enumerates the test files via
`fs.readdirSync` and invokes `node --test` with explicit paths.
Works on every Node >=20. Same test output, same 40 tests pass.

## 0.14.4

**Purge em dashes + bake a persona rule against them.** 517 em dashes
swept from every source, doc, and test file in the repo (swapped for
regular hyphens). Every built-in SOUL.md template grows a new "Hard
style rules" section that forbids the agent from emitting U+2014 in
any output: chat replies, Telegram, Discord, commit messages, code
comments, file contents. The default profile's SOUL.md on the
author's machine was updated in place.

### What changed

1. `perl -CSD -Mutf8 -pe 's/\x{2014}/-/g'` across every tracked .ts,
   .md, .html, .js, .json in the repo. 89 files touched, 0 em dashes
   remaining. Existing semantic meaning is preserved since em dashes
   almost always appeared as ` - ` equivalents.
2. `templates/*/SOUL.md` grow a "Hard style rules" block. New
   profiles inherit the ban.
3. No logic changes. All 40 tests still pass.

## 0.14.3

**Agent remembers the conversation in Telegram + Discord.** Every
channel message used to run as a brand-new cycle with no memory of
the prior back-and-forth - the agent would reply "what did you mean
by 'it'?" to messages that clearly referred to the last turn. Fixed:
channel-sourced cycles now auto-load the last 8 turns for that source
and render them into the "Recent Chat" section of the prompt.

### What changed

1. **`loadSourceHistory(db, source, currentTaskId, limit)`** - joins
   `tasks` → `cycles` for a given `source` (e.g. `telegram:14154…`),
   skips the currently-running task, returns the last N user/agent
   pairs as `ChatTurn[]` in chronological order. Only completed
   tasks + successful cycles count.
2. **Auto-population**: `runCycleInner` calls this helper when the
   popped task has a `source` and no explicit `sessionHistory` was
   passed. The chat REPL and `/api/chat` keep their explicit-history
   path; the channel gateway no longer has a cold-start problem.
3. **Response storage widened 300 → 8000 chars**. The old cap made
   every historical turn look like a truncated stub. 8k ≈ 2k tokens -
   enough to preserve real conversational content without bloating
   the DB on pathological responses.

### Landmines (for next session)

- Historical rows stored before this release have 300-char stubs.
  They'll appear in the prompt as partial context until they age out
  of the 8-turn window. Can't retroactively recover the full text.
- `loadSourceHistory` is called on every channel cycle - the join
  is indexed by `source` via `idx_tasks_priority`? No, there's no
  index on `tasks.source` yet. For a user with thousands of messages
  from one telegram chat, the scan is O(n). Fine for now; add
  `CREATE INDEX idx_tasks_source ON tasks(source)` if it bites.
- The 8-turn window is hard-coded. Short enough to stay well under
  any budget, long enough to feel like a conversation. If you bump
  it you'll also want to watch token usage on long Telegram threads.

## 0.14.2

**Typing indicator in Telegram + Discord.** When a user messages the
bot, the platform's native "…is typing" indicator shows up immediately
and stays on until the reply is sent. No more silent 30s of wondering
whether the bot is alive.

### What changed

1. **Adapters expose `startTyping(chatId)`**. Telegram re-sends
   `sendChatAction(…, "typing")` every 4s (platform auto-clears at
   5s). Discord re-sends `channel.sendTyping()` every 8s (auto-clears
   at 10s). Both return a cleanup function the gateway stores.
2. **Lifecycle**: gateway `message`/`messageCreate` handlers call
   `beginTyping(profile, source)` right after enqueuing the task -
   the indicator starts before the daemon picks up the task. When the
   daemon calls `replyToSource`, it implicitly calls `endTyping` so
   the indicator stops the same instant the reply lands.
3. **Always-clear**: the daemon also calls `endTyping` on the empty-
   text path (successful cycle with no response) and in the reply
   error handler, so nothing leaves a chat stuck in "typing…" forever.

## 0.14.1

**Recolor the dashboard to Baja Blast teal.** The Orbit palette's
orange accent is gone; everything accent-colored is now the tropical
lime teal the project is named after (#14D6CE). Focus rings, button
fills, active sidebar item, user chat bubble, openclaw skill badges -
all swapped. No structural changes.

Also: README now notes the name is a tribute to the author's favorite
soda.

## 0.14.0

**New dashboard.** Orbit design system, sidebar navigation, in-browser
chat with the agent, live config editor. The old dashboard was a
four-pane readonly dump - this one is a workbench. Directly inspired
by what Hermes Agent's web dashboard does well (config form, sessions
view), stitched onto BajaClaw's existing cycle/memory/task data model.

### Views

1. **Overview** - four stat cards (cycles today/week, spend, tokens,
   memories + pending tasks) and live-refreshed recent-cycles +
   pending-tasks panels.
2. **Chat** - send a message, the dashboard calls `/api/chat` which
   invokes `runCycle` in-process, blocks for the reply, streams it
   back. Per-reply meta line shows model tier, duration, cost, turn
   count. History is stashed in localStorage; cleared across browsers.
3. **Cycles / Memory / Tasks / Schedules** - same data as before,
   restyled. Memory gets a live client-side filter.
4. **Skills** - every active + inactive skill, color-coded by origin
   (bajaclaw / openclaw / hermes). Inactive skills show the reason
   (missing bin, wrong platform).
5. **Channels** - telegram / discord entries with masked tokens and
   allowlist; Remove button wired to `DELETE /api/channels/:kind`.
6. **Settings** - form editor for model, effort, context window,
   dashboard port, dashboard autostart, memory sync, per-cycle budget
   cap. Writes to `~/.bajaclaw/profiles/<p>/config.json` via
   whitelisted `PUT /api/config`; other fields (channels, tools) are
   intentionally not touchable from the UI.

### Backend endpoints added

- `GET /api/status` - profile, version, pid, uptime.
- `POST /api/chat` - `{ message } → runCycle(...)` → `{ ok, text,
  cycleId, costUsd, turns, model, ... }`. Blocks on the cycle.
- `GET /api/config` / `PUT /api/config` - whitelisted subset of the
  profile config. Unknown fields are silently dropped; fields like
  `allowedTools` and `channels` are not exposed.
- `GET /api/channels` - configured channels with tokens masked.
- `DELETE /api/channels/:kind` - remove a configured channel.
- `GET /api/skills` - parsed skills across all origins with
  active/inactive state.
- `GET /api/summary` - now returns day/week stats and token totals.

### Design

- Orbit-inspired dark theme - warm grays (#09090B, #0F0F12, #17171C),
  orange accent (#F97316), Inter + JetBrains Mono typography, subtle
  rgba borders, sticky backdrop-blurred topbar, 4-tier text hierarchy.
- Sidebar collapses to a horizontal scroller on narrow viewports.
- No JS framework - vanilla DOM, one single-file HTML, auto-refresh
  every 5s (paused on chat + settings views to avoid clobbering
  in-flight work).

### Landmines (for next session)

- `/api/chat` blocks until the cycle finishes. A 60s cycle holds the
  socket open that long. That's fine for one user on localhost but
  don't expose the dashboard port to a LAN without adding auth +
  probably SSE.
- `PUT /api/config` for `dashboardPort` / `dashboardAutostart` only
  takes effect on daemon restart. The save banner says so. Don't
  auto-restart on save - the dashboard is inside the process it would
  be killing.
- Skills view calls `loadAllSkillsRaw` on every hit (every 5s while
  the tab is open). For users with hundreds of skills this scans
  three directories synchronously. Fine for now; cache if it bites.

## 0.13.2

**Daemon auto-starts the dashboard.** The dashboard was a separate
long-lived command you had to remember to run - and remember to
background so it didn't hang an agent cycle. Now the daemon owns
it. `bajaclaw daemon start` → gateway, dashboard, cycle poller all
come up together. Stop the daemon → everything goes down cleanly.

### What changed

1. **`startDashboardInProcess(profile)`** returns instead of blocking.
   Port-in-use is non-fatal: logged as `daemon.dashboard.skip` and
   the daemon keeps going.
2. **`dashboardAutostart: boolean`** config field (default `true`).
   Set to `false` to opt out - e.g. if you're running the dashboard
   elsewhere or don't want port 7337 bound.
3. **`bajaclaw dashboard <profile>` still works.** Useful when the
   daemon is down and you only want the read-only view. It just
   fails with a clear EADDRINUSE if the daemon has already bound the
   port.

## 0.13.1

**Fix two operational bugs.** Bajaclaw mis-reported successful cycles
as failures whenever a tool call left a child holding stdout. And
`daemon start` didn't clean up orphan daemons, so a few crashed
sessions would pile up into a bot choir that all answered every
telegram message.

### What changed

1. **`parseResult` trusts JSON success.** claude's CLI can emit a
   `{"type":"result","subtype":"success","is_error":false,...}` body
   and then exit non-zero because a grandchild (e.g. the `bajaclaw
   dashboard` HTTP server) still holds stdout/stderr open. Previously
   we only honored exit code, so the cycle logged `cycle.fail` with
   the raw JSON as the "error", and the chat REPL printed the JSON
   back as the agent's response. Now: if the JSON explicitly says
   success, `ok=true` and `error=undefined`, regardless of exit code.
2. **`daemon start` sweeps stale processes.** Scans `ps -axo pid,command`
   for `daemon run <profile>` lines that aren't the pid in `daemon.pid`
   or the current process, and SIGTERM (→ SIGKILL after 1s) them
   before spawning a fresh one. Fixes the duplicate-reply cascade on
   Telegram when three copies of the daemon were all polling.
3. **`setup-dashboard` skill tells the agent to background.** The old
   text said "run `bajaclaw dashboard <profile>`" - which hangs a
   Bash tool call forever. Now: `nohup … >log 2>&1 &`, with a pitfall
   note explaining why. The parse fix masks the symptom; backgrounding
   is the actual correct call.

## 0.13.0

**Load skills from OpenClaw (ClawHub) and Hermes Agent.** BajaClaw used
to parse one format: its own flavour of `SKILL.md`. Now the loader
reads all three - the two external formats share the same file shape,
with extra metadata blocks that declare platform, env, and tool
requirements. A skill from ClawHub or the Hermes skills hub drops into
`~/.bajaclaw/skills/` and Just Works.

### What changed

1. **Real YAML parser** (`yaml` dep). Replaced the hand-rolled
   frontmatter parser. Handles nested maps, inline-flow objects,
   quotes, multiline strings - everything the two foreign formats
   need. Existing bajaclaw skills continue to parse identically.
2. **`origin` field on every skill**. Derived from the frontmatter:
   `metadata.hermes` → "hermes", `metadata.openclaw` (or legacy
   `clawdbot`/`clawdis`) → "openclaw", otherwise "bajaclaw".
3. **Platform + bin gating**. Skills declaring `platforms: [macos]`
   (hermes) or `metadata.openclaw.os: [linux]` are skipped on boxes
   that don't match. Skills declaring `requires.bins: [sonos]` are
   skipped if `which sonos` fails. `skill list` still shows them but
   marked inactive with reason.
4. **Hermes conditional activation**. `requires_tools` and
   `fallback_for_tools` in the hermes metadata are honored at match
   time against the profile's `allowedTools`. A skill flagged as a
   fallback for `web_search` disappears from the prompt when
   `web_search` is in the toolset.
5. **Tags contribute to matcher scoring**. Hermes skills usually ship
   without explicit `triggers` but always have `tags`; those now
   score alongside triggers so the matcher picks them up.
6. **`bajaclaw skill install` grew teeth**. New source schemes:
   - `clawhub:<slug>[@version]` - resolve + download + extract from
     the ClawHub registry via their public API.
   - bare slug - shorthand for `clawhub:<slug>`.
   - `https://…/file.zip` or `.tar.gz` - download + extract.
   - `https://…/SKILL.md` and local paths still work as before.
7. **`bajaclaw skill search <query>`**. Hits ClawHub's search API.
   Pipe to grep/fzf for interactive browsing.

### Using it

```bash
bajaclaw skill search sonos              # browse ClawHub
bajaclaw skill install clawhub:sonoscli  # drop a skill into ~/.bajaclaw/skills/
bajaclaw skill list default              # see active vs inactive
```

Hermes-format skills don't have a dedicated registry URL scheme yet -
clone or download them by hand (they're regular folders with a
`SKILL.md`) and `bajaclaw skill install <path>` picks them up.

### Landmines (for next session)

- Install specs (openclaw `install[]`: brew / node / go / uv) are
  parsed and surfaced after install, but **not auto-executed**. We
  just print them. Running them would mean shelling out to the user's
  package managers, which is a much bigger consent surface. Keep it
  that way until there's a real ask.
- `parseSkill` now needs `yaml` to be installed. If someone nukes
  `node_modules` and runs `npm test` without re-installing, the
  parser tests fail cryptically. `npm install` fixes it.
- The `metadata` block is parsed permissively: unknown keys are
  ignored, and an entirely unknown `metadata.<vendor>` block just
  leaves origin as "bajaclaw". If a new vendor format appears, it'll
  silently degrade rather than crash.
- `skill install` uses system `unzip`/`tar` for extraction - zero JS
  deps but Windows users with a bare shell may not have them. macOS
  + Linux both have them in `/usr/bin`.

## 0.12.1

**Telegram + Discord actually work now.** The skills were shipping users
through a setup flow that led nowhere - the daemon never started the
channel gateway, and no code path sent agent replies back to the
channel. Two half-built features behaving like one broken one. Fixed.

Also: pasting multi-line text into `bajaclaw chat` no longer auto-submits
on every embedded newline.

### What changed

1. **Daemon starts channel gateways on boot**. `startAllGateways(profile)`
   is called from `daemon.runLoop` before the poll loop. Adapters
   (`node-telegram-bot-api`, `discord.js`) stay alive for the lifetime
   of the daemon process. Log events `gateway.start`,
   `gateway.telegram.ready`, `gateway.discord.ready` confirm.
2. **Reply routing**. `runCycle` now returns `source` on its output
   (e.g. `"telegram:1415409977"`). After every cycle the daemon calls
   `replyToSource(profile, source, text)` which hands the string to the
   right adapter's `sendMessage`. One-way pipe is now bidirectional.
3. **Task lifecycle**. `tasks` rows get `status='done'|'error'` and
   `cycle_id` stamped when a cycle completes - previously they were
   stuck in `running` forever.
4. **`channel add` takes `--user-id`**. Telegram: `--user-id` goes into
   the allowlist (previously required hand-editing `config.json`).
   Discord: `--user-id` is optional allowlist entry, `--channel-id` still
   scopes to a channel. Skills updated.
5. **Gateway adapter polling**. When channels are configured, the daemon
   polls pending tasks every 3s instead of 60s - otherwise the bot felt
   asleep between messages.
6. **Bracketed paste in chat REPL**. `bajaclaw chat` now enables
   `\x1b[?2004h` and proxies stdin through a transform: newlines inside
   paste markers become `\x16` (SYN) so readline doesn't treat them as
   line submissions, then get swapped back to real newlines on Enter.
   Paste → edit → Enter. No more accidental half-prompt sends.

### Landmines (for next session)

- `runGateway(profile)` still exists as a backwards-compat blocking
  entry point but is unused - the daemon uses `startAllGateways` and
  keeps its own event loop. Don't reintroduce it.
- `daemon stop` only kills the pid in `daemon.pid`. Stale daemons from
  crashed sessions can pile up. If you see multiple `daemon run default`
  processes in `ps`, kill them by hand before starting a fresh one.
- Bracketed paste requires terminal support (xterm/iTerm/Terminal.app
  - all modern ones). Ancient terminals send paste as raw keystrokes
  without markers; the shim is a no-op there, so behavior degrades to
  pre-0.12.1 (submits on newline).

## 0.12.0

**Unleash the agent: no more artificial turn limits.** Turns out
`--max-turns` isn't a real claude CLI flag - it's been silently
ignored. The real "runway" knob is `--effort`. Ripped out the
phantom turn budget and wired up the flags that actually exist.

### What changed

1. **Removed `--max-turns` from `buildCommand`**. It never worked.
   `error_max_turns` came from claude's internal effort-based
   budget, not our code. All `maxTurns` fields (ClaudeOptions,
   AgentConfig, ContextBudget, tests) scrubbed. `cfg.maxTurns` is
   now deprecated: silently ignored, left in the type for
   back-compat so old configs don't break.

2. **Effort levels expanded**: `low | medium | high | xhigh | max`.
   claude's CLI added `xhigh` and `max` - the latter gives the
   agent the biggest turn / token budget before termination.

3. **Default `effort` bumped to `high`** (was `medium`). Every
   cycle now starts with real runway. Delegation (coding
   sub-sessions) defaults to `max`. `/effort max` in chat for
   monster tasks; `/effort low` to save when triaging.

4. **`--effort` is now actually passed to claude**. It wasn't
   before - `buildCommand` had no `--effort` arg. So the
   profile's `effort` setting had no effect. Now it does.

5. **1M context window support**:
   - New config field `contextWindow: "200k" | "1m"` (default `"200k"`).
   - New `ClaudeOptions.context1M: boolean` shorthand.
   - New `ClaudeOptions.betas: string[]` for arbitrary beta flags.
   - When `contextWindow: "1m"`, BajaClaw passes
     `--betas context-1m-2025-08-07` to claude.
   - **API-key auth only**. Subscription users get a warning from
     the CLI and fall back to 200k (claude handles this).

6. **Per-cycle cost ceiling**: new `cfg.maxBudgetUsd` passes
   `--max-budget-usd <n>` to claude. More honest than a turn cap
   because complexity varies - this caps the actual spend.
   `undefined` = no cap.

7. **`bajaclaw effort`** command and chat `/effort` now accept
   `xhigh` and `max`. Hints updated.

8. **Chat `/context 200k|1m`** slash command. Writes to
   `config.json`. Session header shows "1M (beta)" when enabled.

### Why this is a big deal

Before today, asking the agent to do anything non-trivial would
randomly fail with `error_max_turns` because:

- My bogus `--max-turns` was ignored → claude's internal cap applied.
- My `effort` config was also ignored (no `--effort` arg passed) →
  claude defaulted to its lowest internal budget for `-p` mode.

After: the agent actually gets the effort level you set, there's
no arbitrary turn cap, and `/effort max` gives it the most runway
claude offers.

## 0.11.3

**Four chat-session bugs found in live testing.**

1. **Raw JSON blob bleeding into the chat as the agent's
   "response"**. When a cycle hit `{"is_error": true, "subtype":
   "error_max_turns"}`, `parseResult` didn't match any of the error-
   extraction branches and fell through to the "first line of
   stdout" fallback - which was the entire JSON. Now `parseResult`
   detects `is_error: true` with a `subtype` explicitly, normalizes
   each known subtype (`error_max_turns`, `error_during_execution`,
   etc.) into a sentinel, **clears `base.text`** so the JSON never
   surfaces as response text, and **forces `base.ok = false`** so
   the chat layer never prints it as an assistant turn.

2. **`error_max_turns` when the agent tried to do real work**. The
   per-tier `maxTurns` budget was far too tight for multi-step
   tasks (setup flows, refactors, multi-file edits). Bumped the
   ceilings:

   | tier   | was | now |
   |--------|----:|----:|
   | haiku  |   4 |   8 |
   | sonnet |   8 |  20 |
   | opus   |  14 |  30 |

   Default `cfg.maxTurns` raised 10 → 30 so the per-profile cap
   doesn't clip the tier budget. `chat.ts` translates a remaining
   `max_turns_hit` sentinel into actionable text ("try `/model
   opus`, or break into smaller asks, or just retry").

3. **Agent still asked "what do you want to use Telegram for?"
   despite the v0.11.2 skill rewrite**. Strengthened both
   `setup-telegram` and `setup-discord` skills (now v0.2.1) with a
   **"NON-NEGOTIABLE RULE: NEVER ASK"** section at the top listing
   the specific forbidden questions. LLM compliance with unambiguous
   directives is much higher than polite prose.

4. **Token accounting showed `10 in` when the model actually
   processed 146k cached tokens**. `parseResult` now sums
   `input_tokens + cache_creation_input_tokens +
   cache_read_input_tokens` for the displayed "in" count, matching
   the true context size the model saw (cost remains accurate -
   cache reads are still cheap).

## 0.11.2

**Bulletproof chat + real cycle fixes.** Four issues from 0.11.1:

1. **Display corruption - every line prefixed with `you ›`**.
   The animated "thinking" indicator wrote `\r\x1b[2K` every 400ms.
   readline in terminal mode interpreted each `\r` as a cursor move
   and redrew its prompt, which interleaved with cycle output. Ripped
   the animation out entirely. Now writes `<name> is thinking…` once
   (static), then erases with cursor-up + clear-line (`\x1b[1A\x1b[2K`,
   never `\r`). Zero interference with readline.

2. **`bajaclaw chat` using event-based `rl.on('line', ...)`** had
   subtle concurrency issues. Reverted to `readline/promises` with
   `await rl.question(...)` in a `while` loop. Now that 0.11.1 fixed
   the top-level `await parseAsync`, the loop stays alive across
   turns. One turn at a time, sequential, no race conditions.

3. **`[error] cycle.fail {"error":"exit 1"}`** when the agent tried
   to use Edit/Bash/Write. BajaClaw spawns `claude` with `stdin:
   ignore`, so claude's interactive permission prompts never got a
   response and the subprocess bailed with exit 1. Fix: pass
   `--dangerously-skip-permissions` by default. The agent runs
   autonomously under the user's account - interactive approval
   doesn't make sense in this context. Configurable via
   `ClaudeOptions.skipPermissions: false` if you want to re-enable
   prompts (and drive stdin yourself).

4. **`parseResult` only surfaced `exit 1` when stderr was empty**.
   Now tries to extract `error` / `is_error` / `type:error` fields
   from the JSON response regardless of exit code, falls back to
   stderr, then to the first stdout line. The chat REPL additionally
   translates common error patterns (rate-limit, permission, credit)
   into actionable messages.

**`setup-telegram` and `setup-discord` skills rewritten (v0.2.0)**
to explicitly default to **bidirectional chat** when the user asks
to "set up telegram" / "connect discord" / etc. No more asking
clarifying questions about use case - BajaClaw just wires up the
bridge so you can message the agent from your phone and it replies
from the same thread.

Also bumped underlying tool permission: skills now state the agent
has `Bash`/`Read`/`Write`/`Edit` and should execute the commands
directly instead of printing them as instructions.

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

Also removed the custom `SIGINT` handler - Ctrl-C now exits cleanly
via the default behavior. Use `/exit` for a graceful session end
with the stats summary.

## 0.11.0

**`bajaclaw chat` - interactive REPL.** Drops you into a turn-by-turn
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
accounting - the displayed numbers are your local cycle counts and
token totals, which you can compare to your plan on anthropic.com.

**Underlying agent API changes** (useful if you embed `runCycle`):

- `CycleInput.sessionHistory?: ChatTurn[]` - prior turns, injected as
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
  then marked done - meaning the user's first real `bajaclaw`
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

- **Postinstall is now quiet and fast** - scaffolds the default
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

- **`bajaclaw welcome`** - new command. Re-display the banner and
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
  tracking - the `prepare` script added in 0.10.0 means git installs
  build `dist/` on the way in.

No behavior changes to the runtime - this release is install metadata
only. See 0.10.0 for the memory-compaction feature.

## 0.10.0

**Install flow groundwork for publishing.**

- Added `prepare: npm run build` so git installs build `dist/` before
  packing.
- Added `files` list in `package.json` so the packed tarball includes
  `bin/`, `dist/`, `scripts/`, `skills/`, and `templates/` (and
  excludes `src/`, `tests/`, `docs/`).

**Memory compaction - so the agent keeps learning without slowing
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

**HTTP API - precise model routing**. The `model` field in
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
- Haiku: `claude-haiku-4-5` (unchanged - still the newest Haiku)

`bajaclaw model` lists the new ids. `model: auto` (the default) routes
to these. Internal sub-calls updated:

- Sub-agent delegation (`src/delegation.ts`): Opus 4.7
- Reflection cycle (`src/self-improve.ts`): Opus 4.7
- Auto-skill synthesis (`src/skills/auto-skiller.ts`): Sonnet 4.6
- Post-cycle memory extract: Haiku 4.5 (unchanged)

`init` and `setup` CLI `--model` default: `auto`. The `--model` help
string now shows the new ids.

Existing profiles' explicit model settings are not rewritten on upgrade
- their `config.json` still points to whatever you set. Run
`bajaclaw model <new-id>` to bump.

## 0.7.0

**`model: auto` is the new default.** Before every cycle, a heuristic
classifier in `src/model-picker.ts` routes the task to a tier:

- Haiku - triage, status checks, heartbeats, very short tasks
- Sonnet - normal work (default fallback)
- Opus - planning, coding, refactoring, deep research, reflection

Zero extra backend calls - routing is pure heuristics.

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
subprocesses - two simultaneous requests for the same profile are
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
  Anything that speaks the OpenAI chat API - Cursor, Open WebUI, the
  `openai` SDKs, curl, LangChain, LlamaIndex - can drive BajaClaw as if
  it were an LLM. Each request runs a full cycle (memory recall, skill
  matching, MCP inheritance, backend call, post-cycle extract).
- Endpoints:
  - `GET /health`
  - `GET /v1/models` - lists exposed profiles as OpenAI model entries
  - `POST /v1/chat/completions` - non-streaming and SSE streaming
  - `POST /v1/bajaclaw/cycle` - native full `CycleOutput`
  - `POST /v1/bajaclaw/tasks` - enqueue without waiting
- Auth: optional bearer token via `--api-key` or `api.apiKey` in
  `~/.bajaclaw/api.json`. Non-localhost binds without a key are refused.
- Model name maps to a profile (`"model": "default"` or
  `"model": "bajaclaw:default"`). Multi-message histories render as a
  prior transcript; the last message is the current task.
- CORS headers on every response; `OPTIONS` preflight handled.
- New built-in guide skill `setup-api` - ask your agent "help me set up
  the API" and it walks you through the whole flow.
- New docs: `docs/api.md` with full endpoint reference and client
  examples (Python SDK, Node SDK, curl streaming, Cursor/Open WebUI).

## 0.5.0

- **Self-knowledge skills**: BajaClaw now ships 13 built-in skills that
  document how to configure BajaClaw itself. Ask your agent "help me
  setup telegram" (or discord, heartbeat, daemon, dashboard, memory sync,
  etc.) and the matching skill fires - the agent knows the procedure
  without you writing one.
  - `setup-telegram`, `setup-discord`, `setup-heartbeat`, `setup-daemon`,
    `setup-dashboard`, `setup-mcp-port`, `setup-memory-sync`,
    `setup-profile`, `setup-self-update`, `setup-uninstall`
  - `configure-model`, `configure-effort`, `configure-tools`
- **`bajaclaw model [id] [profile]`**: show current model + known list
  (`claude-opus-4-5`, `claude-sonnet-4-5`, `claude-haiku-4-5`) with no
  args; set the model for a profile with an id. Any string is accepted
  - the backend validates against the subscription.
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
  BajaClaw analyzes the task + tool sequence + response and - if the
  procedure is reusable - writes a structured `SKILL.md` with When-to-use /
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
  `custom` templates now ship without tool restrictions - agents can Write,
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

## 0.1.0 - initial release

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
