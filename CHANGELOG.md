# Changelog

## 0.1.0 — initial release

- 13-step cycle loop driving `claude -p` subprocess
- SQLite + FTS5 memory store with pre-cycle recall and post-cycle extract
- Cross-platform scheduler: launchd / systemd-user / crontab / schtasks
- MCP consumer: merges Claude Desktop + profile + agent configs
- MCP server: resources for profiles/agents/memories/cycles/schedules, tools
  for memory search / task creation / agent status / skill list
- Skills system: six scopes, Claude Code-compatible format
- Two-way Claude Code memory sync (opt-in)
- Sub-agent delegation helper for coding-heavy work
- Agent templates: outreach / research / support / social / code / custom
- Dashboard (single HTML, vanilla + Tailwind CDN)
- Channel adapters: Telegram + Discord (optional, opt-in)
- Profiles with per-profile DB, logs, skills, MCP config
- `bajaclaw migrate --from-yonderclaw <dir>` (strips QIS/Hive/branding)
