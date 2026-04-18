---
name: daily-briefing
description: Produce a concise morning briefing covering schedule, priorities, and open threads
version: 0.1.0
tools: [Read]
triggers: ["daily briefing", "morning update", "standup"]
effort: medium
---

## Instructions

Produce a briefing with these sections:
1. **Top of mind** - 1-3 items the user should know before anything else.
2. **Today's schedule** - if calendar data is available, list blocks with time + title.
3. **Waiting on others** - threads where the ball is in someone else's court.
4. **Follow-ups due** - items the user promised to do and hasn't yet.

Keep the whole thing under 250 words. Lead with what changed since yesterday.
Do not invent items. If you have no data for a section, omit it silently.
