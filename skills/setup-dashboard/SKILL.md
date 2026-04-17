---
name: setup-dashboard
description: Launch the BajaClaw dashboard and configure its port
version: 0.1.0
tools: [Bash, Read, Edit, Write]
triggers: ["dashboard", "web ui", "show ui", "open dashboard", "launch dashboard"]
effort: low
---

## When to use
User wants a browser-visible view of cycles, memories, schedules, and
tasks.

## Quick reference
- Single-page HTML at `src/dashboard.html`, vanilla JS + Tailwind CDN.
- Server: `src/commands/dashboard.ts`.
- Port: profile config's `dashboardPort` (default 7337).
- Data: read directly from the profile's SQLite DB via `/api/*` routes.

## Procedure
1. Run: `bajaclaw dashboard <profile>` (profile defaults to `default`).
2. Open http://localhost:7337/ in a browser.
3. To change the port: edit
   `~/.bajaclaw/profiles/<profile>/config.json` and set
   `"dashboardPort": <N>`. Restart the command.

## Pitfalls
- If port 7337 is taken, the server will fail to bind. Change the port or
  free it.
- The dashboard is a raw HTTP server with no auth. Only bind it to
  localhost (default behavior). Don't expose it to a LAN without a proxy +
  auth in front.
- Refresh happens every 5s. If the tab sits open for days, the browser
  keeps the connection pool tight — not a bug, just a long-run caveat.

## Verification
- `curl -s http://localhost:<PORT>/api/summary` returns JSON including the
  profile name.
- Browser tab at `/` shows the cycles panel populated after any cycle runs.
