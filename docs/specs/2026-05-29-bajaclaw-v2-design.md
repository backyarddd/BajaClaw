# BajaClaw v2 - Design Spec

Date: 2026-05-29
Status: Approved (brainstorming → implementation)

## One-liner

A self-hosted, all-in-one personal AI agent. OpenClaw's spine (auth, channels,
gateway), Hermes's self-improving brain, Cowork's outcome mode - with
ChatGPT-subscription login as the default LLM, a clean custom web UI, a local
OpenAI-compatible endpoint, and a one-command `bajaclaw start`. Published to
npm/GitHub; every user logs in with their own ChatGPT (or any other) account.

## Goals

- Best-of-all-worlds agent: OpenClaw + Hermes + Cowork in one.
- Default LLM = ChatGPT OAuth (Codex subscription backend). All other providers
  stay available (Anthropic, Gemini, OpenRouter, Ollama, LM Studio, API keys).
- Daily self-update: watch upstreams, propose approve-to-merge upgrades.
- Local OpenAI-compatible endpoint so other programs use this as a local LLM.
- Clean, simple, distinctive web UI (huashu-design + impeccable + frontend-design).
- CLI visuals deliberately different from OpenClaw's.
- Dead-simple, seamless onboarding.
- `bajaclaw start` brings everything up after a reboot. Daemon = gateway.
- Single-user personal use (ToS-safe ChatGPT-OAuth), but distributable OSS.

## Non-goals

- Multi-account pooling / reselling ChatGPT access (ToS violation).
- Vendoring OpenClaw's full source monorepo (disk-heavy; native mobile apps).
- Fully autonomous unattended auto-merge of upstream code (unsafe).

## Key constraint discovered

Host disk is ~98% full (~5.5 GiB free). This rules out a full OpenClaw source
fork (multi-GB node_modules + iOS/Android/macOS apps). Architecture is therefore
a **thin overlay**: consume `openclaw` via npm + its plugin SDK, layer our value
as plugins + a separate UI client + a branded CLI wrapper.

## Architecture - thin overlay

```
bajaclaw (npm, v1.0.0 - major rewrite of bajaclaw@0.21.x)
│
├── core dependency: openclaw (npm, ~79 MB unpacked)
│     → gateway + auth, ~40 providers incl. openai-codex (ChatGPT OAuth),
│       channels, cron, MCP, subagents, base memory & skills.
│
├── src/cli/          branded CLI + commands (onboard, start, stop, status, doctor, update)
├── src/onboarding/   seamless wizard, ChatGPT-OAuth default, all providers kept
├── src/daemon/       gateway lifecycle via launchd (macOS) - `bajaclaw start`
├── src/config/       config layer; provider defaults & precedence
│
├── plugins/hermes-brain     self-improving vector memory + learn-from-outcome skills
├── plugins/cowork-mode      goal-in → finished-deliverable orchestration flow
├── plugins/self-updater     daily cron: diff openclaw+hermes, watch Cowork changelog,
│                            LLM-summarize, open approve-to-merge proposal
├── plugins/openai-endpoint  /v1/chat/completions + /v1/models local server
│
└── web/             fresh React SPA over OpenClaw gateway WebSocket protocol,
                     built with huashu-design + impeccable + frontend-design.
```

Why overlay: our code stays as OpenClaw extensions + a separate UI, so upstream
OpenClaw updates merge as a dependency bump - which is what makes the daily
self-updater feasible and keeps the disk footprint small.

## Components

### CLI (`bajaclaw`)
Commands:
- `bajaclaw onboard` - first-run wizard (or auto-run on first `start`).
- `bajaclaw start` - start gateway daemon + openai-endpoint; idempotent; the
  single command to run after a reboot.
- `bajaclaw stop` / `bajaclaw restart` / `bajaclaw status`.
- `bajaclaw doctor` - environment + health checks.
- `bajaclaw update` - run the self-updater proposal flow on demand.
- `bajaclaw ui` - open the web UI.
Visual identity distinct from OpenClaw: own ASCII wordmark, own color palette
(warm amber/teal vs OpenClaw's), own spinner/box style, own status glyphs.

### Onboarding
- One screen, sensible defaults. Default provider = ChatGPT OAuth; a single
  "Sign in with ChatGPT" step (Codex device/PKCE flow). "More options" reveals
  Anthropic / Gemini / OpenRouter / Ollama / LM Studio / API-key entry.
- Writes config, offers to install the launchd daemon, prints next steps.
- Goal: from `npx bajaclaw` to a running agent in under a minute.

### Daemon (gateway)
- macOS launchd plist `com.bajaclaw.gateway`. `bajaclaw start` loads it; survives
  reboot via RunAtLoad. Replaces old bajaclaw's three plists.

### openai-endpoint
- Local HTTP server: `POST /v1/chat/completions` (stream + non-stream),
  `GET /v1/models`, `GET /health`. Translates to the configured backend
  (default: the agent/gateway; can target codex/openai-compatible directly).
- Bind to 127.0.0.1 by default (personal, ToS-safe). Configurable port.

### Plugins
- hermes-brain: vector memory store of task outcomes; skill synthesis from
  repeated successes; conforms to OpenClaw plugin SDK (`registerTool`).
- cowork-mode: a flow that takes a goal, plans, executes across tools/files,
  returns a finished deliverable; surfaces progress to the UI.
- self-updater: cron tool; checks GitHub releases (openclaw, NousResearch/
  hermes-agent) + fetches Cowork (Anthropic) changelog; LLM-summarizes
  worthwhile changes; writes a proposal file + notifies; never auto-merges.

### Web UI
- React + Vite SPA. Clean & simple, all features: chat, sessions, channels,
  cron, skills, memory browser, cowork tasks, providers/login, settings,
  self-update proposals. Connects to gateway over WebSocket.
- Designed via huashu-design (hi-fi, anti-AI-slop) + impeccable rules +
  frontend-design. Distinct visual language from OpenClaw's Lit dashboard.

## Auth model (ToS)

Ship the login flow; each installer uses their **own** account. Single-account
personal use of the ChatGPT/Codex subscription backend is semi-officially
blessed. We do NOT pool accounts, resell, or expose the backend to third
parties. Endpoint binds to localhost by default.

## Old BajaClaw teardown (authorized, recoverable)

Recoverable: `~/bajaclaw` git remote `github.com/backyarddd/BajaClaw.git` (no
unpushed commits) + npm `bajaclaw@0.21.7` + `~/Desktop/bajaclaw-pre-rewrite-backup`.
Ordered teardown (run LAST, after v2 exists):
1. `launchctl bootout` the 3 LaunchAgents (serve, service.heartbeat, lm.heartbeat).
2. `npm rm -g bajaclaw`; remove `/opt/homebrew/bin/bajaclaw` symlink if dangling.
3. Delete `~/bajaclaw`, `~/.bajaclaw`, `~/Desktop/bajaclaw`,
   `~/Desktop/bajaclaw-pre-rewrite-backup`, `~/Pictures/bajaclaw-staging`,
   `~/Downloads/bajaclaw-prompt.md`, `~/.Trash/bajaclaw`.
4. Remove `~/.claude/projects/*bajaclaw*` transcript dirs.
5. Scrub the 3 bajaclaw memory files + MEMORY.md index lines; replace with a v2 note.
Note: `~/.bajaclaw/api.json` holds credentials - deletion is intended.

## Build order

core scaffold & branded CLI → config/provider defaults → onboarding (ChatGPT
OAuth default, all providers) → daemon + `bajaclaw start` → openai-endpoint →
hermes-brain → cowork-mode → self-updater → web UI (huashu+impeccable) →
install impeccable into harness → smoketest → teardown old BajaClaw → rundown.

## Smoketest plan

- `bajaclaw --version`, `--help`, `doctor`, `status` run clean.
- openai-endpoint: `GET /v1/models`, `GET /health`, `POST /v1/chat/completions`
  (mock backend) returns OpenAI-shaped JSON + SSE stream.
- self-updater: live GitHub release fetch for openclaw + hermes returns versions
  and writes a proposal file.
- onboarding: dry-run prints the wizard and writes a sample config.
- web UI: `vite build` succeeds; serves; renders shell.
- launchd plist validates (`plutil -lint`).

## Risks

- ChatGPT OAuth requires the user's interactive browser login - cannot be
  completed autonomously; onboarding drives it, user finishes it.
- Codex backend is undocumented (no SLA); can change. Mitigated by keeping all
  other providers available.
- Disk pressure: avoid heavy installs; teardown frees ~310 MB headroom.
