# Interactive Chat

`bajaclaw chat` drops you into an interactive REPL with your agent.
Each message runs one BajaClaw cycle — memory recall, skill match, MCP
inheritance, the backend call, post-cycle extract — so the agent
behaves exactly as it does in scheduled / triggered runs, just with
you driving the tasks.

```
bajaclaw chat                         # default profile
bajaclaw chat researcher              # specific profile
bajaclaw chat --model opus            # force a model for the session
bajaclaw chat --model claude-opus-4-7 # full id also works
```

## Session header

On start you see:

```
╭─ BajaClaw chat · default · v0.11.0 ─────────────────────────╮
  agent       emily
  model       auto (routes haiku/sonnet/opus per task)
  effort      medium
  context     200k tokens · 8-turn cap

  5h usage    3 cycles · 1.2k tokens · $0.012
  week        28 cycles · 18k tokens · $0.142
  (advisory counts from your local cycle log — compare to your Anthropic plan)

  /help for commands · /exit or Ctrl-D to quit
╰──────────────────────────────────────────────────────────────╯
```

The 5h and week counts come from your local cycle log. They're
advisory — BajaClaw doesn't know your subscription tier's exact cap.
Compare to Anthropic's console for your real limits.

## Per-turn status line

After every response:

```
· sonnet · medium · 1.2k in / 456 out · 3.2s · $0.003 · #42 ·
```

Fields, left to right: actual model used (auto-resolved), effort,
input tokens / output tokens, wall-clock duration, cost in USD, cycle
ID (matches rows in the `cycles` table).

## Slash commands

Everything starting with `/` is a client-side directive, not sent to
the model.

| command | purpose |
|---|---|
| `/help` | list commands |
| `/exit` / `/quit` / `/q` | end session (or Ctrl-D) |
| `/clear` | clear session history (durable memory untouched) |
| `/stats` | session totals + 5h / 24h / 7d usage breakdown |
| `/context` or `/ctx` | show context window + per-cycle budget |
| `/model [id\|alias]` | show or set session model — **doesn't write config.json** |
| `/effort [low\|medium\|high]` | show or set effort — **persists to config.json** |
| `/compact` | run memory compaction now |
| `/history` | dump this session's turns |

### Model aliases

For `/model` and `--model`:

| alias | resolves to |
|---|---|
| `auto` | `auto` (per-task routing) |
| `haiku` | `claude-haiku-4-5` |
| `sonnet` | `claude-sonnet-4-6` |
| `opus` | `claude-opus-4-7` |
| anything else | passed through verbatim |

`/model` is session-only; it doesn't touch the profile's `config.json`.
Exit and you're back on the configured default.

`/effort` does persist — that's a durable preference.

## How session memory works

Inside a session, your last 10 turns are injected into the next
prompt's `# Recent Chat` section (each turn capped at ~1200 chars).
So the agent remembers what you just said without waiting on the
post-cycle extractor to populate durable memory.

Across sessions, durable memory takes over: the extractor writes
facts / decisions / preferences to the FTS5 table, and the next
session's FTS recall surfaces them. So "remember that I prefer Rust"
said yesterday still works today.

`/clear` wipes the session window but does NOT touch durable memory.

## Rate-limit accounting

BajaClaw tracks what you've run locally. It can't see Anthropic's
server-side subscription accounting directly.

- **Session**: counted in-memory; shown in `/stats` and at exit.
- **5h / 24h / 7d**: summed from the `cycles` table where `status='ok'`.
  Includes heartbeat cycles, API-driven cycles, everything — not just
  this chat.

If Anthropic returns a rate-limit error, the `claude` CLI surfaces it
and the cycle fails cleanly; the turn is rolled back and the session
continues.

## Context window vs. per-cycle budget

Two different numbers that sometimes confuse people.

- **Context window** = the model's hard upper limit for a single
  request. Haiku / Sonnet: 200k tokens. Opus: 200k (or 1M with the
  `[1m]` flag).
- **Per-cycle budget** = BajaClaw's self-imposed cap on how much it
  packs in. Tightened per tier to keep token spend sane: Haiku 3
  memories / 1 skill / 4 turns; Sonnet 5 / 2 / 8; Opus 7 / 3 / 14.

`/ctx` shows both. The context window is never close to full in
practice because BajaClaw keeps the per-cycle prompt tight.

## Comparison to other tools

- **Claude Code** (`claude`): a coding agent. Has its own memory,
  files-in-scope, and is tuned for the local repo. BajaClaw chat is
  a general agent that drives `claude` as a subprocess.
- **OpenClaw / Hermes-style REPLs**: similar REPL UX. BajaClaw adds
  the persistent memory DB, skills, MCP integration, and 24/7
  heartbeat mode.

## Exiting

- Type `/exit`, `/quit`, or `/q`
- Ctrl-D (EOF)
- Ctrl-C twice (first press warns, second kills)

On exit you get a one-line summary:

```
Session: 7 turns · 15.3k tokens · $0.156 · 4m 23s
```

## Related

- [Commands](commands.md) — full CLI reference
- [Memory](memory.md) — how durable recall works
- [Compaction](compaction.md) — keeping the memory pool lean
