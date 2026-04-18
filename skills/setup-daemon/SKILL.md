---
name: setup-daemon
description: Start, stop, inspect, and auto-install the BajaClaw heartbeat daemon
version: 0.1.0
tools: [Bash, Read]
triggers: ["daemon", "background run", "start daemon", "keep running", "run forever"]
effort: low
---

## When to use
User wants BajaClaw running in the background: reacting to inbound channel
messages, processing the task queue, and handling the OS scheduler's
heartbeat triggers.

## Quick reference
- Launcher: `bin/bajaclaw.js daemon …`
- Pid file: `~/.bajaclaw/profiles/<profile>/daemon.pid`
- Log: `~/.bajaclaw/profiles/<profile>/daemon.log`
- Supervisor loop: exponential backoff on crash, 1s → 5min.
- OS-scheduler entry: `daemon install` drops a plist/unit/cron/schtasks.

## Procedure
1. Start in foreground (debugging): `bajaclaw daemon start <profile> --fg`
2. Start backgrounded: `bajaclaw daemon start <profile>`
   - Writes pid file; detaches; unrefs.
3. Check status: `bajaclaw daemon status <profile>`
   - `running (pid N)` or `stale pid N` or `stopped`.
4. Tail logs: `bajaclaw daemon logs <profile> --lines 100`
5. Restart: `bajaclaw daemon restart <profile>`
6. Stop: `bajaclaw daemon stop <profile>` (SIGTERM + pid cleanup).
7. Auto-start on login: `bajaclaw daemon install <profile>` - creates a
   `*/15 * * * *` OS-scheduler entry that invokes `bajaclaw start <profile>`.

## Pitfalls
- Two daemons per profile are not supported. `start` detects a running pid
  and refuses.
- A stale pid file survives OS reboots occasionally. If `status` reports
  "stale", delete the pid file and retry.
- The OS-scheduler entry installed by `daemon install` runs `bajaclaw
  start` (a one-shot cycle), not the supervisor loop itself. For a long-
  running supervisor, use `daemon start`. Use both together for
  belt-and-suspenders.

## Verification
- `bajaclaw daemon status <profile>` → `running (pid N)`
- `bajaclaw daemon logs <profile>` → cycle events
- After OS-scheduler install: `crontab -l` / `launchctl list` /
  `schtasks /Query` / `systemctl --user list-timers` shows a `bajaclaw-*`
  entry.
