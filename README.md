# Openmi

A chat client welded to a GitHub repository. It reads code at a pinned commit,
answers with `path:line` citations, and proposes edits as a diff you can review.
Nothing is written to GitHub until you approve it, and an approval opens a pull
request on a new branch — never on the default branch. It does not run your
tests, and it says so.

**Stack:** Next.js 15 (App Router) on Vercel · Supabase (Postgres, Auth, RLS) ·
Tailwind v4 tokens · Bun.

**Build order:** [OPENMI_BUILD_PHASES.md](OPENMI_BUILD_PHASES.md). Phases 0–5 are
built; the approval-to-pull-request path and billing are next.

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

Email and password through Supabase Auth. The session lives in an httpOnly
cookie (`@supabase/ssr`), which is what lets `middleware.ts` redirect a
signed-out visitor before paint. RLS remains the authority: a forged cookie
renders a shell with no data.

Email confirmation links need these redirect URLs in Supabase →
Authentication → URL configuration:

```
http://localhost:3000/auth/callback
https://<your-domain>/auth/callback
```

## Connect GitHub

Paste a fine-grained token with **Contents: read** and **Metadata: read**. It is
sent once, verified against GitHub, sealed with AES-256-GCM under
`GITHUB_TOKEN_KEY`, and only its last four characters are ever shown again.
`/api/github/status` reads a query that does not select the sealed column at all.

Rotating `GITHUB_TOKEN_KEY` makes existing sealed tokens unopenable. That is the
intended behaviour, not a bug: every account reconnects.

## Database

```bash
supabase link --project-ref <ref>
supabase db push
```

Migrations are applied in filename order and must apply twice cleanly:

```bash
bun run check:migrations   # PGlite, every migration, second pass is a no-op
```

Vercel does not run migrations. The order is always **migrate, then deploy**.

## Checks

```bash
bun run typecheck
bun run test
bun run check:migrations
NEXT_PUBLIC_SITE_URL=https://ci.invalid bun run build
```

`bun run test` runs the real migrations against Postgres and queries as two
different accounts and as `anon`. It also covers the seal/unseal path and its
tamper cases, the GET-only GitHub client, the context budget, the turn envelope,
the diff engine and edit rules, both directions of the changeset signature, and
the tool surface.

## What is built

| Phase | Status | Surface |
|---|---|---|
| 0 | done | Env contract, Supabase clients, migration harness, `/setup`, CI |
| 1 | done | Sign-in/out, cookie session, middleware gate, sidebar, folders, trash, history |
| 2 | done | GitHub connect with sealed tokens, repo picker, pinned tree + file viewer, code search |
| 3 | done | Streaming chat, capability modes, per-chat sequence, context budget, citation links |
| 4 | done | Read-only agent tools, step budget with compare-and-set, signed continuation, truthful caps |
| 5 | done | Proposed edits, unified diff, per-file review, signed changesets |
| 6 | next | Approval → branch → pull request, default-branch refusal |
| 7 | — | Dew: hourly sessions, ledger, daily free bucket, activity, invites |
| 8–9 | — | Setup/about truth surface, hardening, launch |

## The agent, and its limits

A turn may call three tools, all of them reads: `list_files` (≤200 paths),
`read_file` (≤200KB, text only), and `search_code` (≤10 candidates). No tool
accepts a URL; every request is built from the token plus a path in the
repository the chat is pinned to.

The turn stops at one of three caps, and the transcript says which:

| Cap | Value |
|---|---|
| Steps | 24 |
| Budget | 120,000 tokens (estimated from characters) |
| Wall clock | 40s inside a 60s function, then a signed continuation |

Replaying an older continuation is refused in Postgres, not in the route: the
step counter advances by compare-and-set, so a stale token matches no row.

## Propose and review

The agent can call a fourth tool, `propose_edits`. A call carries at most six
edits, each either a whole-file write or an exact string replacement, and each
file is capped at 120,000 bytes. A replacement whose anchor is absent, or
appears more than once, fails that file with a message rather than editing the
wrong line. A changeset holds at most 24 files.

Each file is rendered as a unified diff with three lines of context, capped at
60,000 characters and 2,000 lines; a clipped diff says it is clipped, and the
proposed file is stored in full. You accept or reject files individually and
the card says which are in the set.

A signed changeset is an HMAC over `changeset_id + base_sha + content_hash`,
where the hash covers the accepted files only. Rejecting a file re-signs the
smaller set; editing one byte leaves the signature stale. `status` is not in
the signature, so moving from ready to approved does not invalidate it. A
changeset expires six hours after it is proposed, and expiry is read from the
clock, not stored as a hopeful flag.

**Approval does not write to GitHub.** It records the signed set and stops;
phase 5 has no branch, commit or pull request, and the card says so.

## Known limits

- Nothing in this app executes code. There is no sandbox and no test runner, and
  no surface claims otherwise.
- No commit path yet: approving records a signed set of files, and no branch,
  commit or pull request is created.
- GitHub code search runs against the default branch while line numbers are
  resolved at the pinned commit; the UI says both.
- Repository access is API calls, not a clone. There is no mirror to go stale,
  and no offline mode.

## Rules for contributors

- Pushes are authored as **`Openmi`** — see
  [agent-push-requirements.md](agent-push-requirements.md).
- No literal palette colours in components: use the semantic tokens
  (`bg-canvas`, `text-low`, `border-line`). There is no override block and there
  will not be one.
- A new table gets RLS enabled in the migration that creates it.
- A new limit is a named constant with a test that reads it.
- Do not claim verification the product does not perform.
