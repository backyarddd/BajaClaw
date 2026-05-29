# Design

BajaClaw is a tool, not a marketing site, so the interface serves the work:
calm, legible, and fast during long sessions, with the agent's activity visible
at a glance.

## Brand

"Baja desert at golden hour." A warm amber primary with a teal/sea secondary on
a near-white surface. The warmth lives in the brand colors and type, not in a
tinted background. A dune-wave motif (the `≈` you also see in the CLI) ties the
web UI and the terminal together.

Colors are defined in OKLCH (`web/src/theme.css`):

- amber: action, brand, energy
- teal: health, success, calm
- ink/muted/line: a restrained neutral ramp on a near-white background

## Layout

A left rail groups the surfaces (chat and outcomes up top, then Workspace, then
System), a slim status strip shows live gateway and local-API health, and a
focused main panel holds the active surface. Chat is the default view; everything
else is one click away.

## Principles

- Distinct from other agent dashboards: a warm, light control room rather than a
  dense, cool one.
- Honest status and empty states. Health dots reflect real connections; surfaces
  that need the running daemon say so rather than showing fake data.
- Accessible by default: contrast-checked text, visible keyboard focus, and a
  `prefers-reduced-motion` path for every animation.
- No visual filler. No gradient text, glassmorphism, emoji icons, or
  decorative side-stripe cards. Icons appear only where they carry meaning.

## CLI

The terminal interface has its own identity: an amber wordmark with the dune
motif, diamond status glyphs (`◇ ◆ ◈ ◉`), left-rule panels, and a wave-cycle
spinner. It is deliberately different from the tools that inspired BajaClaw.
