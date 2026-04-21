---
name: debug-methodology
description: Systematic debugging procedure that prevents patch-chaining and stops guessing loops.
version: 0.1.0
tools: [Bash, Read, Grep, Glob, Edit]
triggers: ["debug", "it's broken", "doesn't work", "error", "exception", "stack trace", "why is this failing", "not working", "bug", "regression", "crash"]
effort: high
---

## Why this skill exists

Autonomous agents have one failure mode more costly than all others:
**patching symptoms in a loop until the code works by accident.**
Every cycle that ends with "let me try something else" without a
concrete hypothesis burns tokens and introduces new bugs. This skill
forces a single structured pass.

## The non-negotiable rules

1. **Reproduce before you diagnose.** If you can't reproduce the bug,
   every fix is a guess. Stop and get a repro first.
2. **One hypothesis at a time.** Write it down. Prove it or kill it
   before moving on.
3. **No random edits.** Every code change must be tied to a specific,
   written hypothesis about root cause.
4. **Patch-chaining = stop.** If you've made three edits and the bug
   persists, STOP. Revert the edits. Start over from rule 1.
5. **Root cause over symptom.** "It works now" is not the same as
   "I understand why it broke". If you don't understand, the bug
   will be back.

## The procedure

### Step 1 - Reproduce

- Write down the exact reproduction steps. Copy them into the task
  or the PR body. Not "sometimes fails" - the exact inputs, exact
  environment, exact command.
- If the bug is intermittent: figure out the variable (data, timing,
  load, network). Make it deterministic before proceeding. If you
  can't, say so - intermittent bugs need a different playbook.
- Capture the failure. Log line, stack trace, screenshot, exit code.
  Paste it into your notes.

### Step 2 - Bisect the surface area

The bug lives somewhere. Narrow the "somewhere":

- **What changed?** `git log --oneline -20`, `git bisect` if the bug
  was working recently. Often root-cause in one commit.
- **What code path?** If there's a stack trace, read it top to
  bottom and map each frame to a file. Open them all before reading
  any of them.
- **What data?** Is the bug every input or a specific one? Isolate
  a minimal failing input.

### Step 3 - Form a hypothesis

Write it in one sentence: "I think the bug is X because of Y."

Examples:

- "The cache returns stale data because invalidation runs before the
  write commits."
- "The ffprobe call silently fails on webm files because the binary
  was compiled without webm support."
- "Users with emails containing `+` get bounced because the regex
  rejects `+` but RFC 5322 allows it."

If you can't write a one-sentence hypothesis, you don't understand
the problem well enough - go back to step 2.

### Step 4 - Test the hypothesis

The test must be **cheap and conclusive**:

- Add a print/log at the suspected line, rerun the repro. Does the
  print happen? Does the value match your prediction?
- Feed the minimal failing input to just the suspected function in
  isolation. Does it fail there alone?
- Check the assumption that underlies the hypothesis: "the cache
  invalidates before commit" - go read the cache code and verify.

One of three outcomes:

- **Confirmed.** Move to step 5.
- **Refuted.** Go back to step 3 with a new hypothesis. Do not edit
  code yet.
- **Inconclusive.** Your test wasn't specific enough. Design a
  better one.

### Step 5 - Fix, and only then

Now edit code. The edit should:

- Change the **root cause**, not the symptom. Adding a defensive
  null-check around a bug that shouldn't produce null is a symptom
  fix.
- Include a test that would have caught the bug. Otherwise the fix
  won't survive the next refactor.
- Be minimal. Don't add "while I'm here" cleanup. That's a separate
  change, in a separate commit.

### Step 6 - Verify

- Rerun the original reproduction. It passes.
- Run the test you added. It passes.
- Run the existing test suite. Nothing you didn't expect to change
  is red.
- For the user-facing bug: the user tries the original action and
  reports it fixed. Don't mark complete until the user has verified.

### Step 7 - Write up what you learned

One paragraph. What broke, why it broke, and how you fixed it.
Put it in the commit message or PR description. Future-you (or
another agent) will search for this when the bug echoes in a year.

## When to stop

- After three failed hypotheses, the model of the system is wrong.
  Stop editing. Re-read the relevant code cold. Talk through the
  problem with the user.
- When the fix is becoming larger than the feature. If "fix this
  bug" has become "refactor this module", the refactor is a
  separate task. Ship a minimal fix, open a ticket for the refactor.
- When you're tired of this bug. That's when you ship a workaround
  and hide real issues. Stop, rest, come back.

## Pitfalls

- **"Let me just try X."** If X isn't a hypothesis, don't try it.
- **Stack-trace skimming.** The exception's final frame is where the
  error surfaced, not where it originated. Read the whole trace.
- **Fixing tests to make them pass.** If a test fails on your change
  and the test is correct, the change is wrong. Check the test
  first; if it's checking the right invariant, revert your change.
- **Adding retries to a bug.** Retries hide race conditions. Fix
  the ordering, don't paper over it.
- **"Works on my machine."** Platform differences are real (path
  separators, line endings, default shell, env vars). Reproduce on
  the actual failing environment.
