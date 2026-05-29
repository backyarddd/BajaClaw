# DESIGN.md - BajaClaw web UI

register: product · surface serves the tool, not the other way around

## Scene sentence
A technical person, alone, at a desk, lamp-lit room, running their agent on a
Mac mini that never sleeps. They glance at this for status and type to it for
work. Calm, legible, fast. Light theme - it lives next to a code editor in
daylight as often as night, and the brand warmth carries the mood, not a dark
shell.

## Color strategy: Restrained (tinted neutrals + amber + teal)
OKLCH throughout. Pure-ish white surface; warmth lives in the brand colors and
type, not the background (per impeccable: don't tint bg AND primary).

- `--bg`      oklch(0.995 0.002 70)  near-pure white, a hair of warmth
- `--surface` oklch(0.985 0.004 70)  raised panels
- `--ink`     oklch(0.22 0.02 60)    body text (>= 4.5:1 on bg)
- `--muted`   oklch(0.50 0.02 60)    secondary text (checked for contrast)
- `--line`    oklch(0.90 0.01 70)    hairline borders
- `--amber`   oklch(0.72 0.16 65)    primary: action, brand, energy
- `--amber-ink` oklch(0.42 0.13 55)  amber text on light (contrast-safe)
- `--teal`    oklch(0.70 0.11 195)   secondary: health, success, calm
- `--teal-ink`  oklch(0.45 0.09 200) teal text on light
- `--danger`  oklch(0.58 0.20 25)    errors only

## Type
- Display/UI: system-ui stack, tuned with weight + tracking (offline-first local
  tool: no runtime font fetch). Hierarchy via scale (>=1.25 steps) + weight.
- Mono: ui-monospace for status values, ports, versions, logs (HUD feel).
- Body line length capped ~70ch. `text-wrap: balance` on headings.

## Signature details (the 120% touches)
- A subtle "dune wave" motif (the ≈ from the CLI) as the brand mark and as a
  thin animated rule on the active nav item - ties UI to CLI.
- Status dots use teal (healthy) / amber (attention) / danger, never decorative.
- One well-orchestrated load: nav + panels settle in a short staggered fade
  (respects prefers-reduced-motion → instant).

## Anti-slop guardrails (enforced)
- No purple gradients, no gradient text, no glassmorphism, no emoji icons.
- No side-stripe left-border cards. No identical icon+title+text card grids.
- No per-section uppercase eyebrows. Icons only where they carry meaning.
- Real status from config/health; honest placeholders where data needs the
  running gateway (clearly labeled, not fake numbers).

## Distinct from OpenClaw
OpenClaw's dashboard is a Lit app, denser/cooler. BajaClaw is a warm,
light, restrained control room with a left rail + status strip + focused
main panel. Different layout spine, different palette, different motif.
