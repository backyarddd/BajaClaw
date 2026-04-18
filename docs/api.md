# HTTP API

BajaClaw can expose itself as an OpenAI-compatible HTTP endpoint. Any
client that speaks the OpenAI chat API — Cursor, Open WebUI, LibreChat,
LangChain, LlamaIndex, curl, the `openai` SDKs — can drive BajaClaw as if
it were an LLM. Each request is a full BajaClaw cycle: memory recall,
skill matching, MCP inheritance, the backend call, post-cycle extract.

## Starting the server

```
bajaclaw serve                                    # 127.0.0.1:8765, no auth
bajaclaw serve --port 9000                        # custom port
bajaclaw serve --api-key <secret>                 # require bearer auth
bajaclaw serve --host 0.0.0.0 --api-key <secret>  # bind all interfaces (auth required)
bajaclaw serve --expose default research          # only these profiles
bajaclaw serve --stream-delay 10                  # faster streamed chunks
```

Non-localhost binds without an API key are refused.

## Persistent config

Instead of CLI flags, put defaults at `~/.bajaclaw/api.json`:

```json
{
  "host": "127.0.0.1",
  "port": 8765,
  "apiKey": "your-long-secret",
  "exposedProfiles": ["default"],
  "streamDelayMs": 20
}
```

CLI flags override the file.

## Endpoints

### `GET /health`

Liveness probe. Returns `{"status": "ok"}`.

### `GET /v1/models`

Lists exposed BajaClaw profiles as OpenAI-format model entries.

```json
{
  "object": "list",
  "data": [
    {"id": "default", "object": "model", "created": 1700000000, "owned_by": "bajaclaw"},
    {"id": "researcher", "object": "model", "created": 1700000000, "owned_by": "bajaclaw"}
  ]
}
```

### `POST /v1/chat/completions`

OpenAI ChatCompletion. Non-streaming or SSE streaming.

**Request:**

```json
{
  "model": "default",
  "messages": [
    {"role": "user", "content": "summarize the last three cycles"}
  ],
  "stream": false
}
```

The `model` field is a BajaClaw profile name. Optionally prefix with
`bajaclaw:` (`"model": "bajaclaw:default"`) for clarity.

Message handling:
- If one message is provided, its content is the task.
- If multiple messages are provided, earlier messages are rendered as a
  prior transcript, and the last message is the current task.
- System / user / assistant / tool roles all render with labels.

**Non-streaming response:**

```json
{
  "id": "chatcmpl-bc-42",
  "object": "chat.completion",
  "created": 1700000000,
  "model": "default",
  "choices": [
    {
      "index": 0,
      "message": {"role": "assistant", "content": "…"},
      "finish_reason": "stop"
    }
  ],
  "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
}
```

**Streaming response (`"stream": true`):**

Server-Sent Events with standard OpenAI `chat.completion.chunk` shape:

```
data: {"id":"chatcmpl-bc-42","object":"chat.completion.chunk","created":...,"model":"default","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl-bc-42","object":"chat.completion.chunk","created":...,"model":"default","choices":[{"index":0,"delta":{"content":"Hello "},"finish_reason":null}]}

…

data: {"id":"chatcmpl-bc-42","object":"chat.completion.chunk","created":...,"model":"default","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

Note: pseudo-streamed in v0.6 — the full cycle runs, then the response is
chunked out. True token-streaming is on the roadmap.

### `POST /v1/bajaclaw/cycle`

Native endpoint. Runs a cycle, returns the full `CycleOutput`.

**Request:**

```json
{
  "profile": "default",
  "task": "what's on my plate today",
  "dryRun": false
}
```

**Response:**

```json
{
  "cycleId": 42,
  "ok": true,
  "text": "…",
  "durationMs": 1200,
  "costUsd": 0.0012,
  "prompt": "(the assembled prompt for this cycle)",
  "command": ["claude", "-p", "…", "--model", "claude-sonnet-4-6", "…"]
}
```

Use this when you want the cycle id, cost, and assembled prompt — not
just the chat-shaped reply.

### `POST /v1/bajaclaw/tasks`

Enqueue a task without waiting. Returns 202 immediately.

**Request:**

```json
{"profile": "default", "task": "check the Grafana latency board", "priority": "normal"}
```

**Response:**

```json
{"status": "enqueued"}
```

The next cycle (heartbeat or on-demand) picks it up.

## Auth

If `apiKey` is set in config or via `--api-key`, every request (except
`/health`) must carry `Authorization: Bearer <key>`. Anything else returns
`401`.

Non-localhost binds (`--host 0.0.0.0` or a real interface) require an API
key — the server refuses to start without one.

## CORS

Every response carries permissive CORS headers (`*`). If you want a
tighter policy, run behind nginx or Caddy.

## Client examples

### Python (`openai` SDK)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8765/v1",
    api_key="your-secret-or-any-string",  # required by the SDK, ignored if no server-side key
)

r = client.chat.completions.create(
    model="default",
    messages=[{"role": "user", "content": "hello"}],
)
print(r.choices[0].message.content)
```

### Node.js (`openai` SDK)

```js
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:8765/v1",
  apiKey: "your-secret-or-any-string",
});

const r = await client.chat.completions.create({
  model: "default",
  messages: [{ role: "user", content: "hello" }],
});
console.log(r.choices[0].message.content);
```

### curl streaming

```
curl -N http://localhost:8765/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "default",
    "messages": [{"role": "user", "content": "walk me through yesterday"}],
    "stream": true
  }'
```

### Cursor / Open WebUI / LibreChat / Tool of choice

Point the tool's "OpenAI-compatible" settings at
`http://localhost:8765/v1`. Use any exposed profile name as the "model".
If the tool requires an API key field, put any string — BajaClaw ignores
it unless you've enabled auth.

## Running under a supervisor

`bajaclaw serve` is a long-running foreground process. Options:

- **launchd/systemd/pm2**: wrap it so it auto-starts and restarts on
  crash. BajaClaw's own daemon (`bajaclaw daemon`) is separate — it
  handles the heartbeat loop, not the HTTP API.
- **nginx/Caddy reverse proxy**: put TLS in front, add rate limits, map
  to a subdomain. BajaClaw only needs an inbound HTTP connection.

## Caveats

- Every request = one full cycle = one backend call. Rate-limit in front
  if you expose the API broadly.
- BajaClaw's memory, skills, and MCP servers apply to every API request.
  Callers are not fresh sessions — prior memory shapes responses. For a
  stateless service, use a profile with `memorySync: false` and prune
  the memories table periodically.
- No function/tool calling in the ChatCompletion contract yet. The agent
  uses tools internally; the API returns the final assistant content.
- `tools` and `tool_choice` fields in the request are ignored in v0.6.
