# Heartbeat Schedule

Edit this file with one schedule per line in the format:
`<cron> | <task>`

Examples:
- `*/15 * * * * | Check pending tasks.`
- `0 9 * * *    | Run daily briefing.`
- `0 17 * * 5   | Weekly summary and plan for next week.`

On first daemon boot, BajaClaw parses this file and stores entries in the DB.
