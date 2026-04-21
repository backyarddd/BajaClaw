---
name: vercel
description: Deploy, inspect, and manage Vercel apps. Installs and authenticates the CLI automatically.
version: 0.1.0
tools: [Bash, Read, Write, Edit]
triggers: ["vercel", "deploy to vercel", "vercel deploy", "preview deploy", "promote to production", "vercel env", "vercel logs", "vercel domain", "next.js deploy", "vercel build"]
effort: medium
---

## Non-negotiable rules

1. **Ensure first.** Before the first `vercel` call, run
   `bajaclaw ensure vercel --auth`. That installs the CLI and kicks
   off the OAuth login if needed.
2. **Confirm prod deploys.** `--prod`, `promote`, `rollback`, and
   `alias set <deployment> <prod-domain>` are irreversible without
   another deploy. Require explicit confirmation in the task or ask
   the user once before running them.
3. **Never echo env values.** `vercel env pull` writes `.env.local`.
   Do not `cat` it, do not print values in chat, do not put values
   in PR bodies. You may list variable names; the user reads values
   themselves.
4. **Env vars are baked at build time.** Changing an env var does
   nothing until the next deploy. After `vercel env add|rm`, run
   `vercel redeploy <url>` or `vercel deploy` explicitly.
5. **Token via env var, never flag.** Use `VERCEL_TOKEN=<token>` in
   the environment. Never pass `--token <token>` on the command line;
   process lists leak it.

## Setup

```bash
bajaclaw ensure vercel --auth
```

Exit code 0 = ready. Exit 20 = installed, auth pending. Branch on it.

### Project linking

Most commands act on the project linked to the current working
directory (state in `.vercel/project.json`). Before any action, check:

```bash
[ -f .vercel/project.json ] || vercel link --yes
```

`--yes` uses sensible defaults (matches the git remote if Vercel
knows the project). If the project is new or ambiguous, drop `--yes`
and let the user answer the prompts interactively.

## Core operations

### Deploy

```bash
vercel deploy                 # preview
vercel deploy --prod          # production (CONFIRM FIRST)
vercel deploy --prebuilt      # use a local `vercel build` artifact
```

`vercel deploy` prints the deployment URL on stdout. Capture it:

```bash
url=$(vercel deploy 2>/dev/null | tail -n 1)
```

### Inspect + logs

```bash
vercel inspect <url>                         # metadata + build state
vercel inspect <url> --logs                  # build logs
vercel inspect <url> --wait                  # block until build finishes
vercel logs <url> --follow                   # runtime logs (tail)
vercel logs <url> --output=raw --since=10m   # recent runtime slice
```

When the user has the Vercel remote MCP configured (`mcp.vercel.com`),
prefer `get_runtime_logs` / `get_deployment_build_logs` - they take
structured filters (level, statusCode, source, time range) and return
less text than grepping `--follow` output.

### Env vars

```bash
vercel env ls                              # list across targets
vercel env ls production                   # one target
vercel env add MY_VAR production           # interactive paste
vercel env rm MY_VAR production --yes
vercel env pull .env.local                 # sync remote -> local file
```

After any `add`/`rm`, the next deploy picks up the change. Existing
deployments do not update in place.

### Promote + rollback

```bash
vercel ls                                  # find deployment urls
vercel promote <preview-url>               # preview -> prod (CONFIRM)
vercel rollback <previous-prod-url>        # revert prod (CONFIRM)
```

`rollback` with no arg rolls back to the last production before the
current one, which is rarely what you want - pass an explicit URL.

### Aliases + domains

```bash
vercel alias set <deployment-url> <alias-domain>   # custom domain
vercel alias ls
vercel domains ls
vercel domains add <domain>
```

Setting an alias on your production apex is equivalent to a prod
promotion. Treat as destructive.

### Team scope

```bash
vercel whoami          # confirm team
vercel teams ls
vercel switch <team>   # change active team
```

Verify before prod actions. Wrong team + `--prod` = shipped into
someone else's project.

## Escape hatch: the Vercel MCP

Vercel hosts a remote MCP at `https://mcp.vercel.com`. For read-heavy
operations (docs search, structured log filters, deployment metadata
across many projects), the MCP beats shell-parsed CLI output. The
CLI still owns writes (deploy/env/promote/rollback/alias) - don't
depend on a remote endpoint for destructive actions.

## Pitfalls

- `.vercel/project.json` must be gitignored. Check before committing.
- `vercel build` locally requires `vercel pull` first to get env +
  project settings. Without it, builds diverge from cloud builds.
- Build logs can be huge. Use `inspect --wait` and only dump logs
  on failure, or use the MCP's paginated `get_deployment_build_logs`.
- Hobby plan: non-author teammates can't trigger prod deploys.
  `Git Author Override` or a Pro plan is the fix.
- Node version: `"engines"` in `package.json` controls the runtime.
  Mismatch = build failure with a vague error.
- Serverless function size limits (50 MB uncompressed). Very common
  silent cause of deploy failure; inspect logs for "Function exceeds".

## Verification

- `vercel whoami` returns a username + team.
- `vercel ls` shows your recent deploy.
- `vercel inspect <url> --wait` returns exit 0 and "Build completed".
- For prod: `curl -I <prod-domain>` returns 200 and the `x-vercel-id`
  header references the new deployment id.
