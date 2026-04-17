---
name: configure-tools
description: Edit the allowed and disallowed tool list for a BajaClaw profile
version: 0.1.0
tools: [Read, Edit, Write]
triggers: ["allowed tools", "disallowed tools", "restrict tools", "tool access", "tool permissions", "toolbox", "allow write", "disable bash"]
effort: low
---

## When to use
User wants to tighten or loosen the tools an agent can call — e.g. remove
`Bash` from a research agent, or add `Write` to a support agent that was
set up read-only.

## Quick reference
- Stored in `~/.bajaclaw/profiles/<profile>/config.json`:
  - `allowedTools`: string[] — passes to `claude --allowedTools`
  - `disallowedTools`: string[] — passes to `claude --disallowedTools`
- Defaults come from the template (see `src/commands/init.ts`).
- Standard tool names: `Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob`,
  `WebSearch`, `WebFetch`. Plus any MCP tools you've configured.

## Procedure
1. Show the current state: open
   `~/.bajaclaw/profiles/<profile>/config.json` and find the `allowedTools`
   and `disallowedTools` fields.
2. Decide which way they want to go:
   - **Tighten** (deny specific tools): add them to `disallowedTools`.
     Example: `"disallowedTools": ["Bash"]`.
   - **Loosen** (allow only specific tools): set `allowedTools` to a
     concrete list. Anything not in the list is forbidden.
   - **Full access**: remove both fields entirely (or set to `[]`).
3. Save the file. Changes take effect on the next cycle — no daemon
   restart needed.
4. Verify with a dry-run: `bajaclaw start <profile> --dry-run` and check
   the `command:` line for `--allowedTools` / `--disallowedTools` flags.

## Pitfalls
- Both fields can be set together. `allowedTools` is an allowlist;
  `disallowedTools` is a denylist applied within that allowlist.
- The MCP tools inherited from merged config are subject to the same
  restrictions. Add the MCP tool name if you want to block one specifically.
- `code`-template agents have read-only tools by design — they delegate
  writes to a sub-agent via `delegateCoding`. Don't lift those unless you
  know you want the orchestrator itself writing code.

## Verification
- `bajaclaw start <profile> --dry-run` shows the expected flags in the
  `command:` line.
- A cycle confirms the agent respects the restriction — check cycle logs
  for tool use events matching only permitted tools.
