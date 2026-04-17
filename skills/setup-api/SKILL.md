---
name: setup-api
description: Expose BajaClaw as an OpenAI-compatible HTTP endpoint for external clients
version: 0.1.0
tools: [Bash, Read, Write, Edit]
triggers: ["api endpoint", "openai api", "http api", "expose api", "serve bajaclaw", "llm endpoint", "openai compatible", "bajaclaw server", "base_url", "connect cursor", "connect langchain"]
effort: medium
---

## When to use
The user wants to call BajaClaw from anything that speaks the OpenAI chat
API — Cursor, Open WebUI, LangChain, LlamaIndex, curl, a python script, a
web app. They'll point the client at `http://localhost:8765/v1` and
treat BajaClaw as an LLM.

## Quick reference
- Start: `bajaclaw serve` (binds 127.0.0.1:8765 by default)
- Endpoints:
  - `GET /v1/models` — lists BajaClaw profiles as model ids
  - `POST /v1/chat/completions` — OpenAI chat (stream + non-stream)
  - `POST /v1/bajaclaw/cycle` — native full CycleOutput
  - `POST /v1/bajaclaw/tasks` — enqueue a task without waiting
  - `GET /health` — liveness
- Auth: optional bearer token via `--api-key <secret>` or
  `api.apiKey` in `~/.bajaclaw/api.json`.
- Non-localhost bind requires an API key (refuses otherwise).

## Procedure

### 1. Start the server
```
bajaclaw serve                              # default: 127.0.0.1:8765
bajaclaw serve --port 9000                  # custom port
bajaclaw serve --api-key $(openssl rand -hex 32)   # with auth
bajaclaw serve --host 0.0.0.0 --api-key <secret>   # bind all interfaces (auth required)
bajaclaw serve --expose default research    # allowlist specific profiles
```

### 2. Hit it from any OpenAI-compatible client

**curl:**
```
curl http://localhost:8765/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "default",
    "messages": [{"role": "user", "content": "summarize my last three cycles"}]
  }'
```

**python `openai` SDK:**
```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:8765/v1", api_key="any")
r = client.chat.completions.create(
    model="default",
    messages=[{"role": "user", "content": "hello"}],
)
print(r.choices[0].message.content)
```

**Cursor / VSCode / Open WebUI / LibreChat / etc.**
Point their "OpenAI-compatible" settings at `http://localhost:8765/v1`
and use any profile name as the "model".

### 3. Streaming
Add `"stream": true` to the request. The server runs the cycle to
completion, then streams the response as OpenAI-format SSE
`chat.completion.chunk` events (word-grouped, small inter-chunk delay).
Each request is a full cycle — memory recall, skill matching, MCP
inheritance, post-cycle extract — then the result is chunked out.

### 4. Persist the config (optional)
Instead of CLI flags, put defaults in `~/.bajaclaw/api.json`:
```json
{
  "host": "127.0.0.1",
  "port": 8765,
  "apiKey": "your-long-secret",
  "exposedProfiles": ["default"],
  "streamDelayMs": 20
}
```
`bajaclaw serve` picks it up automatically; CLI flags override it.

### 5. Run it under the daemon or a service manager
Pair with `bajaclaw daemon` for the heartbeat, and wrap `bajaclaw serve`
with launchd/systemd/pm2 if you want the HTTP API to stay up across
restarts. It's a long-running foreground process.

## Pitfalls
- **Non-localhost binds require an API key.** The server refuses to
  bind 0.0.0.0 or a real interface without one. This is the default
  protection — don't disable it.
- Each API request = one full cycle = one backend call. That bills
  against the `claude` CLI's subscription/credits. Consider rate
  limiting in front (an nginx/caddy proxy is easy).
- Model name in the request maps to a profile. Unknown profile → 404
  with `{"error": {"message": "unknown profile: <x>"}}`. Use
  `/v1/models` to see what's available.
- The streaming is pseudo-streaming: the full cycle runs before the
  first chunk is emitted. Clients won't see real token-by-token
  streaming in this release.
- BajaClaw's memory, skills, and MCP servers apply to every API
  request — they're not a "fresh" chat. If a caller expects stateless
  completions, their results will still be influenced by BajaClaw's
  accumulated memory. This is a feature, not a bug.

## Verification
- `curl http://localhost:8765/health` returns `{"status": "ok"}`.
- `curl http://localhost:8765/v1/models` lists the exposed profiles.
- A non-streaming chat request returns a proper OpenAI
  ChatCompletion with `choices[0].message.content` populated.
- A streaming request produces a series of `data: {...}` SSE lines
  ending with `data: [DONE]`.
