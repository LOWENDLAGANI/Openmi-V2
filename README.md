edit after countless failing

# Openmi

A chat client welded to a GitHub repository. It reads code at a pinned commit,
answers with `path:line` citations, and proposes edits as a diff you can review.
A ready change is written to its own branch and applied as one pull request; the
default branch is only ever the base unless you name it as the destination. It
does not run your tests, and it says so.

**Stack:** Next.js 15 (App Router) on Vercel · Supabase (Postgres, Auth, RLS) ·
Tailwind v4 tokens · Bun.

**Build order:** [OPENMI_BUILD_PHASES.md](OPENMI_BUILD_PHASES.md). Phases 0–9 are
built. Phase 10 (execution) is built as **verification only**: an install and a
build run in a sandbox and the card reports the exit code it observed. A chat
turn now runs inside that chat's own persistent workspace by default, so it can
execute what it writes and the files are still there on the next message; the
workspace is kept for `CHAT_SANDBOX_TTL_HOURS` (2 days) of inactivity, then
destroyed.
`OPENMI_SANDBOX_TURNS=off` restores GitHub-only turns. Nothing in the product
runs your test suite on its own.

---

## Run it

```bash
bun install
cp .env.example .env.local   # fill in what you have
bun run dev                  # http://localhost:3000
```

Nothing is required to boot. With an empty `.env.local` the app starts and
[`/setup`](http://localhost:3000/setup) names every missing key and whether the
migrations have been applied. Once Supabase is configured that report lives in
the admin panel under **Configuration & probes**; it is not a public page.

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

With `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET` set, connecting
is **Continue with GitHub**: the workspace asks for the `repo` scope, exchanges
the one-time code for an access token, and stores the same sealed row a pasted
token produces. The two paths are indistinguishable downstream. The paste box
moves underneath as **Use a personal access token instead**, and is the whole
panel when those keys are unset.

To turn it on, create a GitHub **OAuth App** (Settings → Developer settings →
OAuth Apps) and register `<NEXT_PUBLIC_SITE_URL>/auth/github/callback` as its
callback URL. One OAuth App has one callback URL, so a preview deployment on a
different origin needs its own app, or the token fallback.

Disconnecting an OAuth connection revokes the grant on GitHub as well, so Openmi
leaves **Authorized OAuth Apps** instead of lingering there. A pasted token is
only deleted here, because it is your own credential and has no grant to revoke;
if GitHub refuses the revoke, the row is still deleted and the message says so
with the settings link.

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
| 10 | built | Sandbox verification — install + build recorded from real exit codes |

## The agent, and its limits

On a GitHub-only turn (`OPENMI_SANDBOX_TURNS=off`) the agent may call four tools:
`list_files` (≤200 paths),
`read_file` (≤200KB, text only), `search_code` (≤10 candidates) and `git`
(`status`, and a `pull` that moves the pin). No tool accepts a URL; every request
is built from the token plus a path in the repository the chat is pinned to.
Every write to GitHub stays server-side: the review card commits to an
`openmi/agent/` branch and opens the pull request with the sealed token, and a
branch that moved is re-applied on the live head rather than force-pushed.

With the sandbox on, the surface also carries the shell tools, `browser`, and
`fetch_url` — one public https page as text (200KB read, 12s, three redirects,
private and metadata addresses refused). That last one lives on the sandbox
surface on purpose: the chat-only surface stays free of any tool that takes an
address.

The turn stops at one of three caps, and the transcript says which:

| Cap | Value |
|---|---|
| Steps | 40 |
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

**Approval opens one branch and one pull request, then applies it.** The default
head is `openmi/agent/<changeset-id>`, and the PR is opened against the
repository's default branch, read live from GitHub. Approval then squash-merges
that pull request and stores the merge commit; a merge that cannot finish is
recorded as failed with its pull request left in place. The default branch is
never the head unless the reader names it as the destination (an explicit branch
request is written directly) or an operator sets
`OPENMI_ALLOW_DEFAULT_BRANCH=on`. The destination is the model's read of the
request, not a keyword: `propose_edits` takes a `destination` branch argument, and
naming one also answers the confirmation question, because asking for that branch
was the decision. The write is still one commit, never forced, and re-applied if
the branch moved under it.

The automatic write now counts as the review (`AUTO_WRITE_REVIEW`). Before that,
every fresh suggestion read as "nobody has reviewed it" and asked for a click, so
the automatic path never actually ran. Two questions survive: a head that moved
since the diff, and a change over five files or touching configuration,
credentials or the schema. A named branch that has moved since the diff
was computed is not a dead end — the change goes to a new `openmi/agent/` branch
on top of the live head, unforced. Retrying after a failure reuses the recorded
branch, commit and pull request, so one approval cannot produce two PRs.

## Dew

One hour of chat costs 2 Dew, charged before the provider is called. The hour is
priced per model and belongs to the model and chat that started it: a running
hour is reused for free, and a turn for another model or another chat is refused
with what holds it instead of silently riding it. The price is decided by
`model_hour_dew(model)` and charged by `start_hour_session(model, repo)`, neither
of which takes an amount.

| Constant | Value |
|---|---|
| Hour price | 2 |
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
is a ledger row written on the first message, not an unrecorded default: 5 Dew
once per account, and at most one paid trial per address per day, so bulk
signups mint accounts but not Dew.

An invite rewards both sides 5 Dew, once per invitee, up to 10 rewarded
accounts. Refunds are one per session at the original price and are written for
a provider failure or an abort before the first token; anything else is an
operator adjustment, which is service-role only. Top-up packs are
operator-issued redeem codes — there is no card payment in this build.

`/activity` shows the ledger, the running hour, per-chat token estimates, the
invite code, the redeem form and the refill timezone. The sum of the ledger
amounts equals the cached balance, and a test asserts it for every account.

## Setup and about

The setup report — reached from the admin panel, and served at `/setup` only to
operators — lists every environment variable from the contract as present or
missing, never its value, with the fix beside it. It reads the Supabase
migration ledger through a service-role function and compares each applied row
against this checkout: applied files are green, missing files are pending, and a
file edited after it was applied is marked **drift** rather than up to date.
Checksums are taken over normalized SQL, so reformatting is not drift.

The same page runs read-only live probes: Supabase reachability, an RLS smoke
test where the anon key must read zero profile rows, GitHub token decryption and
acceptance, and a model-list request for each configured provider. Each probe
reports its own failure with its own fix; none prints a key.

`/about` states what the product does and does not do: what a verification run
observed, which branch a change is written to, that no card payment happens in
this app, and that nothing claims a test it did not run.

## Known limits

- A chat turn gets its chat's persistent workspace by default, so the assistant
  can run what it writes. The handle is lazy: a turn that never calls a tool
  provisions nothing. The box stops after 5 idle minutes (its disk is kept) and
  is destroyed `CHAT_SANDBOX_TTL_HOURS` (2 days) after the last activity, which
  also takes that chat's versions with it. `OPENMI_SANDBOX_TURNS=off` is the
  GitHub-only turn: reads plus a proposed diff, no shell, no browser.
- Writes are one branch and one pull request per approved changeset, and the
  approval path squash-merges that pull request. A branch the reader names is
  written directly. The default branch is written directly only when the reader
  names it or an operator allows it. Branches are not cleaned up, and a change
  sent to a branch that moved becomes a new branch, never a forced update.
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
- Execution runs only when it is configured. Verification runs and missions
  need an execution key; with none set the card says execution is not
  configured instead of implying one exists. There is no test runner and no
  preview server on the review card.

## Rate limits

One counter per account per kind, shared by every instance: 20 chat turns and 10
approvals per minute. `supabase/migrations/010_rate_limit.sql` owns the counter,
and `rate_limit_hit(bucket, window_start, max)` increments and checks the cap in
a single statement, so two instances firing at once cannot both take the last
slot. Upstash REST is used when both of its variables are set; otherwise the
Postgres function is the backend. If neither answers, the request is allowed and
the result says `degraded` — a limiter that fails closed turns a database blip
into an outage.

## Provider fallback keys

A provider may hold more than one key. `providerKeys()` reads the primary
variable, then `<PROVIDER>_API_KEYS` (comma or space separated), then the `_2`
and `_3` variants. When a key is rejected or rate limited **before the first
token**, the same provider and the same model are retried with the next key; once
text has reached the reader nothing is retried, because a second attempt would
replay the answer from the top. The setup probes still check the first key, and
the rotation never leaves the server.

## Auto

Auto is a picker entry with no endpoint of its own. It reads the message, picks
the model that fits, and keeps the rest of a queue behind it. Every model in
that queue is served by UnoRouter — the fifty free routes in
`lib/models/routes.ts` — and the one named model keeps the single-provider path
it had. Auto never falls back to DeepSeek.

`lib/models/registry.ts` is a capability profile for that pool — tier, task fit,
vision, search, context — and carries no endpoint, upstream id or key.

1. `classifyTask` reads the prompt once: code signals, reasoning signals, a URL or
   "click the page", an attached image. That names the task kind.
2. `planChain` orders the fifty UnoRouter routes by fitness, best fit first. A
   route with no registry profile is skipped, and a vision request is never
   queued onto a model that cannot see.
3. `streamRouted` walks the whole queue, up to fifty attempts. A failure before
   the first character retries the same request on the next model; a failure
   after it sends the text already written as an assistant turn plus one
   instruction to continue from that exact character. The rest streams into the
   same answer, and a leading replay of the tail — or of the whole partial
   answer — is trimmed as it arrives.

| Constant | Value |
|---|---|
| Queue length | 50 (`MAX_CHAIN_LENGTH`) |
| Attempts per turn | 50 (`MAX_ROUTED_ATTEMPTS`) |
| Trimmed overlap floor | 8 characters |
| Lookahead before trimming | 32 characters |

Auto's pool is `AUTO_ROUTES`, and it is available when `OPENROUTER_API_KEY` is
set: all fifty free models are attempted in fitness order until one answers. A
deployment without that key shows Auto as unavailable instead of spending a
different provider through it. The hour still costs 2 Dew whatever answers,
because `model_hour_dew` prices the model that was chosen — Auto — not the one it
routed to.

Nothing about a handover reaches the reader: no notice, no vendor name, no
"continuing". Stop is not a handover — an aborted turn stops. If every endpoint
fails after text was written, the partial answer is kept and reported as partial;
if none wrote anything, the last error is the turn's one failure.

## Accessibility

Semantic tokens only, and three appearances: paper (the default), carbon and ink.
`node scripts/check-contrast.mjs`
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
   **Production** separately. Include `CRON_SECRET` (a long random value):
   Vercel Cron sends it as a bearer token to the sandbox sweep. `vercel.json`
   asks for a daily run, which is all a Hobby plan allows; the provider's own
   idle-stop and auto-delete timers are the backstop between runs.
5. Apply migrations with `supabase link --project-ref <ref> && supabase db push`.
   Vercel does not run them; the order is always migrate, then deploy.
6. Deploy, sign in, open `/admin` → **Configuration & probes**, and make every
   row green.
7. Optional: register a GitHub OAuth App whose callback is
   `https://<domain>/auth/github/callback` and set `GITHUB_OAUTH_CLIENT_ID` /
   `GITHUB_OAUTH_CLIENT_SECRET`. Without it, connect with a fine-grained token
   instead: contents read/write, pull requests read/write, metadata read.
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
8. Open `/admin` → **Configuration & probes** and confirm the probes report
   per-service state, not "error".

## Sandbox verification

A ready changeset can be installed and built on a real Linux workspace in an
[E2B](https://e2b.dev) sandbox. The card starts the build on its own,
and a failing build gets up to two model repair passes before it is reported;
**Install and build** stays available as a manual re-run. The run seeds a copy
of the repository at the pinned commit, writes the accepted files into it, runs
the command the runner detected from the lockfile and `package.json`, and
records the exit code, the duration and the output tail.

- With no `E2B_API_KEY`, the button is disabled and the card says execution
  is not configured. Nothing else in the product depends on it.
- Every sentence comes from a stored row. A run that stops reporting says so; a
  timed-out run says it timed out; a build that exits non-zero says that.
- Tests are not run. The card never claims a test, a check or a deployment ran.
- The sandbox holds no tokens, no provider keys and no push credential. It
  cannot write to GitHub. Approval is still the only write path, and the derived
  destination is still an `openmi/agent/` branch.
- The checkout is a real clone: `origin` is the repository's public URL with
  every credential helper and askpass disabled, and `push.default=nothing`. So
  `git log`, `git diff` and a public `git fetch` behave normally, a push to a
  private repository fails immediately instead of waiting on a prompt nobody can
  answer, and nothing in the box can authenticate to GitHub.
- Egress goes through E2B's `network` option: `EXEC_NETWORK_MODE=restricted`
  (the default) sends `allowOut: ['*']` with `denyOut: ['0.0.0.0/0']`, the
  provider's catch-all pair from `lib/execution/commands.ts`. A domain or
  wildcard `allowOut` only boots when the whole IPv4 space is also denied, and
  `allowOut` wins, so an install can reach any host by name. `open` sends no
  policy; `off` takes the sandbox off the network, so no install can run.
- The sandbox boots from `EXECUTION_TEMPLATE` (default E2B's `base`) and runs as
  the template's `user`, whose home `/home/user` is the only writable root the
  file API writes into. The repository lives in
  `/home/user/openmi-workspace`; CPU and memory come from the template, so a
  repository that needs bun or pnpm preinstalled wants a custom one.
- A run reserves `0.5` Dew before the sandbox starts and settles at `0.05` Dew
  per started minute. The unused reservation is refunded through the same
  ledger, so `sum(amount)` still equals the balance.

### Bringing the sandbox back

The E2B path is implemented and switched off by configuration, not removed.
Three variables decide it:

- `E2B_API_KEY` — no key, no sandbox anywhere; the card and the setup probe say
  execution is not configured.
- `EXECUTION_ENABLED` — omit it, or set `off` to stop every box without removing
  the key.
- `OPENMI_SANDBOX_TURNS` — on by default: an eligible chat turn gets the Linux
  shell, the shell tools and the browser tool in its own persistent workspace.
  Set `off` for GitHub-only turns. Verification runs and missions read the key
  only, so they work either way.

This repository installs with `bun install --frozen-lockfile`, and E2B's default
`base` template carries node, npm and git but **not bun**. Point
`EXECUTION_TEMPLATE` at a template that has bun before expecting an install to
succeed. The activation checklist, template Dockerfile, ceilings, cost and
rollback are in [docs/E2B_SANDBOX_READINESS.md](docs/E2B_SANDBOX_READINESS.md).

### Chat environments

A chat pinned to a repository keeps **one** Linux workspace across its messages.
The first tool call in a chat creates it; later messages reattach to the same
disk, so installed packages and uncommitted files survive between answers. A
message that never runs a command still creates nothing.

- After `CHAT_SANDBOX_IDLE_MINUTES` (default 5) of inactivity the container is
  **stopped**: compute is released, the filesystem stays. The next message
  starts it again before the first command.
- After `CHAT_SANDBOX_TTL_HOURS` (default 48) of inactivity the container and
  its disk are destroyed. The chat transcript is untouched; the next message
  reseeds at the pinned commit.
- `CHAT_SANDBOX_ENABLED=off` is the rollback: every message gets a fresh box
  again, exactly as before this feature.
- `CHAT_SANDBOX_MAX_PER_OWNER` (default 3) bounds storage; the
  least-recently-active environment is evicted to make room.
- Trashing a chat stops its workspace and queues the disk for deletion;
  restoring it starts from a fresh seed. Purging destroys the container inline.
- The sweep at `/api/cron/sandbox-sweep` (`vercel.json`, once a day at 05:00
  UTC — the most often a Hobby-plan cron may run — `Authorization: Bearer
  $CRON_SECRET`, `?dry=1` to preview) enforces the deadlines, stops idle boxes,
  and destroys labelled containers that no row points at. Without `CRON_SECRET`
  it returns 503 and does nothing. The provider's own timeout still ends a box
  between runs, and every workspace open cleans up its own rows, so the daily
  run is reconciliation
  rather than the primary clock. Point any external scheduler at the route with
  the same bearer header if you want the tighter cadence.

A turn holds a lease on its workspace for the duration of the response. A
second tab on the same chat waits rather than starting a second container, and
neither the idle sweep nor the wipe may touch a leased box.

- The `browser` tool drives a page in headless Chromium through Playwright:
  open a URL, then click, fill, type, press keys, scroll or go back, up to 24
  steps per call. It returns a screenshot to the conversation plus the page's own
  status snapshot — final URL, title, HTTP status, per-step results, an excerpt
  of the page text and console errors — so the model works from what the page
  said rather than from a guess. Chromium installs itself on first use, outside
  the workspace, so it never reaches a diff. Cookies live in a session file in
  that same box, so a login survives between calls and dies with the container.
  The call's URL and steps are written to a file and read by the script, never
  spliced into a command line, so a filled password does not appear in argv or
  in an error message. The image is shown with the answer it belongs to; it is
  not stored, so a reload keeps the transcript but not the picture.

The contract, state machine and failure matrix are in
[docs/SANDBOX_LIFECYCLE_PLAN.md](docs/SANDBOX_LIFECYCLE_PLAN.md).

### Automatic verification and automatic approval

A turn that proposes a changeset keeps going on its own: the run seeds a
workspace, applies the diff, builds, and lets the model repair what failed — up
to two passes, each bounded by the run's wall-clock cap. In a verified run a
pull request opens **only if the build really exits 0**; if it still fails, the
diff stays on the card and nothing is written to GitHub. There is no switch to
turn the run on: it is the default for every ready diff.

A ready diff is written **without a click** by default: the turn ends and the
change goes straight to its own `openmi/agent/` branch and pull request, so the
card reports what was written instead of asking. `OPENMI_AUTO_WRITE=off` brings
the approval step back. With it off the card offers two choices: approve once,
or **Approve and don't ask again for this branch**, which remembers the account,
the repository and the chat's pinned branch. The default branch is not written
unless `OPENMI_ALLOW_DEFAULT_BRANCH=on` and the change names it.

That is the whole change: it moves who approves from you to the build result. It
still writes one `openmi/agent/` branch and applies it as one pull request; the
default branch is only ever the base unless you name it as the destination, and
the card still reports what was observed rather than what was hoped.

The four decisions this depends on — what may run (D6.1), what a minute costs
(D6.2), which secrets are absent (D6.3), and what the card says when a sandbox
cannot start (D6.4) — are answered in
[docs/EXECUTION_ENVIRONMENT_PLAN.md](docs/EXECUTION_ENVIRONMENT_PLAN.md).

## Rules for contributors

- Pushes are authored as **`Openmi`** — see
  [agent-push-requirements.md](agent-push-requirements.md).
- No literal palette colours in components: use the semantic tokens
  (`bg-canvas`, `text-low`, `border-line`). There is no override block and there
  will not be one.
- A new table gets RLS enabled in the migration that creates it.
- A new limit is a named constant with a test that reads it.
- Do not claim verification the product does not perform.
