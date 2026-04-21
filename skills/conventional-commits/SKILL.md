---
name: conventional-commits
description: Commit messages that are short, specific, and follow a stable format. No em dashes. No co-author trailers.
version: 0.1.0
tools: [Bash, Read]
triggers: ["commit message", "commit this", "write commit", "conventional commit", "commit format", "semantic commit"]
effort: low
---

## The rules

Every commit message has this shape:

```
<type>: <imperative summary, <= 72 chars>

<optional body: wrap at 72 cols, blank line between paragraphs>
```

**Type** is one of:

- `feat` - new user-facing feature
- `fix` - bug fix (user-visible)
- `refactor` - code change, no behavior change
- `perf` - measurable perf improvement
- `test` - adding or fixing tests
- `docs` - documentation only
- `chore` - tooling, deps, CI, release machinery
- `style` - formatting, whitespace (no logic change)
- `revert` - undoing a prior commit (include the SHA in body)

**Summary rules:**

- Imperative mood: "add X", not "added X" or "adds X".
- Present tense.
- No trailing period.
- Lowercase first word (type is already there).
- Specific: "fix migration check for null postgres version", not
  "fix bug".
- Under 72 chars. Hard limit.

**Body rules:**

- Explain **why**, not what. The diff shows what.
- Wrap at 72 cols (so `git log` reads well).
- Reference issues/PRs inline: "closes #123" on its own line.
- No em dashes (U+2014). Use " - " or ", " or a new sentence.
- No `Co-Authored-By: Claude <...>` trailer. User's standing rule.

## Examples

Good:

```
fix: migration check handles null postgres version

The health probe was crashing on fresh Supabase projects where
pg_version returns null before the first backup. Fall back to
runtime version string and warn if still missing.

closes #412
```

Good:

```
feat: ensure subcommand installs CLIs automatically

Adds `bajaclaw ensure <tool>` for cross-platform tool bootstrap
(brew/apt/dnf/pacman/winget/scoop/choco/npm). Skills call it
before depending on gh, vercel, supabase, ffmpeg, yt-dlp, or
tesseract. Auth flows launch inline.
```

Bad (too vague):

```
fix: bug
chore: updates
misc changes
```

Bad (what, not why):

```
refactor: move the parser into parse.ts and import it from cli.ts
```

Better:

```
refactor: extract parser so it can be tested without the CLI

The cli.ts import chain pulls in child_process and readline, which
fails in the test-import chain (tests strip .ts imports and the
transitive ones crash). Splitting the parser into parse.ts keeps
tests green and lets other callers reuse it.
```

## Workflow

```bash
# Inspect what you're about to commit
git status
git diff --stat --cached   # or --staged on modern git

# Read recent history to match the style
git log --oneline -10

# Write the commit via HEREDOC to preserve formatting
git commit -m "$(cat <<'EOF'
feat: <summary>

<body>
EOF
)"
```

For multi-paragraph bodies, the `<<'EOF'` form (with quotes) is
critical so backticks and `$vars` don't get interpreted.

## Pitfalls

- **Overloaded commits.** One commit, one logical change. If you
  need "and" in the summary, it's probably two commits.
- **Version bumps in feature commits.** Keep `chore: bump to vX.Y.Z`
  as its own commit when you can (release commits read better that
  way).
- **Forgetting the body.** If the summary is under 50 chars and the
  change is non-trivial, the body is doing work. Don't skip it.
- **Period at end of summary.** Git's summary is just that, a
  summary. Not a sentence. No period.
- **Branch-specific noise.** Never "wip", "tmp", "fix typo from last
  commit" in the final history. Squash before merging.

## Verification

```bash
git log -1 --pretty=fuller     # confirms author, date, full message
```

After pushing, view on the remote; links to issues and PRs should
be live.
