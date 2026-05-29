# Architecture

BajaClaw is a single standalone Node.js package (ESM). It runs a small set of
local services under one supervised daemon, plus a React web UI. Nothing depends
on an external agent framework.

```
bajaclaw (one npm package)
│
├── bin/bajaclaw.mjs        CLI: onboard, start, stop, restart, status, doctor,
│                           update, ui, and the internal _serve entry point
│
├── src/
│   ├── llm/client.mjs      native multi-provider client. One shared SSE reader;
│   │                       each provider is a request builder + a delta picker.
│   ├── auth/               ChatGPT OAuth (PKCE) + per-provider credential store
│   ├── agent/agent.mjs     agent loop: provider selection + fallback, memory
│   │                       recall, outcome logging
│   ├── config/config.mjs   single source of truth for paths, ports, defaults
│   ├── daemon/
│   │   ├── daemon.mjs      launchd lifecycle (install/start/stop/status)
│   │   ├── gateway.mjs     gateway: /health + /events (SSE) + an event bus
│   │   └── uiserver.mjs    static server for the built web UI
│   ├── onboarding/         the seamless first-run wizard
│   └── ui/theme.mjs        CLI visual identity
│
├── channels/               native messaging integrations + a manager that wires
│                           inbound messages to the agent and sends replies
│
├── plugins/                self-contained feature modules
│   ├── hermes-brain        memory store + skill synthesis
│   ├── cowork-mode         goal -> plan -> deliverable flow
│   ├── self-updater        daily upstream watcher (propose, never auto-merge)
│   └── openai-endpoint     local OpenAI-compatible HTTP server
│
└── web/                    React + Vite control room, built to web/dist and
                            served by the daemon
```

## The daemon

`bajaclaw start` installs and loads a launchd job (`com.bajaclaw.gateway`,
`RunAtLoad` true) that runs `bajaclaw _serve`. That single supervised process
starts four things:

1. **Gateway** (`:18789`) - health endpoint and a live SSE event stream the web
   UI subscribes to.
2. **Local OpenAI endpoint** (`:11435`) - the agent exposed as an OpenAI API.
3. **Web UI server** (`:18790`) - serves `web/dist`.
4. **Channels** - any enabled messaging channels.

All ports bind to `127.0.0.1` by default and are configurable.

## Request flow

A message (from the web UI, the local API, or a channel) becomes an OpenAI-style
message list and is handed to `src/agent/agent.mjs`:

1. Build the candidate provider list from `defaultProvider` + `providerOrder`,
   keeping only those that are configured.
2. Recall relevant past outcomes from the Hermes brain and add them as context.
3. Stream from the first working provider; on failure, fall through to the next.
4. On success, record the outcome to memory.

The web chat and the local OpenAI endpoint both call this same loop, so they
always behave identically.

## Providers

`src/llm/client.mjs` holds a `REGISTRY` describing each provider (kind, base URL,
default model). There are four adapter kinds:

- `openai-compat` - OpenAI, OpenRouter, Groq, DeepSeek, Ollama, LM Studio.
- `anthropic` - Claude Messages API.
- `google` - Gemini streaming API.
- `codex` - the ChatGPT subscription backend (Responses API + OAuth token).

All four share one SSE reader (`sseEvents`) and differ only in the request body
and a one-line "delta picker".

## State on disk

Everything lives under `~/.bajaclaw` (override with `BAJACLAW_HOME`):

```
~/.bajaclaw/
├── config.json         merged config (defaults + your overrides)
├── auth/<provider>.json credentials (mode 0600)
├── memory/brain.jsonl  long-term memory
├── updates/            self-update proposals
└── logs/               daemon logs
```
