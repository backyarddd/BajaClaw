# BajaClaw

A standalone, all-in-one personal AI agent. Inspired by OpenClaw, Hermes, and
Cowork, but dependent on none of them. **ChatGPT-subscription login as the
default model**, a clean web control room, native messaging channels, a local
**OpenAI-compatible endpoint**, and a one-command start.

```
  ┌╶╶╶╮
  ╿ BAJACLAW  ≈≈≈
  the all-in-one personal agent
```

## Install

```bash
npm install -g bajaclaw
bajaclaw onboard      # one screen: sign in with ChatGPT (or pick any other LLM)
bajaclaw start        # starts the gateway daemon + web UI + local API + channels
```

No second package required. After a reboot, just run `bajaclaw start` again. On
macOS the gateway is installed as a launchd daemon, so it also comes back on its
own.

## Commands

| Command | What it does |
|---|---|
| `bajaclaw onboard` | First-run setup. ChatGPT by default; all other LLMs available. |
| `bajaclaw start` | Start everything (gateway + OpenAI endpoint + web UI + channels). |
| `bajaclaw stop` / `restart` | Control the daemon. |
| `bajaclaw status` | Health at a glance. |
| `bajaclaw ui` | Open the web interface. |
| `bajaclaw update` | Check inspiration sources and write an approve-to-merge proposal. |
| `bajaclaw doctor` | Environment + health checks. |

## Models

ChatGPT (via your subscription) is the default, signed in natively with PKCE
OAuth. Every other provider stays available with automatic fallback: Anthropic,
Gemini, OpenRouter, OpenAI API, Ollama, LM Studio, Groq, DeepSeek. You log in
with **your own** account; nothing is pooled or shared.

## Local OpenAI endpoint

Point any OpenAI client at BajaClaw to use it as a local LLM. It runs every
request through BajaClaw's native agent (your configured provider).

```
Base URL: http://127.0.0.1:11435/v1
Models:   bajaclaw, bajaclaw-chatgpt, bajaclaw-fast
```

```bash
curl http://127.0.0.1:11435/v1/chat/completions \
  -H "content-type: application/json" \
  -d '{"model":"bajaclaw","messages":[{"role":"user","content":"hi"}]}'
```

Binds to localhost only by default (single-user, personal use). Port 11435 keeps
11434 free for Ollama.

## Channels

Reach BajaClaw where you already chat. Enable a channel and add its token in
onboarding or `~/.bajaclaw/config.json`, then `bajaclaw restart`.

- **Telegram**, **Discord**: native, working (pure HTTP / built-in WebSocket).
- **Slack**, **WhatsApp**, **iMessage**: scaffolded with a clear native path.

## Self-update

A daily watcher diffs OpenClaw and Hermes and snapshots the Cowork changelog,
then writes a proposal to `~/.bajaclaw/updates/`. They are inspiration sources,
not dependencies; nothing is merged without your approval.

## How it fits together (all native)

```
bajaclaw (standalone)
├── src/llm           native multi-provider client (ChatGPT/Codex, OpenAI,
│                     Anthropic, Gemini, OpenRouter, Groq, DeepSeek, Ollama, LM Studio)
├── src/auth          native ChatGPT OAuth (PKCE) + credential store
├── src/agent         agent loop: provider fallback + memory recall + outcome logging
├── src/daemon        gateway (health + SSE events), UI server, launchd daemon
├── channels/         native Telegram/Discord (+ Slack/WhatsApp/iMessage scaffolds)
├── plugins/hermes-brain    self-improving memory + skill synthesis
├── plugins/cowork-mode     goal in, finished deliverable out
├── plugins/self-updater    daily inspiration watcher (propose, never auto-merge)
├── plugins/openai-endpoint local /v1 OpenAI-compatible server
└── web/              React control room (served on :18790)
```

## Develop

```bash
npm run smoketest     # exercises every module
npm run ui:build      # build the web UI
node bin/bajaclaw.mjs --help
```

## License

MIT
