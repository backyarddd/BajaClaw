# PRODUCT.md - BajaClaw

register: product

## What it is
BajaClaw is a self-hosted personal AI agent. One person runs it on their own
machine. The web UI is the control room: chat with the agent, watch what it's
doing, manage channels/cron/skills/memory, run Cowork outcome tasks, pick which
LLM powers it, and review self-update proposals.

## Who uses it
A technical individual running BajaClaw locally (often a Mac mini that stays on).
Single user. They open the UI on localhost. They care about: starting fast,
seeing status at a glance, and trusting that nothing happens without consent
(self-update proposals, account login).

## Design serves the product
This is a tool, not a marketing page. Clarity and low cognitive load win over
decoration. The UI must feel calm, fast, and legible during long sessions, and
make the agent's activity transparent.

## Brand identity (committed - preserve)
"Baja desert at golden hour." Warm amber primary + teal/sea secondary on a clean
surface. This identity is already committed in the CLI (amber wordmark, teal
accents, wave/dune motif). The web UI must match it so CLI and UI feel like one
product. Amber carries energy/action; teal carries success/health/calm.

## Must-have surfaces
Chat · Sessions · Activity/monitor · Channels · Cron · Skills · Memory browser ·
Cowork tasks · Providers & login · Local OpenAI endpoint status · Self-update
proposals · Settings.

## Non-negotiables
- Distinct from OpenClaw's dashboard look.
- Clean and simple: the default view is chat + status, everything else one click away.
- Accessible contrast, keyboard-friendly, reduced-motion support.
