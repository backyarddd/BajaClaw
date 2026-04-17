# Changelog

## 0.2.0

- Auto-update: `bajaclaw update` checks the npm registry (or a configured raw
  URL) and installs the newer version. A one-line notice appears after any
  command when an update is available.
- ASCII banner: shown in `bajaclaw doctor` and `bajaclaw banner`.
- Renamed `CLAUDE.md` → `AGENT.md` across templates. The cycle loader still
  falls back to `CLAUDE.md` for profiles created under 0.1.x.
- De-branded prose and code comments. The CLI backend is referred to by its
  binary name (`claude`) or as "the CLI backend"; no product-name references.
- New docs: `commands.md`, `troubleshooting.md`, `faq.md`, `security.md`,
  `contributing.md`. `claude-integration.md` renamed to `integration.md`.
- `delegateCoding` replaces `delegateToClaudeCode` (old name kept as alias).

## 0.1.0 — initial release

- 13-step cycle loop driving the `claude` CLI as a subprocess
- SQLite + FTS5 memory store with pre-cycle recall and post-cycle extract
- Cross-platform scheduler: launchd / systemd-user / crontab / schtasks
- MCP consumer: merges the desktop MCP config + profile + agent configs
- MCP server: resources for profiles/agents/memories/cycles/schedules, tools
  for memory search / task creation / agent status / skill list
- Skills system: six scopes, shared format with other agent tooling
- Two-way memory sync with `~/.claude/memory/` (opt-in)
- Sub-agent delegation helper for coding-heavy work
- Agent templates: outreach / research / support / social / code / custom
- Dashboard (single HTML, vanilla + Tailwind CDN)
- Channel adapters: Telegram + Discord (optional, opt-in)
- Profiles with per-profile DB, logs, skills, MCP config
- `bajaclaw migrate --from-yonderclaw <dir>` (strips unwanted artifacts)
