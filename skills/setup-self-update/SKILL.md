---
name: setup-self-update
description: Check for and install a new BajaClaw version, or configure the update channel
version: 0.1.0
tools: [Bash, Read]
triggers: ["update bajaclaw", "upgrade bajaclaw", "new version", "auto update", "check updates", "silence update notice"]
effort: low
---

## When to use
User wants to update BajaClaw, see what version they're on, or silence the
update-available notice.

## Quick reference
- Check + install: `bajaclaw update`
- Current version: `bajaclaw --version`
- Cache: `~/.bajaclaw/.update-check.json` (24h TTL)
- Silence notice: `BAJACLAW_NO_UPDATE_NOTICE=1`
- Channels: npm registry (primary) + optional GitHub raw fallback
  configured in `package.json` → `bajaclaw.updateUrl`.

## Procedure
1. Check delta without installing: `bajaclaw update --check`
2. Apply: `bajaclaw update --yes`
   - Installed via npm `-g`: runs `npm install -g bajaclaw@latest`.
   - Installed from a git clone: runs `git pull && npm install && npm run build`.
3. Silence the post-command notice (e.g. in scripts):
   export `BAJACLAW_NO_UPDATE_NOTICE=1` in the shell config.
4. To force a fresh check (bypassing the 24h cache):
   `rm ~/.bajaclaw/.update-check.json && bajaclaw update --check`

## Pitfalls
- If `npm install -g` requires sudo on their system, the update will fail
  silently. Ask them to retry with their node-version manager active or
  fix the npm prefix.
- Network unavailable → silent fail, but the CLI still works. Retry later.

## Verification
- `bajaclaw --version` reports the new version.
- Update notice disappears after a successful apply.
