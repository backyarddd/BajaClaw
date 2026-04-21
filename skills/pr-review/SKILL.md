---
name: pr-review
description: Systematic, multi-pass review of a GitHub pull request - correctness, security, tests, style.
version: 0.1.0
tools: [Bash, Read, Grep, Glob]
triggers: ["review pr", "review this pr", "review pull request", "code review", "review pr #", "pr review", "review the diff"]
effort: high
---

## Non-negotiable rules

1. **Ensure `gh` before anything.** `bajaclaw ensure gh --auth`.
   No tool, no review.
2. **Read, don't skim.** Fetch the full diff and the full changed
   files (not just the hunk) before writing a single comment.
   Review comments based on hunks alone miss context every time.
3. **One pass per concern.** Don't try to flag everything in one
   read. Separate correctness / security / tests / style into
   distinct passes so you don't accumulate context noise.
4. **Comment with permalinks.** Every file:line reference uses a
   full-SHA permalink from `gh pr view <n> --json headRefOid`.
   Branch names and `HEAD` rot.
5. **Don't approve blind.** If you can't run the tests or the change
   touches production behavior you can't simulate, say "reviewed,
   did not approve - can't verify X locally" instead of approving.

## Setup

```bash
bajaclaw ensure gh --auth
pr=${1:?"usage: pr-review <pr-number>"}
```

Early exit if the PR is closed, draft, or already approved by you:

```bash
state=$(gh pr view "$pr" --json state,isDraft --jq '.state + ":" + (.isDraft|tostring)')
case "$state" in
  CLOSED:*|MERGED:*) echo "PR #$pr is $state - skipping"; exit 0 ;;
  *:true) echo "PR #$pr is draft - skipping"; exit 0 ;;
esac
```

## The four passes

### Pass 1 - Understand

```bash
gh pr view "$pr" --json number,title,body,author,baseRefName,headRefName,headRefOid,additions,deletions,files --jq '.'
gh pr diff "$pr" > /tmp/pr-$pr.diff
sha=$(gh pr view "$pr" --json headRefOid --jq .headRefOid)
```

Read the diff end-to-end. For any file touched non-trivially, read
the full file (not the hunk). Note:

- What is this PR trying to do? (from title + description + diff)
- What it actually does (from the diff)
- Any gap between the two - that's your lead question.

### Pass 2 - Correctness

For each changed function or block, ask:

- Does this do what the surrounding code expects? (types, contracts,
  null-handling, error propagation)
- Are the edge cases handled? Empty input, zero, negative, huge,
  unicode, trailing whitespace, network timeout, disk full.
- Does it leave the data store / filesystem / cache in a consistent
  state if it fails halfway?
- Are there race conditions? Shared state, concurrent callers,
  ordered writes that aren't actually ordered?
- Does it double-count, double-bill, double-send anywhere?

### Pass 3 - Security

- Any new user input reach the shell, SQL, `eval`, or a template
  string? Look for concatenation with user strings.
- Any new secret path? Env vars, config files, headers logged?
  `grep -i 'token\|secret\|key\|password' /tmp/pr-$pr.diff`
- Any IDOR risk? Does the code check the caller owns the resource
  before reading/mutating it?
- Any new external HTTP call? Does it validate TLS, timeout, rate-limit?
- Any dependency bump? Check CVE status:
  `npm audit --json` for node, or `pip-audit` / `cargo audit` /
  `go list -m -u all` per ecosystem.
- RLS / policy changes? If there's a Supabase migration, run
  `supabase db advisors` against a shadow database if possible.

### Pass 4 - Tests + style

- Are the new code paths covered by tests? A test that exercises
  the happy path only is a yellow flag.
- Are tests actually assertions, or do they just confirm no exception?
- Any test marked `.skip` or `xit` with no issue reference?
- Style: does the PR match the surrounding code's style (naming,
  indentation, import order, error handling idiom)? Don't impose
  your preferences on a codebase you didn't write.

## Posting comments

General summary comment:

```bash
gh pr review "$pr" --comment --body-file - <<EOF
## Summary
<one paragraph on what the PR does and whether it does it well>

## Findings
- **[blocking]** <finding, with permalink>
- **[nit]** <finding, with permalink>
- **[question]** <open question, with permalink>

## Test plan check
<what tests exist, what's missing>
EOF
```

Permalink format:

```
https://github.com/<owner>/<repo>/blob/<sha>/<path>#L<start>-L<end>
```

For inline line comments (more useful for specific concerns): if the
user has the `github` MCP server, use
`mcp__github_inline_comment__create_inline_comment`. Otherwise, put
the permalink in the general comment and reference the file + line
in prose.

## Verdict

Pick one:

- **Request changes** - any blocking finding.
  `gh pr review "$pr" --request-changes --body "..."`
- **Approve** - all passes clean, tests exist and cover the change.
  `gh pr review "$pr" --approve --body "..."`
- **Comment** - concerns but not blocking; defer to the author.
  `gh pr review "$pr" --comment --body "..."`

## Pitfalls

- Don't review giant diffs (>1000 lines) in one pass. Ask the author
  to split it, or review in file-by-file batches with separate
  comment threads.
- Don't comment on code not in the diff unless the diff's behavior
  depends on it (and then say so explicitly).
- Don't comment on style issues if there's a linter that would catch
  them - let the tooling do that.
- Don't repeat yourself across inline comments and the summary. Pick
  one location per finding.
