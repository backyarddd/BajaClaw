# Changelog

## 0.4.0

- **Skill isolation**: BajaClaw no longer reads `~/.claude/skills/` or
  `.claude/skills/` automatically. Skill scopes are now BajaClaw-only
  (agent, profile, user-global, built-in). Prevents cross-tool skill
  collisions.
- **MCP isolation**: BajaClaw no longer auto-merges the desktop CLI's
  MCP config on every cycle. It uses `~/.bajaclaw/mcp-config.json` instead.
  Opt back in with `"mergeDesktopMcp": true` in a profile's config.json.
- **`bajaclaw skill port`**: copy or symlink skills from `~/.claude/skills/`
  (or any source) into BajaClaw's scope. Per-skill or all-at-once, into
  user / profile / agent scope.
- **`bajaclaw mcp port`**: copy MCP servers from the desktop CLI config
  into `~/.bajaclaw/mcp-config.json`. BajaClaw's own entry is skipped.
- **Auto-skill synthesis**: after any cycle that uses 5+ tools (configurable),
  BajaClaw analyzes the task + tool sequence + response and — if the
  procedure is reusable — writes a structured `SKILL.md` with When-to-use /
  Quick-reference / Procedure / Pitfalls / Verification sections to
  `~/.bajaclaw/skills/auto/<name>/`. Frontmatter is marked
  `auto_generated: true` with a `source_cycle_id`. Configure via
  `autoSkill` in profile config.
- **`bajaclaw skill promote <name>`**: move an auto-generated candidate
  from `~/.bajaclaw/skills/auto/<name>/` into `~/.bajaclaw/skills/<name>/`.
- Docs: expanded `docs/skills.md` and `docs/integration.md` to cover the
  new isolation model, port commands, and auto-skill workflow.

## 0.3.0

- **Packaged install**: `npm install -g create-bajaclaw` auto-runs `bajaclaw
  setup` (via `postinstall` hook) to create the default profile, write the
  agent descriptor, and register the MCP server. No profile name to pick.
- **`bajaclaw setup`**: idempotent bootstrap. Safe to rerun at any time to
  repair integrations (MCP registration, agent descriptor) without touching
  existing data.
- **`bajaclaw uninstall`**: full teardown. Stops daemons, removes OS
  scheduler entries, removes agent descriptors, removes the MCP registration,
  removes memory sync files, and (unless `--keep-data`) removes `~/.bajaclaw/`.
  Requires `--yes` to actually apply.
- **Default profile**: `bajaclaw start` with no arguments now targets the
  `default` profile, auto-bootstrapping it on first use if missing. Override
  with `BAJACLAW_DEFAULT_PROFILE`.
- **Full tool access**: the `research`, `outreach`, `support`, `social`, and
  `custom` templates now ship without tool restrictions — agents can Write,
  Edit, and run Bash. The `code` template keeps its orchestrator pattern
  (read-only, delegates to sub-agent). Existing profiles are unaffected.
- **README**: comprehensive rewrite covering what the cycle does, the full
  Claude Code integration (agent descriptors, shared skills scopes, MCP
  consume/expose, memory sync, sub-agent delegation), auto-update, setup /
  uninstall, on-disk layout, safety, and the full command reference.
- **`create-bajaclaw`**: with no arguments, runs `setup`. With a name,
  scaffolds a new named profile via `init`.

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
