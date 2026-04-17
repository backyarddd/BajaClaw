# Heartbeat

The heartbeat is the cadence on which an agent wakes up with nothing to do and
decides what's worth doing.

## Two sources

- **Scheduled**: entries in `HEARTBEAT.md` installed into the OS scheduler.
- **Triggered**: external events via `bajaclaw trigger <event>` or inbound
  messages from configured channels.

## HEARTBEAT.md format

One line per entry:

```
<cron> | <task>
```

Example:

```
*/15 * * * * | Check for pending tasks.
0 9 * * *    | Produce the morning briefing.
0 17 * * 5   | Summarize the week and draft next week's plan.
```

On daemon install (`bajaclaw daemon install <profile>`), the line `*/15 * * * *`
is installed into the OS-native scheduler:

- macOS: launchd plist in `~/Library/LaunchAgents/`
- Linux: systemd user unit or crontab
- Windows: schtasks entry

Each heartbeat runs `bajaclaw start <profile>`, which picks up the next pending
task. Deeper schedule entries can be written into the DB for future expansion.

## Supervision

`bajaclaw daemon run` is a supervised foreground loop with exponential backoff
on crash (1s → 5min). `bajaclaw daemon start` backgrounds this and writes a pid
file; `stop`/`restart`/`status`/`logs` operate on it.
