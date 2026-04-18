---
name: setup-heartbeat
description: Schedule a recurring heartbeat cycle via the OS-native scheduler
version: 0.1.0
tools: [Bash, Read, Write, Edit]
triggers: ["setup heartbeat", "schedule bajaclaw", "auto run", "cron", "daily cycle", "install heartbeat", "recurring task"]
effort: low
---

## When to use
The user wants BajaClaw to run on its own - daily briefing, periodic inbox
triage, background research - without them typing `bajaclaw start`.

## Quick reference
- Adapters: `src/scheduler/` - launchd (macOS), systemd-user or crontab
  (Linux), schtasks (Windows). `pickAdapter()` auto-selects.
- Entry: `bajaclaw daemon install <profile>` creates a `*/15 * * * *`
  heartbeat by default.
- Heartbeat tasks live in `HEARTBEAT.md` in the profile directory,
  line-separated as `<cron> | <task>`.
- Supervisor loop: `bajaclaw daemon start <profile>` (backgrounds itself).

## Procedure
1. Ask how often they want cycles to run. Common picks:
   - every 15 min: `*/15 * * * *` (default)
   - every hour: `0 * * * *`
   - daily at 9am: `0 9 * * *`
   - weekdays at 9am: `0 9 * * 1-5`
2. Ask what the heartbeat should do. "Check pending tasks" is a safe default.
3. Open `~/.bajaclaw/profiles/<profile>/HEARTBEAT.md` and add a line like:
   `0 9 * * * | Run the daily briefing and surface anything urgent.`
4. Run `bajaclaw daemon install <profile>` to register the OS scheduler
   entry. (This uses `*/15 * * * *` - adjust via the adapter's install call
   or by installing a custom cron entry manually.)
5. Run `bajaclaw daemon start <profile>` to start the supervisor loop. It
   auto-restarts with exponential backoff on crash.
6. Verify: `bajaclaw daemon status <profile>` shows a running pid.

## Pitfalls
- On Linux without a user systemd bus, the adapter falls back to crontab.
- launchd plists use a simplified cron → HH:MM conversion; complex cron
  expressions degrade to "first run" only.
- `schtasks` needs an interactive desktop session for the first run on some
  Windows configurations.
- If the daemon's pid file is stale (`bajaclaw daemon status` says "stale
  pid"), delete `~/.bajaclaw/profiles/<profile>/daemon.pid` and retry.

## Verification
- `bajaclaw daemon status <profile>` → `running (pid N)`
- `bajaclaw daemon logs <profile>` → periodic `cycle.ok` entries
- `bajaclaw status <profile>` → cycles count rising over time
