# Security

## Threat model

BajaClaw runs locally, under the user's own account. The main risks are:

1. **Prompt injection** from untrusted inputs (inbound channel messages,
   web pages fetched during research, memory contents written by earlier
   cycles).
2. **Tool misuse** — an agent given too many tools doing something it
   shouldn't.
3. **Secret leakage** through logs or extracted memories.
4. **Supply-chain** drift via auto-update.

BajaClaw is not hardened against a malicious local user. If someone can
write to `~/.bajaclaw/`, they can do anything the agent can do.

## Mitigations in v0.2

- **Tool allowlist/denylist** per agent: `allowedTools` and `disallowedTools`
  in the profile config. Research agents ship read-only by default; code
  agents ship without Write/Edit/Bash (they delegate).
- **Circuit breaker** (5 failures → 15min cooldown) so a pathological loop
  stops quickly.
- **Rate limiter** (60 cycles/hour default).
- **Dry-run**: `bajaclaw start --dry-run` prints the exact prompt + argv
  without executing.
- **No shell string concat**: every `execa` call passes args as an array
  with `shell: false`.
- **Explicit confirmation for skill install**: requires `BAJACLAW_CONFIRM=yes`
  in the env and prints the full SKILL.md before writing.
- **Channel allowlists**: a telegram/discord channel with an empty
  allowlist accepts no messages.
- **Memory extraction** is scoped to the response text, not the full prompt
  — secrets you pass in don't get extracted back out.
- **Auto-update** uses the npm registry (HTTPS) by default and only installs
  when you run `bajaclaw update --yes` manually.

## Handling secrets

- Tokens for channel adapters are stored in `config.json` under the profile.
  Protect that file with OS permissions (`chmod 600` on POSIX).
- Environment variables passed to MCP servers live in the merged
  `.mcp-merged.json` — same permissions apply.
- JSONL logs contain task text and response previews (first 500 chars).
  Strip secrets from prompts before they reach BajaClaw if you're worried.

## Running less-trusted skills

- Skills only inject text into the system prompt. They don't execute code
  directly. But a hostile skill can instruct an agent to use its tools
  badly — don't install skills from sources you don't trust.
- Check the `tools` field in a SKILL.md frontmatter — that's what the skill
  author expects, not an enforced limit.

## Reporting a vulnerability

Open a GitHub security advisory on the repo. Describe the issue, the
impact, and a minimal reproduction. Avoid filing a public issue before a
fix lands.
