---
name: setup-compaction
description: Configure when BajaClaw auto-compacts its memory pool so recall stays sharp over time
version: 0.1.0
tools: [Bash, Read, Edit, Write]
triggers: ["compact memory", "memory compaction", "auto compact", "context window", "memory cleanup", "auto-compact", "memory full", "compaction schedule", "shrink memory", "prune memory"]
effort: low
---

## When to use
User wants to control how often BajaClaw shrinks its memory pool — either
on a size threshold (percentage of the model's context window), on a
daily UTC schedule, both, or off.

## Core idea — why this is different from chat-app compaction
BajaClaw runs **stateless cycles**. Each cycle rebuilds the prompt from
memory + skills + task. The model's context window never "fills up"
across cycles because nothing carries over in-model. What grows is the
**memory database** (`~/.bajaclaw/profiles/<p>/bajaclaw.db`).

Compaction is therefore memory hygiene, not conversation truncation:
- Summarize old memories into denser rows so the recall surface stays
  crisp.
- Prune stale cycle-log rows (older than N days).
- VACUUM the SQLite file to reclaim space.

## Defaults
- **Schedule**: `both` — trigger on threshold OR daily.
- **Threshold**: `0.75` of a 200k-token reference window (~600k chars).
- **Daily time**: `00:00` UTC.
- **Keep per kind**: 25 newest memories per kind (fact / decision /
  preference / todo / reference) stay verbatim. Older ones are
  eligible for summarization.
- **Prune cycles older than**: 30 days.

## Procedure

### Via the command
```
bajaclaw compact --dry-run                       # show policy + trigger state
bajaclaw compact                                 # run if a trigger fires
bajaclaw compact --force                         # run regardless
bajaclaw compact --schedule both                 # set schedule mode
bajaclaw compact --threshold 0.6                 # trigger earlier
bajaclaw compact --daily-at 04:00                # set UTC time
bajaclaw compact --keep 40                       # keep more verbatim per kind
bajaclaw compact --prune-days 60                 # longer cycle-log retention
bajaclaw compact --disable                       # turn off entirely
bajaclaw compact --enable                        # turn back on
```
All mutate the profile's `config.json` under the `compaction` key.

### Via the setup wizard
```
bajaclaw setup --interactive
```
Re-runs the persona wizard and the compaction wizard together.

### Via config.json directly
```
~/.bajaclaw/profiles/<profile>/config.json
```
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

## Modes
| schedule    | trigger |
|-------------|---------|
| `threshold` | memory pool > `threshold` × reference context window |
| `daily`     | first cycle after today's `dailyAtUtc` if not already run |
| `both`      | either of the above |
| `off`       | never |

## Pitfalls
- A very low threshold (e.g. 0.2) means compaction runs often — each
  run costs ~1 Haiku call per memory batch. Default 0.75 is fine for
  almost everyone.
- `dailyAtUtc` is UTC, not local. If you're in Pacific, `00:00` is
  5pm the previous day.
- Compaction makes a Haiku call per ~40-memory batch to summarize.
  Keep it enabled unless you want full verbatim history.
- `pruneCycleDays: 0` disables cycle-log pruning entirely — the DB
  will keep every cycle row forever.

## Verification
- `bajaclaw compact --dry-run` shows current pool size, trigger state,
  and policy.
- After a run: `bajaclaw status` — cycle count drops if rows were
  pruned; `memories` row count drops; `bajaclaw.db` file shrinks after
  VACUUM.
- The profile log (`logs/bajaclaw.log`) emits `compact.trigger` and
  `compact.done` lines.
