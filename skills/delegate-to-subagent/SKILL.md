---
name: delegate-to-subagent
description: Route a task to a specialized sub-agent when the main agent doesn't have the tools or permissions
version: 0.1.0
tools: [Bash, Read]
triggers: ["delegate", "ask the subagent", "hand off", "check my email", "look in my inbox", "look at my calendar", "check my messages", "read the file for me"]
effort: low
---

## When to use
You are the orchestrator. The user asked you to do something that requires
tools or access you do not have. A specialized sub-agent does have them.
Delegate the task to that sub-agent instead of trying it yourself or
refusing.

Signals that a task belongs to a sub-agent:
- It touches data you do not have an MCP server for (email, calendar,
  private file stores, a customer DB, etc.) but the user has told you a
  sub-agent owns that data.
- It is outside the scope of your `allowedTools` / `disallowedTools`.
- It is the kind of thing that happens often and the user has a named
  helper for it.

## Quick reference
- List sub-agents: `bajaclaw subagent list <your-profile>` (via Bash).
- Delegate: `bajaclaw delegate <subagent-name> "<task>"`.
- The sub-agent runs one cycle with its own tools, memory, and persona,
  then returns its final response text on stdout.
- You capture the response and use it in your own reply to the user.

## Procedure
1. Identify which sub-agent owns the capability. Ask yourself: *which
   tool does this task require?* If the sub-agent named in your config
   has that tool and you don't, delegate.
2. Phrase the task for the sub-agent. Be specific. Pass along whatever
   filter, range, or query the user gave you. Don't just forward the
   raw user message verbatim - rephrase if useful.
3. Run the delegation via Bash:
   ```
   bajaclaw delegate <subagent> "<specific task>"
   ```
4. Read the stdout response carefully. Summarize or quote back to the
   user as appropriate.
5. If the sub-agent's response contains sensitive data (account numbers,
   PII, auth tokens), follow your own don'ts - don't echo that verbatim
   in your reply. Summarize.

## Pitfalls
- Do NOT invoke `bajaclaw start <subagent>` to trigger a cycle for the
  sub-agent - that pulls from the sub-agent's queue, not your task.
  Use `bajaclaw delegate` instead.
- Do NOT loop: if the sub-agent fails, report the failure to the user.
  Don't retry indefinitely.
- Each delegation is a full cycle - one backend call with memory/skill
  load. Don't delegate for trivial answers you already have.
- A sub-agent has its own memory and skills. If you need it to see
  context from your conversation, include that context in the task
  string you pass.

## Verification
- The sub-agent's stdout response is the final answer or the next step.
- `bajaclaw status <subagent>` shows the cycle count incremented.
- `bajaclaw daemon logs <subagent>` shows the delegation entry.
