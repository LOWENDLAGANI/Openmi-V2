# Openmi

A chat client welded to a GitHub repository. It reads code at a pinned commit,
answers with `path:line` citations, and proposes edits as a diff you can review.
Nothing is written to GitHub until you approve it, and an approval opens a pull
request on a new branch — never on the default branch. It does not run your
tests, and it says so.

**Stack:** Next.js 15 (App Router) on Vercel · Supabase (Postgres, Auth, RLS) ·
Tailwind v4 tokens · Bun.

**Build order:** [OPENMI_BUILD_PHASES.md](OPENMI_BUILD_PHASES.md). Phases 0–9 are
built. Phase 10 (execution) is gated, not built — four decisions are missing and
inventing them would ship a sandbox nobody priced.

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

Paste a fine-grained token with **Contents: read and write**, **Pull requests:
read and write** and **Metadata: read**. It is sent once, verified against
GitHub, sealed with AES-256-GCM under `GITHUB_TOKEN_KEY`, and only its last
four characters are ever shown again. Read-only tokens still browse and chat;
they are refused at approval with a message naming the missing scopes.
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
bun run check:contrast
bun run test:rls
NEXT_PUBLIC_SITE_URL=https://ci.invalid bun run build
```

`bun run test` runs the real migrations against Postgres and queries as two
different accounts and as `anon`. It also covers the seal/unseal path and its
tamper cases, the GET-only GitHub client, the context budget, the turn envelope,
the diff engine and edit rules, both directions of the changeset signature, the
branch refusal and request shape of the write client, the Dew ledger, sessions,
refunds, invites and redeem codes against a real Postgres, migration drift
detection, probe classification, and the tool surface.

## What is built

| Phase | Status | Surface |
|---|---|---|
| 0 | done | Env contract, Supabase clients, migration harness, `/setup`, CI |
| 1 | done | Sign-in/out, cookie session, middleware gate, sidebar, folders, trash, history |
| 2 | done | GitHub connect with sealed tokens, repo picker, pinned tree + file viewer, code search |
| 3 | done | Streaming chat, capability modes, per-chat sequence, context budget, citation links |
| 4 | done | Read-only agent tools, step budget with compare-and-set, signed continuation, truthful caps |
| 5 | done | Proposed edits, unified diff, per-file review, signed changesets |
| 6 | done | Approval → agent branch → one commit → pull request, default-branch refusal |
| 7 | done | Dew sessions, ledger, daily refill, activity, invites, refunds, redeem codes |
| 8 | done | Setup env, migration drift and live probes; `/about` truth surface |
| 9 | done | RLS audit, contrast gate, shared rate limiter, Vercel route config |
| 10 | gated | Execution — not buildable; D6.1–D6.4 are open |

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

**Approval opens one branch and one pull request.** The head is always
`openmi/agent/<changeset-id>`; there is no parameter that accepts a branch
name, and the default branch is refused by the write client before any request.
The PR base is the repository's default branch, read live from GitHub, and the
commit's parent is the chat's pinned sha — a pin that has moved refuses instead
of guessing. Retrying after a failure reuses the recorded branch, commit and
pull request, so one approval cannot produce two PRs.

## Dew

One hour of chat costs 3 Dew, charged before the provider is called. A running
hour is reused, so more turns inside it are free. The charge is made by
`start_hour_session(model, repo)`, which has no price parameter.

| Constant | Value |
|---|---|
| Hour price | 3 |
| Daily free allowance | 6 |
| Paid daily allowance | 15 |
| Trial credit | 5 |
| Low-balance warning | 10 |
| Precision (decimals) | 3 |
| Dust floor | 0.05 |

On the first day the daily allowance is added to the trial credit; after that it
tops the balance up to 6 Dew (15 once a top-up has been redeemed) at local
midnight in the account's timezone. It never refills on a day that is ahead of
the local date, so a clock that steps backwards mints nothing. The trial credit
is a ledger row at signup, not an unrecorded default.

An invite rewards both sides 5 Dew, once per invitee, up to 10 rewarded
accounts. Refunds are one per session at the original price and are written for
a provider failure or an abort before the first token; anything else is an
operator adjustment, which is service-role only. Top-up packs are
operator-issued redeem codes — there is no card payment in this build.

`/activity` shows the ledger, the running hour, per-chat token estimates, the
invite code, the redeem form and the refill timezone. The sum of the ledger
amounts equals the cached balance, and a test asserts it for every account.

## Setup and about

`/setup` reports every environment variable from the contract as present or
missing, never its value, with the fix beside it. It reads the Supabase
migration ledger through a service-role function and compares each applied row
against this checkout: applied files are green, missing files are pending, and a
file edited after it was applied is marked **drift** rather than up to date.
Checksums are taken over normalized SQL, so reformatting is not drift.

The same page runs read-only live probes: Supabase reachability, an RLS smoke
test where the anon key must read zero profile rows, GitHub token decryption and
acceptance, and a model-list request for each configured provider. Each probe
reports its own failure with its own fix; none prints a key.

`/about` states what the product does and does not do: no execution, no default
branch writes, no merges, no card payments, and no claim of verification.

## Known limits

- Nothing in this app executes code. There is no sandbox and no test runner, and
  no surface claims otherwise.
- Writes are one branch and one pull request per approved changeset. There is
  no merge, no push to the default branch, and no branch cleanup.
- Dew is charged per hour, not per answer. Only a provider failure or an abort
  before the first token is refunded automatically; any other correction is an
  operator adjustment.
- There is no card payment. Top-ups and gift Dew are operator-issued redeem
  codes, and there is no public way to create one.
- `/setup` probes a provider with a model-list request, not a completion, so a
  pass confirms the key authenticates rather than that a specific model works.
- GitHub code search runs against the default branch while line numbers are
  resolved at the pinned commit; the UI says both.
- Repository access is API calls, not a clone. There is no mirror to go stale,
  and no offline mode.
- The rate limiter degrades to allowing a request when neither Upstash nor the
  Postgres function is reachable. The setup page shows which backend is live.
- Execution is gated (phase 10). There is no sandbox, no test runner and no
  preview server, and no card may imply one exists.

## Rate limits

One counter per account per kind, shared by every instance: 20 chat turns and 10
approvals per minute. `supabase/migrations/010_rate_limit.sql` owns the counter,
and `rate_limit_hit(bucket, window_start, max)` increments and checks the cap in
a single statement, so two instances firing at once cannot both take the last
slot. Upstash REST is used when both of its variables are set; otherwise the
Postgres function is the backend. If neither answers, the request is allowed and
the result says `degraded` — a limiter that fails closed turns a database blip
into an outage.

## Accessibility

Semantic tokens only, and three appearances. `node scripts/check-contrast.mjs`
resolves every text token against every surface in all three themes and exits 1
below 4.5:1; `bun run test` runs the same script. Accent fills use `--on-accent`,
and accent *text* uses `--accent-text`, because one colour cannot clear 4.5:1
both as a light fill and as dark text on paper. Focus rings come from a single
`:focus-visible` rule, and reduced motion is honoured globally.

## Deploy runbook

1. Create the Supabase project; copy the URL, the anon key and the service-role
   key.
2. Generate `GITHUB_TOKEN_KEY` with `openssl rand -base64 32`.
3. Add `https://<domain>/auth/callback` and the localhost equivalent in
   Supabase → Authentication → URL configuration.
4. Import the repo into Vercel and set every key in §6 for **Preview** and
   **Production** separately.
5. Apply migrations with `supabase link --project-ref <ref> && supabase db push`.
   Vercel does not run them; the order is always migrate, then deploy.
6. Deploy, then open `/setup` and make every row green.
7. Connect GitHub with a fine-grained token: contents read/write, pull requests
   read/write, metadata read.
8. Pick a repo, send a message, approve one trivial change and confirm the pull
   request's head is `openmi/agent/…`.

## Manual test steps

These need a real project and token, so they are steps rather than specs:

1. Sign in, sign out, sign in again; `/chat` is gated by the cookie and RLS.
2. Connect GitHub; confirm only the last four characters are shown afterwards.
3. Pick a repository, open a file from a citation, search the code.
4. Send a message, stop one mid-stream, and check the Dew chip and `/activity`.
5. Ask for an edit, reject one file, accept another, then approve.
6. Confirm one branch exists, one PR is open, and its base is the default branch.
7. Try to approve with a read-only token; the refusal names the missing scopes.
8. Open `/setup` and confirm the probes report per-service state, not "error".

## Phase 10 is gated

Execution is **not buildable** without four decisions: what may run (D6.1), what
sandbox time costs in Dew (D6.2), which secrets are absent from it (D6.3), and
what the card says when it cannot start (D6.4). The rule that cannot be relaxed
is that every card state must come from a real observation: timed out says timed
out, cannot start says cannot start, and there is no optimistic default.

Nothing in this build runs code, and `tests/execution-gate.test.ts` fails if a
surface starts claiming otherwise or a sandbox dependency appears.

## Rules for contributors

- Pushes are authored as **`Openmi`** — see
  [agent-push-requirements.md](agent-push-requirements.md).
- No literal palette colours in components: use the semantic tokens
  (`bg-canvas`, `text-low`, `border-line`). There is no override block and there
  will not be one.
- A new table gets RLS enabled in the migration that creates it.
- A new limit is a named constant with a test that reads it.
- Do not claim verification the product does not perform.
