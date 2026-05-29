# BajaClaw

An all-in-one personal AI agent. The spine of [OpenClaw](https://github.com/openclaw/openclaw)
(auth, channels, gateway), a self-improving Hermes-style brain, and Cowork-style
outcome mode, with **ChatGPT-subscription login as the default model**, a clean
web control room, a local **OpenAI-compatible endpoint**, and a one-command start.

```
  ┌╶╶╶╮
  ╿ BAJACLAW  ≈≈≈
  the all-in-one personal agent
```

## Install

```bash
npm install -g bajaclaw openclaw
bajaclaw onboard      # one screen: sign in with ChatGPT (or pick any other LLM)
bajaclaw start        # starts the gateway daemon + web UI + local API
```

After a reboot, just run `bajaclaw start` again. On macOS the gateway is installed
as a launchd daemon, so it also comes back on its own.

## Commands

| Command | What it does |
|---|---|
| `bajaclaw onboard` | First-run setup. ChatGPT by default; all other LLMs available. |
| `bajaclaw start` | Start everything (gateway daemon + OpenAI endpoint + web UI). |
| `bajaclaw stop` / `restart` | Control the daemon. |
| `bajaclaw status` | Health at a glance. |
| `bajaclaw ui` | Open the web interface. |
| `bajaclaw update` | Check upstreams and write an approve-to-merge proposal. |
| `bajaclaw doctor` | Environment + health checks. |

## Models

ChatGPT (via your subscription) is the default. Every other provider stays
available with automatic fallback: Anthropic, Gemini, OpenRouter, OpenAI API,
Ollama, LM Studio, Groq, DeepSeek. You log in with **your own** account; nothing
is pooled or shared.

## Local OpenAI endpoint

Point any OpenAI client at BajaClaw to use it as a local LLM:

```
Base URL: http://127.0.0.1:11434/v1
Models:   bajaclaw, bajaclaw-chatgpt, bajaclaw-fast
```

```bash
curl http://127.0.0.1:11434/v1/chat/completions \
  -H "content-type: application/json" \
  -d '{"model":"bajaclaw","messages":[{"role":"user","content":"hi"}]}'
```

Binds to localhost only by default (single-user, personal use).

## Self-update

A daily watcher diffs OpenClaw and Hermes and snapshots the Cowork changelog,
then writes a proposal to `~/.bajaclaw/updates/`. Nothing is merged without your
approval.

## How it fits together

```
bajaclaw (this package)
├── openclaw            gateway + auth + channels + ~40 providers (the daemon)
├── plugins/hermes-brain    self-improving memory + skill synthesis
├── plugins/cowork-mode     goal in, finished deliverable out
├── plugins/self-updater    daily upstream watcher (propose, never auto-merge)
├── plugins/openai-endpoint local /v1 OpenAI-compatible server
└── web/                React control room (served on :18790)
```

## Develop

```bash
npm run smoketest     # exercises every module
npm run ui:build      # build the web UI
node bin/bajaclaw.mjs --help
```

## License

MIT
