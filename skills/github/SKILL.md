---
name: github
description: Drive GitHub from the shell with gh - PRs, issues, releases, Actions. Installs and authenticates the CLI automatically.
version: 0.1.0
tools: [Bash, Read, Write, Edit]
triggers: ["github", "gh ", "pull request", "open pr", "create pr", "review pr", "merge pr", "issue tracker", "open issue", "close issue", "github actions", "workflow run", "release notes", "cut a release"]
effort: medium
---

## Non-negotiable rules

1. **Ensure first, ask nothing.** Before your first `gh` call, run
   `bajaclaw ensure gh --auth`. That installs the CLI if missing and
   kicks off the OAuth device flow if not logged in. Do not tell the
   user "install gh first" - you install it for them.
2. **Always `--json` + `--jq`.** Never parse pretty output. Every
   `gh` command that supports `--json` must use it with the exact
   fields you need. Pipe through `--jq '...'` for selection.
3. **HEREDOC bodies.** Multi-line PR/issue/release bodies go through
   `--body-file -` fed by a HEREDOC so backticks and quotes survive.
4. **Full-SHA permalinks.** When you reference a line in a PR, look
   up the head SHA with `gh pr view <n> --json headRefOid --jq .headRefOid`
   and build `https://github.com/<owner>/<repo>/blob/<sha>/<path>#L<a>-L<b>`.
   Never use `HEAD` or a branch name in a permalink.
5. **Confirm before destructive ops.** `pr merge`, `pr close`,
   `issue close`, `release delete`, `repo delete`, `run cancel`, and
   any `push --force*` require an explicit confirmation from the user
   or a written instruction in the task that covers that exact action.

## Setup

```bash
bajaclaw ensure gh --auth
```

Exit codes from `bajaclaw ensure`:

- `0` ready (installed + authed)
- `10` install failed (report to user with the stderr output)
- `20` install succeeded but auth pending (tell the user to finish
  the device-code step, then retry the skill)
- `30` unsupported platform
- `40` no package manager available (give the user the docs URL)

Branch on exit code. Do not proceed on non-zero.

## Core operations

### Inspect a PR

```bash
gh pr view <n> --json number,title,state,isDraft,mergeable,headRefOid,baseRefName,headRefName,author,additions,deletions,files,body --jq '.'
gh pr diff <n>
gh pr view <n> --comments
```

Skip PRs that are closed, draft, or already reviewed by you - mirror
the Claude Code code-review plugin pattern:

```bash
state=$(gh pr view <n> --json state,isDraft --jq '.state + ":" + (.isDraft|tostring)')
# bail if state is "CLOSED:*" or "*:true"
```

### Create a PR

```bash
gh pr create --base main --head "$(git rev-parse --abbrev-ref HEAD)" \
  --title "short imperative title" \
  --body-file - <<'EOF'
## Summary
- bullet one
- bullet two

## Test plan
- [ ] `npm test`
- [ ] manual verify in staging

EOF
```

### Review + comment

```bash
# general review comment
gh pr review <n> --comment --body-file - <<'EOF'
Overall: looks good. A couple of notes below.
EOF

# request changes
gh pr review <n> --request-changes --body "reason"

# approve (only if you actually reviewed)
gh pr review <n> --approve

# general (non-line) PR comment
gh pr comment <n> --body-file - <<'EOF'
...
EOF
```

For inline line-level comments, the `gh` CLI can't post them cleanly.
If the user has the `github` MCP server configured, use
`mcp__github_inline_comment__create_inline_comment`. If not, leave a
general comment that references file + line number + full-SHA permalink.

### Issues

```bash
gh issue list --state open --limit 50 --json number,title,labels,author --jq '.'
gh issue view <n> --json number,title,body,state,labels,author,comments --jq '.'
gh issue create --title "..." --body-file - <<'EOF' ... EOF
gh issue comment <n> --body-file - <<'EOF' ... EOF
gh issue close <n>    # confirm first unless instructed
```

### Actions (CI)

```bash
gh run list --limit 10 --json status,conclusion,workflowName,headBranch,createdAt,databaseId --jq '.'
gh run view <id> --log-failed      # just the failed steps
gh run watch <id>                  # block until the run finishes
gh run rerun <id> --failed         # retry only the failed jobs
```

### Releases

```bash
gh release create vX.Y.Z \
  --title "vX.Y.Z" \
  --notes-file - <<'EOF'
## vX.Y.Z
- change one
- change two
EOF

gh release create vX.Y.Z --generate-notes   # auto-generate from merged PRs
gh release view vX.Y.Z --json tagName,name,body,assets,isDraft,isPrerelease --jq '.'
```

### Escape hatch: `gh api`

Anything the subcommands don't cover: use `gh api` with `--paginate`
and `--jq`. Supports REST and GraphQL (`gh api graphql -f query='...'`).

```bash
gh api /rate_limit --jq '.resources.core'   # check budget before bulk loops
gh api repos/:owner/:repo/commits/:sha --jq '.author.login'
```

### Current repo detection

Never parse `git remote`. Use:

```bash
gh repo view --json nameWithOwner,defaultBranchRef --jq '.'
```

## Pitfalls

- **Auth scopes.** If a command fails with `Resource not accessible`
  it's usually a missing scope. Re-login with the right scopes:
  `gh auth refresh -h github.com -s workflow,repo,read:org,gist`.
- **Rate limits.** `gh api /rate_limit` before any bulk loop. Unauthed
  = 60/hr, authed = 5000/hr, search is separately throttled.
- **Default repo.** `gh` infers from the git remote in CWD. If you're
  running from a detached dir, pass `-R <owner>/<repo>`.
- **Pager.** Set `PAGER=cat` or pass `--no-pager` where supported. The
  skill runs in non-interactive subprocesses.
- **Bracketed paste in bodies.** Strip `\x1b[20[01]~` markers before
  feeding user-provided prose to `--body-file -`.
- **Secrets in PR bodies.** If the body or the diff contains tokens,
  never echo them back to the user. Paraphrase.

## Verification

- `gh auth status` shows "Logged in to github.com as <user>".
- After creating/commenting, re-fetch with `gh pr view <n> --comments`
  and confirm your entry appears.
- For workflow interactions, follow up with `gh run list` to confirm
  the run you triggered is present.
