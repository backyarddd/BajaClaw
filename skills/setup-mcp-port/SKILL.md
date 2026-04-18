---
name: setup-mcp-port
description: Port MCP servers from the desktop CLI into BajaClaw's isolated MCP config
version: 0.1.0
tools: [Bash, Read, Edit]
triggers: ["port mcp", "copy mcp", "setup mcp", "mcp servers", "import mcp", "share mcp", "use desktop mcp"]
effort: low
---

## When to use
User has MCP servers configured for their desktop CLI (Filesystem, GitHub,
Slack, Google Drive, etc.) and wants BajaClaw cycles to use them too.

## Quick reference
- BajaClaw MCP is isolated by default. Desktop MCP config is not inherited.
- User-global BajaClaw MCP lives at `~/.bajaclaw/mcp-config.json`.
- Profile-scoped: `~/.bajaclaw/profiles/<profile>/mcp-config.json`.
- Agent-scoped: `~/.bajaclaw/profiles/<profile>/agent-mcp-config.json`.
- Merge order per cycle: agent > profile > user > desktop (desktop only
  with `mergeDesktopMcp: true` in profile config).

## Procedure
1. Preview what's on the desktop side:
   `bajaclaw mcp port --list`
2. Port every server (except BajaClaw's own self-reference):
   `bajaclaw mcp port`
3. Or port a specific subset:
   `bajaclaw mcp port --names filesystem github`
4. To overwrite existing BajaClaw entries:
   `bajaclaw mcp port --force`
5. Confirm the result:
   `bajaclaw mcp list <profile>` - shows the merged view for that profile.

## Alternative: permanent auto-inherit
If the user wants every desktop MCP server auto-inherited on every cycle
(without an explicit port), edit the profile's config.json:
```json
{ "mergeDesktopMcp": true }
```
This reverts to the pre-0.4 behavior, per profile.

## Pitfalls
- BajaClaw's own `bajaclaw` MCP entry is always skipped during port - no
  self-references.
- Port copies the server entry verbatim, including `env` vars. If a desktop
  entry has env secrets, those travel with the port. Review before sharing
  the config file.
- `--force` overwrites entries with the same name. Use when updating a
  previously-ported entry.

## Verification
- `ls ~/.bajaclaw/mcp-config.json` exists and contains the expected entries
- A subsequent cycle shows the MCP tools available in `bajaclaw start --dry-run`
  output under the `--mcp-config` path
