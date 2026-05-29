# Changelog

All notable changes to BajaClaw are documented here.

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
