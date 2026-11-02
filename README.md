# Openmi

A chat client welded to a GitHub repository. It reads code, proposes edits as a
reviewable diff, and opens a pull request only after you approve one. It does
not run your tests, and it says so.

**Stack:** Next.js 15 (App Router) on Vercel · Supabase (Postgres, Auth, RLS) ·
Tailwind v4 tokens · Bun.

**Build order:** [OPENMI_BUILD_PHASES.md](OPENMI_BUILD_PHASES.md). Phases 0 and 1
are done.

---

## Run it

```bash
bun install
cp .env.example .env.local   # fill in what you have
bun run dev                  # http://localhost:3000
```

Nothing is required to boot. With an empty `.env.local` the app starts and
[`/setup`](http://localhost:3000/setup) names every missing key and whether the
migrations have been applied.

## Sign in

Sign-in uses Supabase Auth with email and password. The session lives in an
httpOnly cookie (`@supabase/ssr`), which is what lets `middleware.ts` redirect a
signed-out visitor before paint. RLS remains the authority: a forged cookie
renders a shell with no data and is sent back to sign-in.

For email confirmation links, add these redirect URLs in Supabase →
Authentication → URL configuration:

```
http://localhost:3000/auth/callback
https://<your-domain>/auth/callback
```

Create accounts with **Authentication → Users → Add user** if you want to skip
email delivery while developing.

## Database

Migrations live in `supabase/migrations/` and are applied in filename order:

```bash
supabase link --project-ref <ref>
supabase db push
```

Vercel does not run migrations. The order is always **migrate, then deploy**.

`bun run check:migrations` applies every migration to an in-memory Postgres and
then applies them again, requiring the second pass to be a no-op — which is what
makes that order safe to repeat.

## Checks

```bash
bun run typecheck
bun run test
bun run check:migrations
NEXT_PUBLIC_SITE_URL=https://ci.invalid bun run build
```

`bun run test` includes `tests/rls.test.ts`, which runs the real migrations and
then queries as two different accounts and as `anon`, asserting that no row
crosses an account boundary.

## What is built

| Phase | Status | Surface |
|---|---|---|
| 0 | done | Env contract, Supabase clients, migration harness, `/setup`, CI |
| 1 | done | Sign-in/out, cookie session, middleware gate, sidebar, folders, trash, chat history |
| 2 | next | GitHub connect, repo picker, tree and file viewer, repository search |
| 3 | — | Streaming chat, model modes, citations |
| 4 | — | Repository agent tools with a server-held step budget |
| 5 | — | Changesets, unified diff, review UI |
| 6 | — | Approval → branch → pull request, default-branch refusal |
| 7 | — | Dew: hourly sessions, ledger, daily free bucket, activity, invites |

## Known limits

- Chat, repository access and billing are not implemented yet; the UI says so
  rather than pretending.
- Nothing in this app executes code. There is no sandbox and no test runner.
- A rebuild of a repository is a GitHub API call, not a mirror; nothing is
  stored locally except chats, folders and (later) review artefacts.

## Rules for contributors

- Pushes are authored as **`Openmi`** — see
  [agent-push-requirements.md](agent-push-requirements.md).
- No literal palette colours in components: use the semantic tokens
  (`bg-canvas`, `text-low`, `border-line`). There is no override block and there
  will not be one.
- A new table gets RLS enabled in the migration that creates it.
