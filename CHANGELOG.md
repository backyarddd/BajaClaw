# Changelog

All notable changes to BajaClaw are documented here.

## 1.1.0

Bigger, more usable.

### Added
- **Extensive onboarding.** `bajaclaw onboard` is now a guided wizard: primary
  model, fallback providers, the local API (and bare-mode default), channel
  setup (Telegram/Discord tokens), feature toggles, and the boot daemon. Every
  step has an Enter-to-accept default.
- **Control API** on the gateway (`/api/status`, `/api/config`, `/api/providers`,
  `/api/channels`, `/api/memory`, `/api/skills`, `/api/updates`, `/api/cowork`)
  so the web dashboard is fully functional.
- **Functional web dashboard.** Every view now does real work: set the default
  provider and add API keys, enable channels and set tokens, search and clear
  memory, browse learned skills, run Cowork goals, check for updates, toggle
  features and the endpoint mode, and watch live activity over SSE.
- **More CLI commands:** `ask`, `chat`, `cowork`, `providers`, `login`,
  `logout`, `channels`, `memory`, `skills`, `config` (get/set), `logs`, and
  `uninstall`.

## 1.0.0

Complete ground-up rewrite. BajaClaw is now a standalone, all-in-one personal AI
agent that depends on no external agent framework.

### Added
- Native multi-provider LLM client: ChatGPT (Codex subscription backend),
  OpenAI, Anthropic, Gemini, OpenRouter, Groq, DeepSeek, Ollama, LM Studio,
  with automatic fallback between configured providers.
- Native "Sign in with ChatGPT" PKCE OAuth flow and a per-provider credential
  store under `~/.bajaclaw/auth/`.
- Native agent loop with memory recall and outcome logging.
- Native gateway (health + live SSE event stream) and a one-command
  `bajaclaw start` that runs as a launchd daemon and restores after reboot.
- Local OpenAI-compatible endpoint (`/v1/chat/completions`, `/v1/models`,
  `/health`) on port 11435 so other programs can use BajaClaw as a local LLM.
- Bare mode for the local endpoint: the `bajaclaw-raw` model (or
  `openaiEndpoint.mode: "raw"`) streams straight from the configured provider
  with no system prompt, memory, logging, or tools.
- Native messaging channels: Telegram and Discord (working), with scaffolds for
  Slack, WhatsApp, and iMessage.
- Self-improving memory store with skill synthesis (Hermes-inspired).
- Cowork outcome mode: describe a goal, get a finished deliverable.
- Daily self-update watcher that proposes upstream features to merge, never
  auto-merging.
- React web control room (chat, activity, channels, schedules, skills, memory,
  models and login, local API, updates, settings).
- Branded CLI with its own visual identity and a smoketest suite.

### Notes
- This release replaces the 0.21.x line, which was an OpenClaw-based daemon.
- The ChatGPT subscription backend is reverse-engineered and has no SLA. Use your
  own account only; do not pool or resell access.
