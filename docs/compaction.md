# Memory Compaction

BajaClaw agents learn over time. Without care, the memory pool grows
unbounded, recall quality degrades, and the SQLite file bloats.
Compaction keeps the pool lean so the agent stays sharp.

## The short version

- BajaClaw **does not** carry context across cycles the way a chat app
  does. Each cycle is a fresh `claude -p …` subprocess. Nothing stays
  in the model between cycles.
- What grows unbounded is the **memory database** — the FTS5 table
  that fuels recall and the cycle log.
- Compaction = memory hygiene. It summarizes old memories, prunes
  stale cycle rows, and VACUUMs the DB.
- Runs automatically on a **threshold** (memory pool > 75% of a
  200k-token reference context window, by default) or on a **daily
  schedule** (00:00 UTC by default). Both are on by default.

## "Is there a context window problem here?"

Short answer: no ongoing-conversation context to compact. Long answer:

Because BajaClaw builds each cycle's prompt from scratch — persona +
AGENT.md + top-N recalled memories + matched skills + current task —
the model never sees more than one cycle's worth of context. The
per-tier budgets in `src/model-picker.ts` already cap how much memory
goes into the prompt (3 / 5 / 7 memories for Haiku / Sonnet / Opus,
with a per-memory char cap). So the model's own window is a
non-issue.

What **does** become a problem: the database backing recall. As
memories pile up, FTS5 has more to rank through, summaries get lost
in noise, and the file grows. Compaction collapses older entries
into dense summaries so the recall surface stays crisp and the DB
stays bounded.

## Triggers

Two independent triggers. Default policy enables both.

### Threshold

Before each cycle, BajaClaw runs:

```sql
SELECT COUNT(*), SUM(LENGTH(content)) FROM memories;
```

If the total character count exceeds `threshold × 200_000 tokens × 4
chars/token` (≈ 600k chars at the default 0.75), compaction fires for
this cycle.

The "reference context window" is Sonnet's 200k tokens, which is the
middle of the tier. Haiku is also 200k. Opus is 200k (or 1M with the
`[1m]` flag). Using a fixed reference keeps the policy predictable
across tier switches in `auto` mode.

### Daily UTC

If the current cycle is past `dailyAtUtc` (default `00:00`) and the
last compaction recorded in `circuit_state.last_compaction_at` is
before that target, compaction fires. One run per UTC day, max.

UTC is intentional: the cron-style schedule is stable across travel,
timezone changes, and daylight saving. If you're in the US Pacific,
`00:00 UTC` is 5pm local the previous day.

## What a compaction does

1. For each `kind` (fact, decision, preference, todo, reference, …):
   - Keep the newest `keepRecentPerKind` rows (default 25) verbatim.
   - Take the rest in batches of 40.
   - For each batch of 3+, call Haiku with a tight prompt: "collapse
     into one or two dense sentences, preserve load-bearing facts,
     drop duplicates." The response replaces the batch as a single
     row with `source='compacted'`.
2. Delete cycle-log rows older than `pruneCycleDays` (default 30).
3. `VACUUM` the SQLite file to reclaim disk space.
4. Write `last_compaction_at` into `circuit_state`.

Summarization costs one Haiku call per batch. On a pool of 500 old
memories, that's about a dozen calls — cents of spend, not dollars.

## Configuration

### From setup

The interactive setup wizard asks about compaction after the persona
questions. Re-run any time:

```
bajaclaw setup --interactive
```

### From the command

```
bajaclaw compact --dry-run                    # show pool size, trigger state, policy
bajaclaw compact                              # run only if a trigger fires
bajaclaw compact --force                      # run regardless

bajaclaw compact --schedule both              # threshold | daily | both | off
bajaclaw compact --threshold 0.6              # fire earlier (0.1–0.99)
bajaclaw compact --daily-at 04:00             # set UTC time (HH:MM)
bajaclaw compact --keep 40                    # verbatim rows per kind
bajaclaw compact --prune-days 60              # cycle-log retention

bajaclaw compact --disable                    # turn off entirely
bajaclaw compact --enable                     # turn back on
```

Flags mutate `~/.bajaclaw/profiles/<profile>/config.json` under the
`compaction` key. Pass a `--profile <name>` / positional profile to
target a sub-agent.

### From config.json

```json
{
  "compaction": {
    "enabled": true,
    "threshold": 0.75,
    "schedule": "both",
    "dailyAtUtc": "00:00",
    "keepRecentPerKind": 25,
    "pruneCycleDays": 30
  }
}
```

| field | type | default | notes |
|---|---|---|---|
| `enabled` | bool | `true` | master switch |
| `schedule` | `threshold`\|`daily`\|`both`\|`off` | `both` | which trigger(s) fire |
| `threshold` | number | `0.75` | fraction of the 200k-token reference window |
| `dailyAtUtc` | `HH:MM` | `"00:00"` | UTC time for the daily trigger |
| `keepRecentPerKind` | int | `25` | newest rows per kind kept verbatim |
| `pruneCycleDays` | int | `30` | drop cycle-log rows older than N days (0 disables) |

## Disabling compaction

If you want full verbatim memory forever:

```
bajaclaw compact --disable
```

or set `"schedule": "off"` / `"enabled": false` in `config.json`.

Be aware that recall degrades and the DB grows without bound — only
worth it for research setups where you want raw history intact.

## How this interacts with…

- **Dry-run cycles**: compaction is skipped on `bajaclaw start
  --dry-run` so dry runs never spawn backend calls.
- **Memory sync** (`memorySync: true`): compaction runs after any
  sync-in from `~/.claude/memory/` for that cycle, so imported rows
  are visible to the next compaction pass.
- **Sub-agents**: each sub-agent has its own config and its own
  compaction policy. Default inherits.
- **Auto-skill synthesis**: independent. Skills aren't in the
  memories table.
- **Rate limit / circuit breaker**: compaction triggers run before
  the gate, so a breaker-tripped profile still compacts. The
  summarization call itself is outside the cycle budget.

## Operational notes

- The pre-cycle trigger check is a single fast SQLite query. It costs
  effectively nothing — safe to leave on.
- A compaction run on a 500-memory pool typically finishes in 5–15
  seconds (dominated by Haiku latency).
- If the `VACUUM` fails (e.g., another process holds the DB), the
  run logs a warning and moves on.
- The `logs/bajaclaw.log` file emits `compact.trigger`,
  `compact.batch`, `compact.done`, and any `compact.*.fail` events
  for observability.

## Related

- [Memory](memory.md) — overall memory model and FTS5 details
- [Architecture](architecture.md) — cycle loop, prompt assembly
- [Heartbeat](heartbeat.md) — scheduled cycles that drive background
  compaction in the absence of user traffic
