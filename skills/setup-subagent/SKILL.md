---
name: setup-subagent
description: Create a specialized sub-agent with its own tools and permissions, owned by an orchestrator
version: 0.1.0
tools: [Bash, Read, Write, Edit]
triggers: ["create subagent", "setup subagent", "new subagent", "add helper agent", "email agent", "mail agent", "calendar agent", "scope an agent"]
effort: medium
---

## When to use
The user wants a specialized helper agent with its own permissions that the
main agent can delegate to. Common cases: a "mail" agent with email MCP that
the main agent routes inbox tasks to; a "finance" agent that has access to
banking/budgeting tools the main doesn't.

## Quick reference
- Sub-agents are separate BajaClaw profiles with a `parent:` pointer.
- Parent's `config.json` gets a `subAgents: [...]` list.
- Each sub-agent has its own tools, memory, skills, persona, and MCP config.
- The parent invokes via `bajaclaw delegate <subagent> "<task>"`.
- Permission isolation is physical: the parent doesn't have the sub-agent's
  tools, so it literally cannot do the sub-agent's work.

## Procedure

### 1. Design the scope
Ask the user:
- **Name**: short, one-word (`mail`, `finance`, `research`, `scraper`)
- **What it does**: one-sentence purpose
- **What tools it needs**: e.g. `Read, Write, Bash` plus a specific MCP server
- **What tools it must NOT have**: things the parent shouldn't do either,
  or things scoped only to this agent

### 2. Create
```
bajaclaw subagent create <name> \
  --parent <main-profile> \
  --template custom \
  --allowed-tools Read,Write,Bash \
  --disallowed-tools Edit \
  --description "<one-line purpose>"
```

Any option can be omitted. Defaults: template=custom, tools=inherited.

### 3. Tighten MCP servers on the sub-agent (optional)
If the sub-agent owns a domain - say, email - you want its MCP config to
include the relevant server. Edit:
`~/.bajaclaw/profiles/<name>/mcp-config.json`

or port a specific server from the desktop config:
```
bajaclaw mcp port --names email-mcp
# then move it to the sub-agent's profile MCP file
```

Conversely: REMOVE the email MCP from the parent's MCP config so the
parent can't use it directly. That's what makes the isolation real.

### 4. Give the sub-agent its persona
```
bajaclaw persona --edit --profile <name>
```

Or edit `~/.bajaclaw/profiles/<name>/SOUL.md` directly. A tight persona
that describes exactly what the sub-agent does keeps its cycles on-task.

### 5. Confirm registration
```
bajaclaw subagent list <main-profile>
```

The new sub-agent should appear under the parent.

### 6. Test the delegation path
```
bajaclaw delegate <name> "say hi"
```

Should print a short response from the sub-agent.

From the main agent's perspective, the pattern becomes:
```
# In a main-agent cycle, when the task touches email:
# The agent runs this via Bash:
bajaclaw delegate mail "check inbox for anything from Alice"
```

## Pitfalls
- Sub-agents don't share memory with the parent. If you want a shared
  knowledge base, use `memorySync: true` plus careful routing.
- Don't over-fragment. One sub-agent per clear responsibility is plenty.
  A tree of 10 sub-agents with overlapping scopes is worse than none.
- The parent must know to delegate. Add the `delegate-to-subagent`
  built-in skill so its matcher picks up on the relevant user requests.

## Verification
- `bajaclaw subagent list` shows the parent → sub-agent tree.
- `~/.bajaclaw/profiles/<parent>/config.json` lists the sub-agent in
  `subAgents`.
- `~/.bajaclaw/profiles/<sub>/config.json` has `parent: "<parent>"`.
- A delegation test returns a non-empty response from the sub-agent.
