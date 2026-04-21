---
name: supabase
description: Drive Supabase - migrations, types, edge functions, advisors, storage. Installs and authenticates the CLI automatically.
version: 0.1.0
tools: [Bash, Read, Write, Edit]
triggers: ["supabase", "pg migration", "generate types", "supabase db", "edge function", "supabase functions", "rls policy", "row level security", "supabase storage", "supabase advisor", "supabase auth"]
effort: medium
---

## Non-negotiable rules

1. **Ensure first.** Before the first `supabase` call:
   `bajaclaw ensure supabase --auth`. Installs the CLI and opens
   the token paste flow if not logged in.
2. **Iterate with `execute_sql`, commit with migrations.** When
   you're trying SQL, use the MCP `execute_sql` tool or
   `supabase db query`. Only use `apply_migration` / `supabase
   migration new` once the schema is final. `apply_migration`
   writes history on every call and will poison `supabase db diff`.
3. **Service role is a loaded gun.** Never put `SUPABASE_SERVICE_ROLE_KEY`
   in anything with `NEXT_PUBLIC_` prefix, client bundles, or git.
   It bypasses RLS entirely. If you see it in a committed file:
   rotate immediately, remove from history.
4. **Don't trust `user_metadata` in RLS.** It's user-editable. Use
   `auth.jwt() ->> 'sub'` or a server-controlled `app_metadata` field.
5. **Confirm destructive DB ops.** `supabase db reset` wipes local
   data. Any migration that DROPs columns or tables requires explicit
   confirmation from the user.

## Setup

```bash
bajaclaw ensure supabase --auth
```

### Link a project

```bash
supabase link --project-ref <ref>    # ref from dashboard URL
supabase status                      # confirms link + local stack state
```

If the user already has an `.mcp.json` pointing at `mcp.supabase.com`,
prefer MCP tools for reads (`list_tables`, `execute_sql`,
`generate_typescript_types`, `get_advisors`, `get_logs`, `search_docs`).
CLI owns local filesystem ops (migration files, function scaffolding).

## Core operations

### Schema iteration

```bash
# Interactive SQL against the linked project (or use execute_sql MCP tool):
supabase db query "SELECT table_name FROM information_schema.tables WHERE table_schema='public';"

# Once the schema is final, snapshot it as a migration:
supabase migration new add_widgets_table
supabase db pull --local --yes         # diff remote vs local/migrations, write a new file

# Apply local migration files to a linked remote project:
supabase db push
```

### Generate TypeScript types

```bash
supabase gen types typescript --linked > src/database.types.ts
```

Run this after any schema change that downstream code consumes.
Commit the generated file.

### Security + performance advisors

```bash
supabase db advisors       # CLI v2.81.3+
```

Equivalent MCP tool: `get_advisors`. Run before committing schema
changes. Flags missing indexes, unprotected tables, `SECURITY DEFINER`
functions with incorrect search_path, and RLS policies that don't
match the UPDATE/INSERT/DELETE they need.

### Edge functions

```bash
supabase functions new hello
supabase functions serve              # local dev with hot reload
supabase functions deploy hello
supabase functions deploy hello --no-verify-jwt   # only for public fns
supabase secrets set STRIPE_KEY=sk_live_...
supabase secrets list
```

### Logs

```bash
supabase functions logs hello --tail
```

MCP `get_logs` returns structured entries with level/time filters;
prefer it when the user has the MCP configured.

### Auth

```bash
supabase auth list-users
# Delete needs the user's uuid; confirm first:
supabase auth delete-user <uuid>
```

Note: deleting a user does not invalidate their active JWT. If the
intent is to lock them out immediately, rotate JWT secret or mark
them disabled via `app_metadata`.

### Storage

```bash
supabase storage ls ss://my-bucket
supabase storage cp ./local.jpg ss://my-bucket/local.jpg
supabase storage rm ss://my-bucket/local.jpg
```

## Security checklist (run before shipping any schema change)

- Every user-facing table has RLS enabled:
  `SELECT relname FROM pg_class WHERE relrowsecurity = false AND relkind = 'r';`
  Should return no rows for tables you expose.
- Views that expose RLS-protected tables use `security_invoker=true`
  (PG15+). Without this, views bypass RLS.
- Every UPDATE policy has a paired SELECT policy. Without SELECT,
  UPDATE silently no-ops.
- Storage upsert requires INSERT + SELECT + UPDATE policies together
  (not just INSERT).
- Functions that need elevated privileges use `SECURITY DEFINER` AND
  `SET search_path = public, pg_catalog`. Missing search_path +
  `SECURITY DEFINER` = search_path injection.
- No policy references `auth.jwt() -> 'user_metadata'`. Use `app_metadata`.
- Realtime publications are scoped: `ALTER PUBLICATION supabase_realtime`
  only adds tables that should be public.

## Pitfalls

- `apply_migration` during iteration = `db diff` is broken until you
  manually squash. Use `execute_sql` while trying things.
- `supabase db reset` is destructive (wipes local dev DB). Warn the
  user every time.
- Local stack boots on Docker. If Docker isn't running, start it
  before `supabase start`. `bajaclaw ensure` doesn't handle Docker -
  a missing Docker daemon surfaces as "failed to connect" in the
  supabase CLI output; tell the user to start Docker Desktop.
- Project linking state lives in `supabase/.temp/`. If the agent
  gets confused about which project it's targeting, `supabase status`
  shows the linked ref; `supabase link --project-ref <new>` rebinds.
- `db query` needs CLI v2.79+; `db advisors` needs v2.81.3+. If the
  command isn't found, `bajaclaw ensure supabase` will reinstall -
  but check version first: `supabase --version`.
- Running migrations against production without a dry run is a bad
  idea. Use `supabase db push --dry-run` first, read the plan, then
  run for real.

## Verification

- `supabase status` shows "Local development setup" with a linked
  project ref.
- `supabase db query "SELECT 1"` returns `1`.
- After `gen types`, the generated file compiles (TypeScript has no
  errors against the existing client code).
- `supabase db advisors` returns no high-severity issues.

## References

- Docs (markdown-addressable): append `.md` to any `supabase.com/docs`
  URL to get raw markdown. E.g.
  `https://supabase.com/docs/guides/auth/row-level-security.md`.
- Official Claude Code skill: `github.com/supabase/agent-skills`
  (this skill is a distilled port + cross-platform ensure wrapper).
- Hosted MCP: `https://mcp.supabase.com/mcp` (OAuth 2.1).
