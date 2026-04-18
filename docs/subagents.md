# Sub-agents

A sub-agent is a separate BajaClaw profile that an orchestrator delegates
to. The orchestrator plans and routes; the sub-agent does the scoped
work.

This is how you build the pattern: **main agent can't read your email,
but its `mail` sub-agent can — and the main knows to ask**. Permissions
are physical, not policy: if the orchestrator doesn't have a tool or an
MCP server in its config, it literally cannot use that capability.

## The model

```
 ┌────────────────┐    delegate("check inbox")    ┌─────────────┐
 │  main agent    │ ────────────────────────────▶ │  mail agent │
 │  (orchestrator)│                                │  (scoped)   │
 │                │ ◀──── stdout text response ─── │             │
 │ allowedTools:  │                                │ allowedTools│
 │ Read, Write,   │                                │ Read, Bash  │
 │ Edit, Bash,    │                                │ + email MCP │
 │ Grep, Glob,    │                                │             │
 │ WebSearch      │                                │             │
 │ (no email MCP) │                                │             │
 └────────────────┘                                └─────────────┘
```

The main has everything **except** email. The sub-agent has email only.
The main can delegate, but can't read email directly.

## Creating a sub-agent

```
bajaclaw subagent create mail \
  --parent default \
  --template custom \
  --allowed-tools "Read,Write,Bash" \
  --disallowed-tools "Edit" \
  --description "Reads and drafts email. Never sends without approval."
```

This scaffolds:
- `~/.bajaclaw/profiles/mail/` with its own DB, skills, config
- `parent: "default"` in the child's `config.json`
- `subAgents: ["mail"]` added to `default`'s `config.json`
- The `--description` is appended to the child's `SOUL.md` as its purpose

Then give it its own MCP config (for email access, etc.) by editing
`~/.bajaclaw/profiles/mail/mcp-config.json` or porting from the desktop:

```
bajaclaw mcp port --names gmail
```

And — critically — **remove** the email MCP from the main profile's MCP
config so the orchestrator can't use it directly. That's what makes the
isolation real.

## Listing

```
bajaclaw subagent list                # whole tree across all profiles
bajaclaw subagent list default        # just the children of one parent
```

## Delegation

The orchestrator delegates via Bash. The `delegate-to-subagent` built-in
skill (auto-loaded when present) teaches the orchestrator when to do
this:

```
# The main agent, in a cycle, runs this via Bash:
bajaclaw delegate mail "check inbox for anything from Alice in the last 24h"

# The sub-agent runs one cycle with its own tools + memory + persona.
# The response text comes back on stdout.
# The orchestrator reads that, uses it in its own reply.
```

The response is just text — clean for piping. Pass `--json` if you want
the full `CycleOutput` (cycle id, cost, timing, command argv).

## Permission patterns

### Sensitive read-only data (email, calendar)
- Main: no email/calendar MCP, no auth tokens
- Sub: the MCP servers + Read tool, no Write

### Payment / trading APIs
- Main: no financial MCPs
- Sub: financial MCPs + no autonomous Bash, requires review

### Local file system scopes
- Main: Read on `~/Documents`, no `~/Private`
- Sub: Read on `~/Private`

### Arbitrary external services
- One sub-agent per service. Token for that service lives in that
  profile's MCP config only.

## Each sub-agent is independent

- Own SQLite DB, own memory table, own FTS recall
- Own skill scopes (inherits nothing from the parent)
- Own `config.json`, `AGENT.md`, `SOUL.md`, `HEARTBEAT.md`
- Own `persona` — set one with `bajaclaw persona --edit --profile mail`

If you want context to flow, pass it explicitly in the delegation
string. Or enable memory sync (`memorySync: true`) on both profiles
with a shared `~/.claude/memory/` digest — but that crosses boundaries,
so think before enabling.

## Self-service

The built-in guide:

```
bajaclaw guide subagent
```

prints the full setup walkthrough. The orchestrator will match that
guide itself when you ask things like "create a mail subagent" — so
you can talk to your main agent in plain language and it will know how
to spin up a scoped helper.
