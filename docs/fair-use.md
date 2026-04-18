# Fair use

BajaClaw is a wrapper around the `claude` CLI. It invokes that CLI as a
subprocess with standard documented flags, parses its JSON output, and
persists cycle state locally. This doc describes how BajaClaw stays
inside the sandbox your `claude` CLI already runs in, and what that
means for your Anthropic account.

## The short version

- BajaClaw never sees your credentials.
- BajaClaw never calls Anthropic's API directly.
- BajaClaw only uses documented `claude` CLI flags.
- BajaClaw caps its own usage with a rate limit and circuit breaker.
- BajaClaw serializes cycles per profile — one subprocess at a time.

Your Anthropic Terms of Service apply to whatever automation you
configure, the same way they'd apply if you were typing `claude -p`
into a shell in a loop by hand. Use your own account. Respect the
rate limits your plan gives you. Don't share credentials across
machines or users.

## How BajaClaw drives the CLI

Every backend call goes through [`src/claude.ts`](../src/claude.ts) as:

```
claude -p "<prompt>" \
  --model <id> \
  --max-turns <n> \
  --allowedTools "..." \
  --disallowedTools "..." \
  --mcp-config <path> \
  --output-format json
```

These are all documented, user-facing flags. BajaClaw:

- Finds the binary via `which claude` / `where.exe claude` — no hardcoded paths.
- Runs it with `execa`, passing arguments as a JS array with `shell: false`.
  No string-concatenated shell commands.
- Parses the JSON output format. Falls back to raw text if the flag
  isn't supported on your version.
- Never reads or writes the CLI's own auth state. Whatever login that
  CLI has, BajaClaw inherits through normal subprocess behavior.

BajaClaw does not:

- Call the Anthropic REST API directly from its own code.
- Set `Authorization` headers or manipulate request bodies.
- Proxy requests through any Anthropic-facing server.
- Spoof a different client identity.
- Use any undocumented CLI flag.
- Evade rate limits imposed by the backend — when the CLI returns a
  rate-limit error, BajaClaw propagates it and trips its own circuit
  breaker.

## Built-in backoff

Three independent guards keep BajaClaw from running loose:

### Rate limit
Default: 30 cycles per rolling hour, per profile. Override with custom
code in [`src/safety.ts`](../src/safety.ts). When the limit is reached,
the next cycle fails with `rate limit exceeded (N/hr)` and the task
stays in the queue.

### Circuit breaker
5 consecutive cycle failures trip the breaker open for 15 minutes.
Nothing runs during cooldown. This stops BajaClaw cold if the backend
starts returning errors (rate-limit, auth, network, anything) instead
of hammering further requests.

### Cycle serialization
Cycles are serialized per profile within a process (see
[`src/concurrency.ts`](../src/concurrency.ts)). If the HTTP API receives
two requests for the same profile simultaneously, the second one waits
for the first to finish. This keeps backend subprocess count to at most
one per profile at a time.

## What the daemon does (and doesn't)

`bajaclaw daemon run` polls the tasks queue every 60 seconds. It runs
a cycle **only if there are pending tasks**. An idle daemon makes zero
backend calls.

The OS-scheduler heartbeat installed by `bajaclaw daemon install` runs
`*/15 * * * *` by default — four cycles per hour if continuously
active. You can tune the schedule in `HEARTBEAT.md` or by editing the
scheduler entry directly.

## Auto model picker

When a profile's model is `auto` (the default), BajaClaw routes each
task to the cheapest capable model:

- **Haiku** — triage, status checks, short answers, heartbeats
- **Sonnet** — most normal work
- **Opus** — planning, coding, deep research, reflection

This is a heuristic classifier in
[`src/model-picker.ts`](../src/model-picker.ts) that runs before the
backend call — no extra tokens spent on routing. Same-or-lower model
is picked per cycle; you can override per-profile with
`bajaclaw model <id>`.

Coupled with this, context per cycle is **tiered**:

| tier | memories | skills | max-turns |
|---|---|---|---|
| haiku  | 3 | 1 | 4 |
| sonnet | 5 | 2 | 8 |
| opus   | 7 | 3 | 14 |

The post-cycle memory extractor (Haiku) and auto-skill synthesizer
(Sonnet) are **skipped** for Haiku-tier cycles entirely. That cuts the
cost of most cycles to a single short backend call.

## Running the HTTP API

`bajaclaw serve` exposes an OpenAI-compatible endpoint. Each request is
one full cycle — and the same serialization, rate limiter, and
circuit breaker apply. You cannot spawn parallel cycles from the API.

The API refuses to bind a non-localhost address without an API key.
This prevents accidentally exposing your Anthropic subscription to the
LAN or the internet.

## What you should not do

- Don't run BajaClaw against an account that belongs to someone else.
- Don't point multiple BajaClaw installs at one account and drive them
  all at full throttle.
- Don't disable the rate limiter and daemon its way through a real
  backlog.
- Don't bypass the circuit breaker by wrapping cycles in retries —
  failures are signals, not speed bumps.
- Don't expose the HTTP API publicly without auth **and** rate-limit
  proxy in front.

## What you should do

- Keep `model: auto` unless you have a reason to pin.
- Keep the default rate limit unless your plan allows more and you need it.
- Read Anthropic's current ToS and acceptable-use policy for your plan.
- If you see rate-limit errors, let the breaker cool down — don't
  force-run cycles during backoff.
- Treat BajaClaw like any long-running automation you'd wire into a
  production account: observable, bounded, and easy to shut off.
