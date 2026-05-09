# HTTP API

BajaClaw exposes itself as an OpenAI-compatible HTTP server. Anything
that speaks the OpenAI Chat Completions API can drive it: Cursor, Open
WebUI, LibreChat, Continue.dev, LangChain, LlamaIndex, the official
`openai` SDKs, raw curl. Each request runs a full BajaClaw cycle.

What "full cycle" means per request:

1. Optional pre-cycle shadow-git snapshot (`cfg.snapshots.enabled`).
2. Memory recall against the task text.
3. Skill matching against the task and tool allowlist.
4. MCP config assembly (per-profile + optional desktop merge).
5. Backend call to `claude` in lightweight mode with the assembled prompt.
6. Response parsing, cost + token accounting, response storage.
7. Post-cycle memory extraction (skipped on Haiku-tier and dry-run).

Per-profile cycles are serialized FIFO; concurrent requests for the
same profile queue rather than spawning parallel `claude` subprocesses.
Different profiles run in parallel.

---

## Quickstart

```bash
# 1. One-time auth setup (subscription users; Pro/Max/Team/Enterprise)
bajaclaw setup-token

# 2. Start the server
bajaclaw serve

# 3. Send a request from another terminal
curl http://localhost:8765/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "default",
    "messages": [{"role":"user","content":"hello"}]
  }'
```

That's it. You'll get back a normal OpenAI Chat Completion response,
backed by a real BajaClaw cycle on your `default` profile.

---

## Authentication

There are two independent auth layers. Don't confuse them:

| layer | what | how it's set | who needs it |
|---|---|---|---|
| **outbound** | bajaclaw -> Anthropic | `ANTHROPIC_API_KEY` (env, file, or `setup-token`) | always |
| **inbound** | client -> bajaclaw | `apiKey` (config or `--api-key`) | when binding non-localhost, or any time you want to gate access |

### Outbound auth (bajaclaw -> Anthropic)

Endpoint cycles run in **lightweight mode** (v0.21.6+): the spawned
`claude` gets `--setting-sources=local --strict-mcp-config
--no-session-persistence`. This suppresses the user-level
`~/.claude/CLAUDE.md`, user-level settings (where hooks live), and
non-explicit MCP servers, while leaving auth working normally.

Two token formats are supported and routed automatically:

- **`sk-ant-oat*`** -> subscription OAuth token (from `claude setup-token`).
  Injected into the spawned `claude` as `CLAUDE_CODE_OAUTH_TOKEN`. Bills
  against your Pro/Max/Team/Enterprise quota.
- **`sk-ant-api*`** -> real Anthropic API key (from console.anthropic.com).
  Injected as `ANTHROPIC_API_KEY`. Bills against your API account.

Token type is detected by prefix; you don't pick the env var manually.

`bajaclaw serve` resolves outbound auth at startup in this order:

1. `process.env.ANTHROPIC_API_KEY` or `process.env.CLAUDE_CODE_OAUTH_TOKEN`
2. `anthropicApiKey` field in `~/.bajaclaw/api.json`
3. **TTY only:** prompts to run `claude setup-token` and saves the result

If none of those resolves and you're not on a TTY, the server starts
anyway with a yellow warning; every `/v1/chat/completions` request will
then 401 at the Anthropic layer until a key is in scope.

(Earlier versions used `claude --bare`, which only accepts real API
keys. Subscription OAuth tokens fail under `--bare` with "Invalid API
key". v0.21.6 switched to the lightweight flags so subscription users
work too.)

#### Subscription users: `claude setup-token`

`claude setup-token` walks an OAuth browser flow and prints a 1-year
inference-scoped token. The token works as `ANTHROPIC_API_KEY` and
**bills against your subscription quota**. No separate API credits
required. Pro, Max, Team, and Enterprise plans are all eligible.

Run it through bajaclaw to save the result automatically:

```bash
bajaclaw setup-token              # save the minted token
bajaclaw setup-token --force      # replace an existing saved token
```

The token lands at `~/.bajaclaw/api.json` with `chmod 600`. After that,
every `bajaclaw serve` start finds it without prompting.

#### Manual env var

If you'd rather export the key yourself:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
bajaclaw serve
```

This wins over the saved file.

#### 3P providers

If you point `claude` at AWS Bedrock, Vertex, or Foundry via its own
settings (`CLAUDE_CODE_USE_BEDROCK=1`, `AWS_BEARER_TOKEN_BEDROCK`,
etc.), you don't need an Anthropic key. `bajaclaw serve` still runs the
auth resolver and warns if no key is found, but the spawned `claude`
will pick up its 3P creds normally.

### Inbound auth (clients -> bajaclaw)

If you set `apiKey` in `~/.bajaclaw/api.json` or pass `--api-key`,
every request (except `/health`) must carry:

```
Authorization: Bearer <your-api-key>
```

Anything else returns `401`.

`bajaclaw serve` **refuses to bind a non-localhost host without an
inbound api-key**. Binding to `0.0.0.0` or a LAN interface always
requires `--api-key`.

```bash
bajaclaw serve --host 0.0.0.0 --api-key $(openssl rand -hex 24)
```

CORS is permissive (`*`) on every response. If you want a tighter
policy, terminate at nginx or Caddy.

---

## Server configuration

### `~/.bajaclaw/api.json`

Default location for persistent config. Created by `bajaclaw
setup-token` if it doesn't exist; otherwise hand-edit.

```json
{
  "host": "127.0.0.1",
  "port": 8765,
  "apiKey": "your-long-inbound-secret",
  "exposedProfiles": ["default", "research"],
  "streamDelayMs": 20,
  "anthropicApiKey": "sk-ant-..."
}
```

| field | type | default | meaning |
|---|---|---|---|
| `host` | string | `127.0.0.1` | bind interface |
| `port` | number | `8765` | bind port |
| `apiKey` | string \| null | `null` | inbound bearer token; `null` = no auth (localhost only) |
| `exposedProfiles` | string[] | `[]` | allowlist of profile names; empty = expose all |
| `streamDelayMs` | number | `20` | legacy, unused since v0.19.7 (real streaming) |
| `anthropicApiKey` | string | `undefined` | outbound key for spawned `claude` cycles |

### CLI flags

```bash
bajaclaw serve [--host <h>] [--port <n>] [--api-key <k>]
               [--expose <names...>] [--stream-delay <ms>]
```

CLI flags override file values. Common patterns:

```bash
bajaclaw serve                                      # 127.0.0.1:8765, no auth
bajaclaw serve --port 9000                          # custom port
bajaclaw serve --api-key $(openssl rand -hex 24)    # require bearer auth on localhost
bajaclaw serve --host 0.0.0.0 --api-key <secret>    # bind all interfaces (auth required)
bajaclaw serve --expose default research            # only these profiles
```

---

## Endpoints

| method | path | purpose |
|---|---|---|
| GET | `/health` | liveness probe (no auth required) |
| GET | `/v1/models` | list exposed profiles + virtual model entries |
| POST | `/v1/chat/completions` | OpenAI Chat Completions (sync or stream) |
| POST | `/v1/bajaclaw/cycle` | native: full `CycleOutput` (cost, tokens, prompt, command) |
| POST | `/v1/bajaclaw/tasks` | native: enqueue a task without waiting |

### `GET /health`

Liveness probe. No auth, even if `apiKey` is set.

```bash
curl http://localhost:8765/health
# {"status":"ok"}
```

### `GET /v1/models`

Lists exposed profiles in OpenAI's model-list shape. Three kinds of
entries:

1. Bare profile names (one per exposed profile).
2. `<profile>:<model>` virtuals (one per profile per known model).
3. Bare model-id shortcuts (apply to the `default` profile).

```bash
curl http://localhost:8765/v1/models | jq
```

```json
{
  "object": "list",
  "data": [
    { "id": "default",                   "object": "model", "created": 1700000000, "owned_by": "bajaclaw" },
    { "id": "research",                  "object": "model", "created": 1700000000, "owned_by": "bajaclaw" },
    { "id": "default:auto",              "object": "model", "created": 1700000000, "owned_by": "bajaclaw" },
    { "id": "default:claude-haiku-4-5",  "object": "model", "created": 1700000000, "owned_by": "bajaclaw" },
    { "id": "default:claude-sonnet-4-6", "object": "model", "created": 1700000000, "owned_by": "bajaclaw" },
    { "id": "default:claude-opus-4-7",   "object": "model", "created": 1700000000, "owned_by": "bajaclaw" },
    { "id": "research:claude-opus-4-7",  "object": "model", "created": 1700000000, "owned_by": "bajaclaw" },
    { "id": "auto",                      "object": "model", "created": 1700000000, "owned_by": "bajaclaw" },
    { "id": "claude-opus-4-7",           "object": "model", "created": 1700000000, "owned_by": "bajaclaw" }
  ]
}
```

The list is a hint, not a hard whitelist. Any string accepted by the
parser at request time works (see Model selection below).

### `POST /v1/chat/completions`

Standard OpenAI Chat Completions. Synchronous or SSE-streaming.

Request fields read by bajaclaw:

| field | type | meaning |
|---|---|---|
| `model` | string | profile, profile:model, or model-shortcut (see Model selection) |
| `messages` | array | ordered chat turns; last is the current task |
| `stream` | boolean | `true` -> SSE response |
| `stream_options.include_usage` | boolean | `true` -> emit final usage-only chunk before `[DONE]` |

Ignored fields (silently): `temperature`, `max_tokens`, `top_p`,
`frequency_penalty`, `presence_penalty`, `tools`, `tool_choice`,
`response_format`, `n`, `seed`, `user`, `logit_bias`, `stop`,
`logprobs`. The agent runs at the profile's configured `effort` level
and uses tools internally.

#### Message handling

- **Single message:** `messages[0].content` becomes the task.
- **Multi-message:** earlier messages are rendered as a labeled
  transcript prefix; the last message is the current task. Roles map
  to labels: `system -> SYSTEM`, `user -> USER`, `assistant ->
  ASSISTANT`, `tool -> TOOL`.

So a request like:

```json
{
  "model": "default",
  "messages": [
    {"role": "system", "content": "Be concise."},
    {"role": "user", "content": "What's the weather?"},
    {"role": "assistant", "content": "Where?"},
    {"role": "user", "content": "Sydney"}
  ]
}
```

becomes a task with body:

```
You are continuing a conversation. Prior exchange:

SYSTEM: Be concise.

USER: What's the weather?

ASSISTANT: Where?

Current message:
Sydney
```

BajaClaw's own memory recall, skills index, and MCP config still stack
on top of that body before the cycle runs.

#### Non-streaming response

```json
{
  "id": "chatcmpl-bc-42",
  "object": "chat.completion",
  "created": 1700000000,
  "model": "default",
  "choices": [
    {
      "index": 0,
      "message": {"role": "assistant", "content": "Mid-20s, partly cloudy."},
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 1234,
    "completion_tokens": 256,
    "total_tokens": 1490
  }
}
```

`prompt_tokens` is the displayed "in" count: `input + cache_creation +
cache_read` summed (matches what the cycle was billed for).
`completion_tokens` is output tokens. Both fall back to `0` if the
backend didn't report usage (Haiku-tier responses, stream-aborted
cycles). `total_tokens` is the sum.

`finish_reason` is `"stop"` on success, `"error"` if the cycle failed
(message content is the error text in that case).

#### Streaming response

Server-Sent Events; standard OpenAI `chat.completion.chunk` shape.

Request:

```json
{
  "model": "default",
  "messages": [{"role":"user","content":"walk me through yesterday"}],
  "stream": true
}
```

Wire format (chunked as the backend produces text via claude's
`--output-format stream-json`):

```
data: {"id":"chatcmpl-bc-42","object":"chat.completion.chunk","created":1700000000,"model":"default","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl-bc-42","object":"chat.completion.chunk","created":1700000000,"model":"default","choices":[{"index":0,"delta":{"content":"On "},"finish_reason":null}]}

data: {"id":"chatcmpl-bc-42","object":"chat.completion.chunk","created":1700000000,"model":"default","choices":[{"index":0,"delta":{"content":"Tuesday "},"finish_reason":null}]}

...

data: {"id":"chatcmpl-bc-42","object":"chat.completion.chunk","created":1700000000,"model":"default","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

If the client disconnects mid-stream, no further chunks are written
(the cycle continues to completion server-side; the partial isn't
replayed).

##### Usage on stream

Set `stream_options.include_usage: true` to receive a final usage-only
chunk before `[DONE]`, matching OpenAI's spec.

```json
{
  "model": "default",
  "messages": [{"role":"user","content":"hi"}],
  "stream": true,
  "stream_options": {"include_usage": true}
}
```

Final two events:

```
data: {"id":"chatcmpl-bc-42","object":"chat.completion.chunk","created":1700000000,"model":"default","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: {"id":"chatcmpl-bc-42","object":"chat.completion.chunk","created":1700000000,"model":"default","choices":[],"usage":{"prompt_tokens":1234,"completion_tokens":256,"total_tokens":1490}}

data: [DONE]
```

The usage chunk has `choices: []` and only sends on successful cycles
(error paths surface `finish_reason: "error"` and skip the usage frame).

### `POST /v1/bajaclaw/cycle`

Native endpoint. Returns the full `CycleOutput` shape; useful when you
want cycle id, cost, the exact assembled prompt, the spawned command
line, etc.

Request:

```json
{
  "profile": "default",
  "task": "what's on my plate today",
  "dryRun": false
}
```

Response:

```json
{
  "cycleId": 142,
  "ok": true,
  "text": "Three open tasks: ...",
  "model": "claude-sonnet-4-6",
  "tier": "sonnet",
  "durationMs": 1200,
  "costUsd": 0.0012,
  "inputTokens": 1234,
  "outputTokens": 256,
  "turns": 3,
  "prompt": "(the assembled prompt for this cycle, as sent to claude)",
  "command": ["claude", "-p", "...", "--model", "claude-sonnet-4-6", "--setting-sources=local", "--strict-mcp-config", "--no-session-persistence", "..."],
  "source": "api"
}
```

Same lightweight-mode semantics apply: this endpoint resolves outbound
auth via the same path as `/v1/chat/completions`.

`dryRun: true` runs the full pipeline (memory recall, skills, MCP
assembly, prompt build) but skips the backend call. Returns
`text: "[dry-run] no exec"` and the assembled command. Useful for
testing prompt shape without spending tokens.

### `POST /v1/bajaclaw/tasks`

Enqueue a task into the profile's tasks table and return immediately.

Request:

```json
{
  "profile": "default",
  "task": "check the Grafana latency board",
  "priority": "normal"
}
```

`priority`: `"high"` | `"normal"` | `"low"`. High-priority tasks jump
the queue when the daemon (or any cycle-runner on this profile) calls
`popTask`.

Response:

```json
{"status": "enqueued"}
```

Status: `202 Accepted`. The task is durable (SQLite). It will be picked
up the next time something runs a cycle for that profile (usually the
heartbeat daemon).

Use this when you want to fire-and-forget tasks at a long-running
profile without blocking on the cycle.

---

## Model selection

The `model` field in a Chat Completions request is parsed into a
`(profile, modelOverride?)` pair. The parser is in
`src/api/translate.ts` (`resolveRequest`).

### All accepted forms

| `model` value | profile resolved | model override | what runs |
|---|---|---|---|
| `default` | `default` | none | profile's configured model |
| `bajaclaw:default` | `default` | none | same, namespaced |
| `research` | `research` | none | any profile name works |
| `default:auto` | `default` | `auto` | force auto-routing this request |
| `default:claude-haiku-4-5` | `default` | haiku | force haiku |
| `default:claude-sonnet-4-6` | `default` | sonnet | force sonnet |
| `default:claude-opus-4-7` | `default` | opus | force opus |
| `research:claude-opus-4-7` | `research` | opus | force opus on `research` profile |
| `bajaclaw:research:claude-sonnet-4-6` | `research` | sonnet | same, namespaced |
| `auto` | `default` | `auto` | shortcut: default profile, auto-routed |
| `claude-opus-4-7` | `default` | opus | shortcut: default profile, force opus |
| `claude-haiku-4-5` | `default` | haiku | shortcut: default profile, force haiku |

The override is one-shot: it overrides the profile's configured model
for that request only. The profile config is **not modified** on disk.

If the resolved profile doesn't exist on this box, the server returns
`404` with `{"error": {"message": "unknown profile: <name>"}}`.

### Known model IDs

| id | tier | notes |
|---|---|---|
| `auto` | (router) | routes per task: heartbeat -> haiku, short -> haiku, opus markers -> opus, otherwise sonnet |
| `claude-haiku-4-5` | haiku | fast, cheap; triage and simple answers |
| `claude-sonnet-4-6` | sonnet | balanced default |
| `claude-opus-4-7` | opus | planning, coding, deep research |

Other model strings are passed through verbatim to the `claude --model`
flag. The CLI validates against your subscription / API access.

### `auto` routing

When the effective model is `auto` (either because the profile is
configured that way or because the request used `auto`), the picker in
`src/model-picker.ts` runs:

1. **Heartbeat?** -> haiku. (Heartbeat tasks are the daemon's empty
   wake-up cycles; not normally a thing for API requests.)
2. **Opus markers** in the task (`plan`, `architect`, `design`,
   `refactor`, `debug` etc.) -> opus.
3. **Short and trivial** task (under ~6 words, no code/markup) -> haiku.
4. **Very short** (under ~3 words) -> haiku.
5. Otherwise -> sonnet.

Token "in" reporting is correct across tiers (sums input +
cache_creation + cache_read). Cost reporting is correct across tiers
(cache reads are priced cheap).

### Forcing a model per request

Even if a profile is configured for `auto`, you can pin a model for a
single request:

```bash
# pin opus for one request, leaving the profile's config alone
curl http://localhost:8765/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "default:claude-opus-4-7",
    "messages": [{"role":"user","content":"design a rate limiter"}]
  }'
```

```bash
# heavy task, force opus on a different profile
curl http://localhost:8765/v1/chat/completions \
  -d '{
    "model": "research:claude-opus-4-7",
    "messages": [{"role":"user","content":"compare these three vendors"}]
  }'
```

```bash
# trivial task on default, route via auto (will pick haiku)
curl http://localhost:8765/v1/chat/completions \
  -d '{
    "model": "auto",
    "messages": [{"role":"user","content":"what time is it"}]
  }'
```

---

## Errors

Standard HTTP statuses + an OpenAI-shaped error body.

```json
{"error": {"message": "<text>", "type": "<category>"}}
```

| status | type | when |
|---|---|---|
| `400` | `invalid_request_error` | malformed JSON, missing `messages`, missing required field |
| `401` | `invalid_request_error` | missing or wrong `Authorization: Bearer` (only when inbound `apiKey` is set) |
| `404` | `invalid_request_error` | unknown profile or unknown path |
| `500` | `server_error` | unexpected exception inside the handler |

Cycle-level failures (e.g., upstream Anthropic 401, rate limit, model
timeout) come back inside a successful HTTP response with
`finish_reason: "error"` and the error text in the message content;
HTTP status is still `200`. Check `finish_reason`, not just the status.

---

## Per-request cycle behavior

Each request runs the full BajaClaw pipeline, not a stateless LLM call.
Be aware of:

- **Memory:** the profile's recalled memories prepend to the task as
  context. Prior conversations shape responses. For a stateless API
  surface, point at a profile with `memorySync: false` and prune
  `memories` periodically (or use a dedicated profile for the API and
  another for chat).
- **Skills:** the skills index is injected into the prompt. The agent
  can invoke skills via the `skill_view` MCP tool.
- **MCP servers:** the profile's MCP servers (and optionally desktop
  MCP, if `mergeDesktopMcp: true`) are attached. The agent has access
  to whatever tools they expose.
- **Cycle history:** every API request creates a row in `cycles` with
  `source: "api"`. Visible in the dashboard's Cycles view, queryable
  via the BajaClaw MCP server, etc.
- **Cost:** every request bills against your subscription (or
  configured 3P account). Use the `/v1/bajaclaw/cycle` endpoint or
  `stream_options.include_usage` to see per-request cost / token
  numbers.

---

## Client recipes

### curl: simple request

```bash
curl http://localhost:8765/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "default",
    "messages": [{"role":"user","content":"hello"}]
  }'
```

### curl: streaming

```bash
curl -N http://localhost:8765/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "default",
    "messages": [{"role":"user","content":"walk me through yesterday"}],
    "stream": true
  }'
```

### curl: streaming + usage

```bash
curl -N http://localhost:8765/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "default:claude-sonnet-4-6",
    "messages": [{"role":"user","content":"what changed in main this week"}],
    "stream": true,
    "stream_options": {"include_usage": true}
  }'
```

### curl: with inbound auth

```bash
curl http://localhost:8765/v1/chat/completions \
  -H 'authorization: Bearer your-inbound-secret' \
  -H 'content-type: application/json' \
  -d '{"model":"default","messages":[{"role":"user","content":"hi"}]}'
```

### Python: openai SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8765/v1",
    api_key="ignored-or-your-inbound-secret",  # the SDK requires a string; ignored if no inbound apiKey
)

# Sync
r = client.chat.completions.create(
    model="default",
    messages=[{"role": "user", "content": "hello"}],
)
print(r.choices[0].message.content)
print(r.usage)  # populated: prompt_tokens, completion_tokens, total_tokens

# Pin opus for one request
r = client.chat.completions.create(
    model="default:claude-opus-4-7",
    messages=[{"role": "user", "content": "design a rate limiter"}],
)

# Streaming
stream = client.chat.completions.create(
    model="default",
    messages=[{"role": "user", "content": "walk me through yesterday"}],
    stream=True,
    stream_options={"include_usage": True},
)
for chunk in stream:
    if chunk.choices and chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
    if chunk.usage:
        print(f"\nusage: {chunk.usage}")
```

### Node.js: openai SDK

```js
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:8765/v1",
  apiKey: "ignored-or-your-inbound-secret",
});

// Sync
const r = await client.chat.completions.create({
  model: "default",
  messages: [{ role: "user", content: "hello" }],
});
console.log(r.choices[0].message.content);
console.log(r.usage);

// Streaming
const stream = await client.chat.completions.create({
  model: "default",
  messages: [{ role: "user", content: "walk me through yesterday" }],
  stream: true,
  stream_options: { include_usage: true },
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
  if (chunk.usage) console.log("\nusage:", chunk.usage);
}
```

### LangChain (Python)

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    model="default",                        # any bajaclaw model string
    base_url="http://localhost:8765/v1",
    api_key="ignored-or-your-inbound-secret",
    temperature=0,                          # ignored by bajaclaw, fine to pass
)

print(llm.invoke("summarize the last cycles").content)
```

### LlamaIndex

```python
from llama_index.llms.openai_like import OpenAILike

llm = OpenAILike(
    model="default:claude-sonnet-4-6",
    api_base="http://localhost:8765/v1",
    api_key="ignored-or-your-inbound-secret",
    is_chat_model=True,
)

print(llm.complete("hello").text)
```

### Continue.dev

In `~/.continue/config.json`:

```json
{
  "models": [
    {
      "title": "BajaClaw default",
      "provider": "openai",
      "apiBase": "http://localhost:8765/v1",
      "model": "default",
      "apiKey": "ignored-or-your-inbound-secret"
    },
    {
      "title": "BajaClaw research (opus)",
      "provider": "openai",
      "apiBase": "http://localhost:8765/v1",
      "model": "research:claude-opus-4-7",
      "apiKey": "ignored-or-your-inbound-secret"
    }
  ]
}
```

### Cursor

Settings -> Models -> Override OpenAI Base URL. Set:

- Base URL: `http://localhost:8765/v1`
- Model: `default` (or any bajaclaw model string)
- API Key: any non-empty string (or your inbound bearer token)

### Open WebUI

Settings -> Connections -> OpenAI API. Add:

- API Base URL: `http://localhost:8765/v1`
- API Key: any string (or your inbound bearer token)

The model dropdown will populate from `/v1/models`. Pick a profile or
profile:model entry.

### LibreChat

In `librechat.yaml`:

```yaml
endpoints:
  custom:
    - name: "BajaClaw"
      apiKey: "ignored-or-your-inbound-secret"
      baseURL: "http://localhost:8765/v1"
      models:
        default: ["default", "default:claude-opus-4-7", "auto"]
        fetch: true
      titleConvo: true
      titleModel: "default:claude-haiku-4-5"
```

---

## Headless deployment

`bajaclaw serve` is a long-running foreground process. It's separate
from the BajaClaw heartbeat daemon (`bajaclaw daemon`). You can run
either or both.

### Pre-stage auth

Before deploying headless, mint a token on a TTY:

```bash
bajaclaw setup-token   # one-time, persists to ~/.bajaclaw/api.json
```

After this, `bajaclaw serve` can run from launchd / systemd / cron with
no interactive prompt.

### macOS (launchd)

`~/Library/LaunchAgents/com.bajaclaw.serve.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.bajaclaw.serve</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/bajaclaw</string>
    <string>serve</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/bajaclaw-serve.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/bajaclaw-serve.err</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.bajaclaw.serve.plist
```

### Linux (systemd, user unit)

`~/.config/systemd/user/bajaclaw-serve.service`:

```ini
[Unit]
Description=BajaClaw OpenAI-compatible HTTP server
After=network.target

[Service]
ExecStart=/usr/local/bin/bajaclaw serve
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now bajaclaw-serve.service
journalctl --user -u bajaclaw-serve -f
```

### pm2

```bash
pm2 start "bajaclaw serve" --name bajaclaw-serve
pm2 save
pm2 startup           # follow the printed instructions to make persistent
```

### nginx reverse proxy (TLS + LAN exposure)

```nginx
server {
  listen 443 ssl http2;
  server_name bajaclaw.your-domain.tld;

  ssl_certificate     /etc/letsencrypt/live/bajaclaw.your-domain.tld/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/bajaclaw.your-domain.tld/privkey.pem;

  client_max_body_size 8m;

  location / {
    proxy_pass http://127.0.0.1:8765;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    # Streaming
    proxy_buffering off;
    proxy_read_timeout 1h;
    proxy_send_timeout 1h;
    proxy_set_header Connection "";
  }
}
```

Pair with `bajaclaw serve --api-key <secret>` so the public endpoint
demands a bearer token.

### Caddy

```
bajaclaw.your-domain.tld {
    reverse_proxy 127.0.0.1:8765 {
        flush_interval -1     # disable buffering for SSE
        transport http {
            read_timeout 1h
            write_timeout 1h
        }
    }
}
```

---

## CORS

Every response carries permissive CORS headers:

```
access-control-allow-origin: *
access-control-allow-methods: GET,POST,OPTIONS
access-control-allow-headers: authorization,content-type
```

`OPTIONS` requests return `204` immediately (preflight handler).

If you want a tighter policy (per-origin, restricted methods, etc.),
terminate at nginx or Caddy and rewrite headers there. The bajaclaw
server itself doesn't expose a CORS-policy knob.

---

## Performance and limits

- **Per-profile FIFO.** `runCycle` serializes by profile via
  `serialize(profile, ...)` in `src/concurrency.ts`. Two API requests
  for `default` queue. Two requests for `default` + `research` run in
  parallel.
- **Cycle deadline.** Each cycle has a backstop deadline of
  `cycleTimeoutMs * 10` (default 100 minutes per cycle). Stuck cycles
  free the queue head after that. `cfg.cycleTimeoutMs` is the per-
  profile inactivity timeout (default 10 min).
- **No throughput rate-limiter.** Add one in front (nginx, Caddy)
  before exposing the API broadly. Each request equals one full
  backend call and one `claude` subprocess.
- **Memory growth.** Every API request adds a row to `cycles` and may
  add memories via the post-cycle extractor. Long-lived profiles will
  grow. `bajaclaw compact` consolidates memories; pruning `cycles` is
  manual.

---

## Caveats and known gaps

- **No tool/function calling in the contract.** The agent uses tools
  internally; the API returns the final assistant content only.
  `tools` and `tool_choice` request fields are silently ignored.
- **Pre-v0.21.4 cycles** stored `usage: {0,0,0}`. Old cycles in the
  database don't have token counts; new cycles do.
- **Fresh sessions are not free.** Every API request still runs the
  full BajaClaw pipeline (recall, skills, MCP, extract). For a truly
  stateless service, configure a profile with `memorySync: false` and
  prune the `memories` table periodically.
- **No SSE keep-alive ping.** If a cycle takes minutes, intermediaries
  may close the idle TCP connection. Reverse-proxy timeouts above are
  set to 1h; tune your client too.
- **Lightweight mode and 3P providers.** Lightweight flags don't block
  3P provider routing (Bedrock, Vertex, Foundry). If you've configured
  `claude` to use a 3P provider via env vars or settings, that path
  keeps working.
- **The OpenAI endpoint and the daemon are independent.** `bajaclaw
  daemon` runs the heartbeat loop and channel adapters; `bajaclaw
  serve` runs the HTTP API. Run either, both, or neither.

---

## Troubleshooting

| symptom | likely cause | fix |
|---|---|---|
| Every request returns text "API Error: 401 Invalid authentication credentials" | no Anthropic key in scope | `bajaclaw setup-token`, or `export ANTHROPIC_API_KEY=...` |
| `404 unknown profile: <name>` | profile doesn't exist or isn't in `exposedProfiles` allowlist | `bajaclaw profile list`; remove from `exposedProfiles` or create the profile |
| `401 missing bearer token` on every request | inbound `apiKey` set but client isn't sending it | add `Authorization: Bearer <key>` header |
| `refusing to bind 0.0.0.0 without an API key` at startup | binding non-localhost without auth | pass `--api-key <secret>` |
| Streaming hangs, no partial output | reverse proxy buffering | set `proxy_buffering off` (nginx) / `flush_interval -1` (Caddy) |
| `usage` keeps coming back zeros | Haiku-tier cycle, or stream client disconnected before completion | use sonnet/opus, or check that the stream completes |
| Server starts but every cycle fails fast | likely outbound auth bad; check the spawned `claude` command | `POST /v1/bajaclaw/cycle` returns the exact `command` array; run it manually |

For deeper debugging:

- `~/.bajaclaw/profiles/<profile>/logs/YYYY-MM-DD.jsonl` has structured
  cycle logs (`cycle.start`, `cycle.stage`, `cycle.fail`, `cycle.ok`).
- The dashboard's Cycles view shows full request/response/error per
  cycle, including the assembled prompt.
