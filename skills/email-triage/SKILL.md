---
name: email-triage
description: Classify inbox messages, draft replies for routine items, surface urgent ones
version: 0.1.0
tools: [Read, Write]
triggers: ["check email", "triage inbox", "email"]
effort: medium
---

## Instructions

For each message:
1. Classify as `urgent`, `routine`, `fyi`, or `spam`.
2. For `urgent`: write one-line summary + draft holding reply.
3. For `routine`: draft a full reply in plain text.
4. For `fyi`: note the item in the daily briefing queue, no reply.
5. For `spam`: skip silently.

Never send. Every draft goes to the tasks queue with `status=awaiting_approval`.
If a message mentions PII, account numbers, or secrets, do not echo them in the
draft. Summarize the request without the sensitive details.
