# Openmi — Build Phases

**Target:** a greenfield Openmi web app on **Vercel** (hosting) and **Supabase** (Postgres, Auth, RLS).
**Status:** phases 0–4 are built, checked and pushed to `main`. Phases 5–10 are open. This file is the build order: eleven phases, one merge window each, one task per pull request.
**Repository state:** wiped at the start of this plan. See §1 for what was removed and what was kept.

---

## Contents

1. [Wipe record](#1-wipe-record)
2. [How to use this document](#2-how-to-use-this-document)
3. [Target stack and topology](#3-target-stack-and-topology)
4. [Product contract](#4-product-contract)
5. [Invariants — do not "fix" these](#5-invariants--do-not-fix-these)
6. [Environment contract](#6-environment-contract)
7. [Data model and migration map](#7-data-model-and-migration-map)
8. [Phase map](#8-phase-map)
9. [Phase 0 — Foundation and truth](#9-phase-0--foundation-and-truth)
10. [Phase 1 — Auth, shell, history](#10-phase-1--auth-shell-history)
11. [Phase 2 — GitHub and repo workspace](#11-phase-2--github-and-repo-workspace)
12. [Phase 3 — Chat core](#12-phase-3--chat-core)
13. [Phase 4 — Repo agent](#13-phase-4--repo-agent)
14. [Phase 5 — Changesets and review](#14-phase-5--changesets-and-review)
15. [Phase 6 — Approval, branch, pull request](#15-phase-6--approval-branch-pull-request)
16. [Phase 7 — Dew billing](#16-phase-7--dew-billing)
17. [Phase 8 — Setup and about truth surface](#17-phase-8--setup-and-about-truth-surface)
18. [Phase 9 — Hardening and launch](#18-phase-9--hardening-and-launch)
19. [Phase 10 — Execution (gated, not v1)](#19-phase-10--execution-gated-not-v1)
20. [Requirement coverage](#20-requirement-coverage)
21. [Open decisions](#21-open-decisions)
22. [Per-PR gates](#22-per-pr-gates)
23. [Deploy runbook](#23-deploy-runbook)
24. [Rollback](#24-rollback)

---

## 1. Wipe record

Everything tracked was deleted before this plan was written. Nothing was migrated forward; there is no code to carry over.

| Removed | What it was |
|---|---|
| `OPENMI_ARCHITECTURE_AUDIT.md` | 15-finding audit of the old `test` tree |
| `OPENMI_ARCHITECTURAL_UI_UX_AUDIT.md` | Superseded, earlier product shape |
| `OPENMI_BUILD_PHASES.md` | The old phase plan (replaced by this file) |
| `patches/phase-0-1-verified.patch` | Patch for the old repo |
| `README.md` | One line: `# Openmi-V2` |

**Kept, deliberately:** [`agent-push-requirements.md`](agent-push-requirements.md). Every push must configure the author as **`Openmi`** — no platform or system fallback handle. That rule applies to every task below.

---

## 2. How to use this document

**One phase = one merge window.** Phases are ordered so each one is verifiable against the last, and so the cheap, provable work lands before anything that touches money or GitHub writes.

**One task = one pull request.** Task IDs are stable (`P2-T3`). Each task names its work, its acceptance criterion, and the check that proves it in CI. A task that cannot name a proving check is not ready to build.

**Definition of ready.** The files it touches exist in the tree; the change is described as a diff-shaped instruction, not a goal; acceptance is measurable by a command or an assertion.

**Definition of done (per phase).** Every task merged; the phase gate in §8 satisfied; `bun run test` green; the phase's rows in §20 marked built.

**Branching.** `phase-<n>/<task-id>-<slug>`, branched from `main`. Agent-authored branches are unrelated to this and must not be reused.

**Line numbers in this file are anchors, not identifiers.** Re-grep before editing.

---

## 3. Target stack and topology

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15 App Router, React 19, TypeScript strict | Streaming route handlers, first-class Vercel target |
| Styling | Tailwind CSS v4 + CSS custom properties per theme | Tokens, not literal colours (see §5.7) |
| Package manager | Bun (`bun.lock`) | Matches existing repo conventions; Vercel supports it |
| Database | Supabase Postgres | Managed Postgres + RLS is the authority for every table |
| Auth | Supabase Auth, `@supabase/ssr` cookie sessions | Cookie session means middleware can gate `/chat` honestly |
| Files in repos | GitHub API, read-only by construction | GitHub is the source of truth; no mirror to keep in sync |
| Hosting | Vercel, Node runtime for route handlers | Streaming SSE, server-only secrets |
| Secrets | Vercel env (Preview + Production), Supabase secrets | Never in the repo; never `NEXT_PUBLIC_` unless browser-safe |

**Vercel constraints that shape the design.** Route handlers are request-scoped; there is no daemon, no durable queue and no background worker. A turn therefore has a wall-clock ceiling (`maxDuration`: 60s on Hobby, 300s on Pro). The agent is therefore **bounded by design** (§Phase 4) and a turn that outlives the function returns a signed continuation token rather than dying silently. Nothing in this plan relies on a cron or a long-lived process.

**Supabase constraints that shape the design.** Every table gets `enable row level security` in the same migration that creates it. The service-role key is server-only and confined to one module. `security definer` functions set `search_path = public` and take no price parameters.

---

## 4. Product contract

**What Openmi is.** A signed-in user connects GitHub, picks one repository, and chats with a model that can read that repository and propose edits. Answers cite real paths and line numbers. Proposed edits arrive as a reviewable diff. A commit happens only after an explicit approval click, and it lands on a new branch as a pull request — never on the default branch.

**What it is not, in v1.**

- Not an executor: no sandbox, no `npm test`, no preview server. The UI never says a build ran.
- Not an app generator: no "create a project from nothing".
- Not per-message billing: one hour of chat costs a flat amount, however many messages it holds.
- No guest mode.

**The one claim the product must never make:** that it verified anything it did not run. The review card says what the model proposed and what the human approved. Nothing else.

---

## 5. Invariants — do not "fix" these

1. **One charge function, no price parameter.** `start_hour_session()` takes a model and a repo, never an amount. A signed-in caller cannot buy an hour cheaply.
2. **`hour_sessions.owner` is the primary key.** A second concurrent session is structurally impossible, not merely discouraged by a check.
3. **The GitHub read client is GET-only by construction**, and one write module is the only path to a commit. A test asserts both.
4. **Change-set signature covers `baseSha` + content hash and excludes `status`.** A lifecycle move can never invalidate an approved artefact, and a content change can never sneak past one.
5. **RLS is the authority**, not the route guard. Middleware and route checks are defence in depth; the decision lives in Postgres.
6. **No default-branch writes, ever.** The branch policy is enforcement in code, not a configuration toggle.
7. **Service role stays confined** to `lib/supabase/admin.ts` and the migration/health surface.
8. **No literal palette colours in components.** Semantic tokens only; a ratchet test enforces the direction of travel.
9. **Nothing that costs money runs before the charge is recorded.** The gate is before the model call, not after.
10. **No claim of verification the product does not perform** — in code, comments, docs or UI copy.

---

## 6. Environment contract

`.env.example` is the source of truth for names. The setup page (§Phase 8) reports presence, never values.

| Variable | Scope | Needed by | Required |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + server | Supabase clients | yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + server | Supabase clients | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | migrations, health probe | yes |
| `NEXT_PUBLIC_SITE_URL` | Browser + server | auth redirects, PR links | yes |
| `GITHUB_TOKEN_KEY` | **server only** | sealing connected GitHub tokens (32-byte base64) | yes |
| `OPENROUTER_API_KEY` | **server only** | Auto's fifty free OpenRouter models | one provider |
| `DEEPSEEK_API_KEY` | **server only** | the named DeepSeek model | one provider |
| `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` | server | optional OAuth connect (P2-T6) | no |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | server | optional shared rate limiter | no |

**Rules.**

- A missing key never throws at boot. The app starts, and the surface that needs the key says what is missing. "Nothing is required to boot" is a product posture, not an oversight.
- `NEXT_PUBLIC_*` is compiled into the browser. No key, token or service-role value may take that prefix.
- Vercel environments are separate: set the same names under **Preview** and **Production**. Preview uses a Supabase branch or a second project, never production data.

---

## 7. Data model and migration map

Migrations live in `supabase/migrations/` and are applied with `supabase db push`. Every migration must apply twice cleanly (`bun run check:migrations`).

| File | Phase | Tables / functions |
|---|---|---|
| `001_profiles.sql` | 1 | `profiles`, trigger `on auth.users insert` |
| `002_chats.sql` | 1 | `folders`, `chats`, `messages` (+ `seq`), indexes |
| `003_github.sql` | 2 | `github_connections`, the chat commit pin |
| `004_chat.sql` | 3 | `append_message()` — per-chat sequence, first-message title |
| `005_agent.sql` | 4 | `agent_turns`, `consume_agent_step()` |
| `006_changesets.sql` | 5 | `changesets`, `changeset_files` |
| `007_dew.sql` | 7 | `hour_sessions`, `dew_transactions`, `invites`, `start_hour_session()`, `refund_hour()` |
| `008_rls.sql` | 1–7, extended per phase | all policies + `revoke all from anon, authenticated` where it moves money or identity |
| `009_rate_limit.sql` | 9 | `rate_limits`, `rate_limit_hit(bucket, window_start, max)` |

**Shape notes.**

- `messages.seq` is a per-chat `bigint` assigned by the insert path; reads order by `(seq, created_at)`. `created_at` is display metadata, not order.
- `github_connections.token_sealed` is AES-256-GCM under `GITHUB_TOKEN_KEY`, format `v1.<iv>.<tag>.<ciphertext>`. Only the last four characters of the token are ever returned to the browser.
- `changesets` stores `base_sha`, `branch`, `title`, `summary`, `status`, `content_hash`, `signature`, `pr_url`, `pr_number`, `commit_sha`.
- `hour_sessions(owner uuid primary key, model text, repo text, started_at, expires_at)` — no surrogate key, deliberately.
- `dew_transactions` is an append-only ledger: `(id, owner, delta, kind, reason, ref, created_at)`. Balance is derived, with a cached column updated in the same transaction.

---

## 8. Phase map

```
P0 foundation
   ├── P1 auth/shell ── P2 github ── P3 chat ── P4 agent ── P5 review ── P6 commit/PR
   │                                                                        │
   └──────────────── P7 billing ────────────────────────────────────────────┤
                                                                            ├── P9 launch
   P8 setup/about (starts P0, completed after P7) ──────────────────────────┘
                                                                            └── P10 execution (gated)
```

| Phase | Name | Tasks | Depends on | Exit gate |
|---|---|---|---|---|
| **P0** | Foundation and truth | 6 | — | Builds with zero env vars; `/setup` lists every gap; migrations apply twice |
| **P1** | Auth, shell, history | 7 | P0 | Two accounts isolated; signed-out `/chat` redirects; trash round-trips |
| **P2** | GitHub and repo workspace | 6 | P1 | Token never reaches the browser; no write path outside the commit module |
| **P3** | Chat core | 6 | P2 | Stream and stop work; order stable across devices; every citation resolves |
| **P4** | Repo agent | 5 | P3 | Replayed turn rejected; cap message truthful; no tool writes |
| **P5** | Changesets and review | 5 | P4 | Signature breaks on content change, survives a status change |
| **P6** | Approval, branch, PR | 5 | P5 | Commit-refusal test green; PR only from approval; default branch untouched |
| **P7** | Dew billing | 8 | P3 | Concurrent start impossible; exactly 3 Dew/hour; ledger sums to balance |
| **P8** | Setup and about | 4 | P0, P7 | `/setup` accurate at zero config and at full config |
| **P9** | Hardening and launch | 6 | P6, P7, P8 | RLS audit green; contrast gate green; smoke tests pass |
| **P10** | Execution (gated) | 4+ | P9, §21 D6 | Review card can truthfully say "tests passed" |

**Why this order.** P0 first because every later phase needs the migration harness and an honest setup page. P2 before P3 because a chat about a repository with no repository is a chat about nothing. P5 before P6 because the approval gate is only meaningful if the artefact is signed before it can be committed. P7 lands after chat exists so the charge has something to gate, and before P8 so the setup page can report billing state truthfully.

---

## 9. Phase 0 — Foundation and truth

**Outcome:** a deployable skeleton where configuration gaps are visible instead of fatal.
**Contract:** no product behaviour yet.

| Task | Work | Acceptance |
|---|---|---|
| **P0-T1** | Scaffold Next.js 15 App Router + TS strict + Tailwind v4 + Bun. One page, no logic. | `bun run build` succeeds on a bare clone |
| **P0-T2** | `lib/env.ts` (server, non-throwing) and `lib/envPublic.ts`; `.env.example` naming every key in §6; degraded-mode contract documented | Importing env with nothing set returns typed `missing[]`, never throws |
| **P0-T3** | Supabase clients: browser, server-cookie (`@supabase/ssr`), and `lib/supabase/admin.ts` (service role, server-only) | Only `admin.ts` imports the service-role key; a grep test asserts it |
| **P0-T4** | `supabase/migrations/` harness + `scripts/check-migrations.mjs` applying every migration twice to a throwaway Postgres | `bun run check:migrations` exits 0; a deliberately broken migration exits 1 |
| **P0-T5** | `/setup` v1: env presence table (present/missing, never values) and migration status | With zero env vars the page renders and names every gap |
| **P0-T6** | CI: typecheck, test, check:migrations, build-with-no-secrets; commit author `Openmi` per `agent-push-requirements.md` | Workflow green on a PR; build step has no secrets in scope |

**Phase gate:** `bun run build` with an empty `.env`; `/setup` accurate; migrations apply twice; no service-role reference outside `admin.ts`.

---

## 10. Phase 1 — Auth, shell, history

**Outcome:** a signed-in user with their own history, folders and trash. No repository, no chat yet.

| Task | Work | Acceptance |
|---|---|---|
| **P1-T1** | `001_profiles.sql`: `profiles(id → auth.users, handle, timezone, created_at)` + insert trigger | Signup creates exactly one profile row |
| **P1-T2** | Email + password signup/signin via Supabase Auth, `/auth/callback`, sign-out; cookie session through `@supabase/ssr` | Signed-out `/chat` → `/login?next=/chat`; signed-in stays |
| **P1-T3** | `middleware.ts`: cookie-presence gate for `/chat`, `/settings`, `/activity` — presence only, no authorization decision | Clearing cookies redirects; RLS still refuses data on a forged cookie |
| **P1-T4** | App shell: sidebar, header, user menu, Dew chip placeholder, responsive breakpoints, focus and reduced-motion support | Renders at 360px and 1440px; keyboard reaches every control |
| **P1-T5** | `002_chats.sql`: `folders`, `chats` (with `folder_id`, `deleted_at`); RLS on both; sidebar CRUD | Forked request with another user's id returns zero rows, not another user's row |
| **P1-T6** | Trash: soft delete, restore, purge-forever, empty-trash; chats and folders | Delete → restore → purge round-trips; purge removes dependent messages by cascade |
| **P1-T7** | Chat history list with recency grouping, titles from the first user message, empty state | New account shows an empty state with one clear next action |

**Phase gate:** two accounts see only their own rows (anon key, no service role); auth redirect works with a cookie and fails closed without one.

---

## 11. Phase 2 — GitHub and repo workspace

**Outcome:** a connected account, a picked repository, and a read-only workspace pinned to one commit.

| Task | Work | Acceptance |
|---|---|---|
| **P2-T1** | `003_github.sql` + connect route: seal a PAT with AES-256-GCM under `GITHUB_TOKEN_KEY`, store `login`, `scopes`, `sealed`; disconnect; `/api/github/status` returns login + last four only | Response JSON never contains the token; `crypto` test covers seal→open and a tampered tag |
| **P2-T2** | `lib/github/read.ts`: GET-only client for user, repos, tree, contents, search; no write verbs imported anywhere | Test greps every `lib/github/*` file for non-GET fetch calls and fails on a match |
| **P2-T3** | Repo picker: every repo the token can read, private badge, sort and filter, recent list | A repo the token cannot read is absent, not erroring |
| **P2-T4** | Workspace pane: branch picker → recursive tree → file viewer with line numbers; pin `baseSha` on selection | Selecting a file shows its blob at the pinned sha; switching branch resets the pin |
| **P2-T5** | Search: instant path filter over the cached tree; code search via GitHub search with caps (20 hits, 10 candidates) | A query returns path + line per hit; a hit opens the viewer at that line |
| **P2-T6** *(optional)* | GitHub OAuth App flow writing the same sealed row | OAuth and PAT connections are indistinguishable downstream |

**Phase gate:** token never reaches the browser in any route or RSC payload; no write verb outside `lib/github/write.ts` (added in P6).

---

## 12. Phase 3 — Chat core

**Outcome:** a streaming conversation that knows which repository is attached and cites it precisely.

| Task | Work | Acceptance |
|---|---|---|
| **P3-T1** | `lib/models.ts`: capability ids (`auto`, `code`, `flash`), display names, capability matrix (images, documents); vendor ids and keys stay server-side in `lib/providers.ts` | Browser bundle contains no provider id or key; a test asserts the model file has no vendor names |
| **P3-T2** | `/api/chat` SSE route on Node runtime: adapters for each provider, fallback chain for `auto`, abort propagation, `no-store` | Tokens arrive incrementally (<250ms to first byte on a live key); abort stops upstream spend |
| **P3-T3** | Message persistence with server-assigned `seq`; optimistic local ordering before sync; reconcile on refresh | Two clients inserting in the same millisecond read back the same order |
| **P3-T4** | Citation rendering: `path:line` in an answer becomes a link that opens the workspace viewer at that line | Every rendered citation resolves to a real path at the pinned sha, or renders as plain text |
| **P3-T5** | Stop generation, retry, and honest error surfaces (provider down, key missing, rate limited) | No error path renders a fabricated assistant answer |
| **P3-T6** | Context assembly: attached repo tree summary + pinned file + explicit selection, budgeted with a visible "context used" meter | Exceeding the budget trims with a stated reason and never silently drops the pinned file |

**Phase gate:** stream, stop and error paths behave; two-device ordering stable; citations resolve.

---

## 13. Phase 4 — Repo agent

**Outcome:** the model can read the repository through tools, and its budget cannot be rewound.

| Task | Work | Acceptance |
|---|---|---|
| **P4-T1** | HMAC turn envelope (`turn_id`, `exp`, `model`, `prompt_hash`) + `agent_turns` row updated by compare-and-set (`where turn_id=$1 and owner=auth.uid() and steps=$2`) | Replaying an older valid token returns `409` and does not decrement `steps` |
| **P4-T2** | Tools: `list_files` (≤200 paths), `read_file` (≤200KB), `search_code` (≤10 candidates, ≤20 hits) — all GET, all server-side | Each tool refuses over-cap input with a typed error; no tool accepts a URL |
| **P4-T3** | Streamed step events: announcement before the call, completion after, prose interleaved | The transcript shows `read lib/db.ts ✓` before the text that depends on it |
| **P4-T4** | Budget: `MAX_STEPS = 24`, `MAX_TURN_TOKENS = 120_000`, `TURN_TTL_MS = 30 min`; cap message states which limit was hit; signed continuation token when the function nears `maxDuration` | Hitting the cap produces a truthful message; a continued turn resumes without re-billing |
| **P4-T5** | System contract: cite paths and line numbers, never claim a build or test ran, say when a read failed | A test asserts the prompt contains the no-fabrication clause and the UI has no "tests passed" string |

**Phase gate:** replay rejected; caps truthful; tool surface read-only.

---

## 14. Phase 5 — Changesets and review

**Outcome:** proposed edits arrive as a signed, reviewable diff. Nothing is written to GitHub.

| Task | Work | Acceptance |
|---|---|---|
| **P5-T1** | `propose_edits` tool → `changesets` + `changeset_files`: whole-file write or exact string replacement; ≤6 edits per call, ≤120KB per edit | A replacement whose anchor is absent fails that file and says so |
| **P5-T2** | Diff engine: unified diff per file, `MAX_DIFF_CHARS = 60_000`, `MAX_DIFF_LINES = 2_000`, explicit truncation notice | Truncated diff says it is truncated; no silent clipping |
| **P5-T3** | Review UI: file list, per-file diff, accept/reject per file, base-sha staleness warning | Rejecting a file removes it from the commit set and the card says so |
| **P5-T4** | Signature: HMAC over `changeset_id + base_sha + content_hash`, `status` excluded, `CHANGESET_TTL_MS = 6h` | Editing a byte of content invalidates; moving `open` → `approved` does not |
| **P5-T5** | Review card states: draft, ready, approved, committed, failed, expired — each reachable from a real observation | No state is rendered optimistically |

**Phase gate:** signature semantics proven both ways; no commit path exists yet; the card never claims verification.

---

## 15. Phase 6 — Approval, branch, pull request

**Outcome:** one click creates a branch and opens a PR. The default branch is unreachable by construction.

| Task | Work | Acceptance |
|---|---|---|
| **P6-T1** | Approve route: verify owner, signature, TTL and `status = 'open'` before anything else | A tampered or expired changeset returns `409` and commits nothing |
| **P6-T2** | `lib/github/write.ts`: create ref `openmi/agent/<changeset-id>`, commit all accepted files in one Git tree commit, open a PR against the recorded base | Exactly one commit and one PR per approval; a retry with the same idempotency key returns the same PR |
| **P6-T3** | Branch policy: prefix enforced, base compared to the repo default branch, refusal is `403 "Openmi only commits to agent/ branches."` | Test asserts refusal for the default branch and for a user-supplied branch name |
| **P6-T4** | Persist `pr_url`, `pr_number`, `commit_sha`; review card links out; activity records the approval | Card links to the real PR; no PR is created before approval |
| **P6-T5** | Failure handling: partial commit, permission denied, stale base — each surfaced with its own message and no retry storm | Each failure has a distinct message; none consumes a second Dew hour |

**Phase gate:** commit-refusal test green; a PR exists only after an approval; default branch has no new commits in the test repo.

---

## 16. Phase 7 — Dew billing

**Outcome:** an hour of chat costs a flat amount, paid before the model call, with a ledger and a history page.

| Task | Work | Acceptance |
|---|---|---|
| **P7-T1** | `lib/dew.ts`: `DEW_PER_HOUR = 3`, `HOUR_SESSION_MS = 3_600_000`, `DAILY_FREE_DEW = 10`, `PAID_DAILY_FREE_DEW = 15`, `TRIAL_DEW = 5`, precision 3, dust floor 0.05, low balance 10 | A docs test asserts every documented number equals its exported constant |
| **P7-T2** | `006_dew.sql`: `hour_sessions(owner pk)`, `start_hour_session(model, repo)` `security definer`, advisory lock, no price parameter | Two concurrent calls yield one session and one charge; the function signature has no amount argument |
| **P7-T3** | Charge gate on `/api/chat` and agent routes: no active hour → `402` before any provider call; spend free bucket, then paid credit | A refused request makes no upstream call (asserted with a stubbed fetch) |
| **P7-T4** | `dew_transactions` ledger; daily refill at local midnight in the account's timezone; a `dailyDay` ahead of today does not refill | Clock-backwards fixture does not refill; ledger sums to the cached balance |
| **P7-T5** | `/activity`: ledger entries, hour sessions, per-chat usage, empty state | Totals match the ledger exactly |
| **P7-T6** | Invites: personal code, attribution at signup, reward both sides, ledger `kind='invite'`, per-account cap | Self-invite and re-use are refused; rewards appear once |
| **P7-T7** | Refunds: provider failure, abort before first token, operator correction — three explicit paths, each writing a ledger row | Each path tested; no refund exceeds the original charge |
| **P7-T8** | Low-balance state, top-up packs, redeem code (operator-issued), purchase history | Balance below 10 turns the chip amber; a used code cannot be reused |

**Phase gate:** concurrent start impossible by primary key; exactly 3 Dew per hour; ledger and cached balance agree after every test.

---

## 17. Phase 8 — Setup and about truth surface

**Outcome:** one page that tells a new deployer exactly what is missing, and one page that says exactly what the product does.

| Task | Work | Acceptance |
|---|---|---|
| **P8-T1** | `/setup`: every variable from §6 with present/missing, which feature each unlocks, and the exact fix | Accurate at zero config and at full config; never prints a value |
| **P8-T2** | Migration status: applied versions, pending files, checksum drift against `supabase/migrations` | A hand-edited applied migration shows as drift, not as "up to date" |
| **P8-T3** | Live probes: Supabase reachable, GitHub token decrypts, each AI provider responds, RLS smoke test (anon select returns empty) | Each probe reports its own failure, not a generic "error" |
| **P8-T4** | `/about`: what the product does and does not do, the branch policy, the hourly price, the no-execution statement | No claim exists that the code does not perform |

**Phase gate:** `/setup` is the single answer to "why is this not working"; `/about` survives a sceptical read.

---

## 18. Phase 9 — Hardening and launch

| Task | Work | Acceptance |
|---|---|---|
| **P9-T1** | RLS audit: two accounts, anon key, direct REST calls against every table | No cross-account read or write succeeds; anon sees nothing |
| **P9-T2** | Accessibility: semantic tokens only, every text pair ≥4.5:1, accent fills ≥4.5:1, focus visible, reduced motion honoured; contrast gate in CI | Script exits 1 when a token regresses; audit of all three themes is clean |
| **P9-T3** | Rate limiting: `rate_limit_hit(bucket, window_start, max)` atomic upsert; Upstash used when configured; absent limiter degrades, never blocks boot | Burst across two instances shares one counter |
| **P9-T4** | Playwright smoke: sign-in, pick repo, stream a chat, approve-to-refusal on the default branch | Four specs pass locally; unauthenticated specs run in CI |
| **P9-T5** | Vercel specifics: per-route `maxDuration`, `dynamic = "force-dynamic"`, `no-store`, `X-Accel-Buffering: no`, region choice, no cron dependency | Streaming verified on the deployed preview, not just locally |
| **P9-T6** | `README.md` + runbook §23, screenshots, known limitations, manual test steps | A fresh reader can deploy without asking a question |

**Phase gate:** RLS audit green; contrast green; smoke tests green; streaming verified on Vercel.

---

## 19. Phase 10 — Execution (gated, not v1)

**Status: built, verification only.** The four decisions are answered in
`docs/EXECUTION_ENVIRONMENT_PLAN.md`: enumerated commands, 0.05 Dew per started
minute, no secrets in the sandbox, and a specific state for every way a run can
fail. What ships is the verification half of this phase — seed, apply, install,
build — because it is the half whose result can be observed and stated without
inventing anything. The agent does not yet run commands of its own inside the
workspace; its edits still arrive as a changeset, which is exactly what a run
verifies.

| Task | Work | Blocked on |
|---|---|---|
| **P10-T1** | Design doc: what runs, where, for how long, at what cost, with which secrets absent | D6.1–D6.4 |
| **P10-T2** | Provider selection and a cost model in Dew/hour | D6.2 |
| **P10-T3** | Wire results into the review card, including failure text | P10-T1 |
| **P10-T4** | Contract tests: "tests passed" is impossible without a real run; a failed run cannot render as success | P10-T3 |

The rule that cannot be relaxed: **every card state must be reachable from a real observation.** Timeout says timed out. Cannot start says cannot start. There is no optimistic default.

---

## 20. Requirement coverage

| Requirement | Phase | Tasks |
|---|---|---|
| Account sign-in | 1 | P1-T1, P1-T2 |
| Connect GitHub | 2 | P2-T1 (OAuth: P2-T6) |
| Pick a repository | 2 | P2-T3 |
| Browse files | 2 | P2-T4 |
| Read code | 2, 3 | P2-T4, P3-T4 |
| Search the repo | 2, 4 | P2-T5, P4-T2 |
| Answer with real paths and line references | 3, 4 | P3-T4, P4-T5 |
| Suggest edits as a reviewable diff | 5 | P5-T1, P5-T2, P5-T3 |
| Nothing pushed until approve + commit | 5, 6 | P5-T4, P6-T1 |
| Approve → branch + pull request | 6 | P6-T2, P6-T3, P6-T4 |
| Never touch the default branch | 6 | P6-T3 |
| Chat history | 1, 3 | P1-T7, P3-T3 |
| Repo workspace | 2 | P2-T4, P2-T5 |
| Sidebar with folders and trash | 1 | P1-T5, P1-T6 |
| Dew credits | 7 | P7-T1 → P7-T3 |
| Daily free usage | 7 | P7-T4 |
| Activity history | 7 | P7-T5 |
| Invite rewards | 7 | P7-T6 |
| Setup/about page showing missing keys or migrations | 0, 8 | P0-T5, P8-T1 → P8-T4 |
| Vercel + Supabase deployment | 0, 9, §23 | P0-T3, P9-T5, runbook |

---

## 21. Open decisions

| ID | Decision | Blocks | Recommendation |
|---|---|---|---|
| **D1** | Sign-in method: email + password, magic link, GitHub OAuth, or all three? | P1-T2 | Email + password plus magic link; GitHub OAuth stays a connect flow, not a login |
| **D2** | Does a chat belong to one repository permanently, or can the attachment change mid-thread? | P3-T1, P5-T1 | One repository per chat; a new repo starts a new chat, so a diff always has one base |
| **D3** | A shared rate limiter without Upstash: Postgres RPC or per-instance? | P9-T3 | Postgres RPC. No new vendor, and the app must boot unconfigured |
| **D4** | Is Dew spendable on an agent turn separately from chat, or does one hour cover both? | P7-T3, P4-T4 | One hour covers both; the caps bound cost, not price |
| **D5** | Top-up: manual receipt upload, redeem codes, or a payment provider? | P7-T8 | Redeem codes in v1; a provider is its own project with tax and webhook work |
| **D6.1** | What may the sandbox execute? | P10-T1 | Enumerated commands, never "the project's tests" |
| **D6.2** | How is sandbox time priced in Dew? | P10-T2 | Per minute, prepaid, refused before start |
| **D6.3** | Which secrets are absent from the sandbox? | P10-T1 | All of them |
| **D6.4** | What happens when the sandbox cannot start? | P10-T3 | The card says so, and the gate stays closed on a claim |

---

## 22. Per-PR gates

Every PR runs the same commands, and all must be green before review:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run check:migrations
NEXT_PUBLIC_SITE_URL=https://ci.invalid bun run build
```

Once Phase 9 lands, plus:

```bash
node scripts/check-contrast.mjs
bun run test:rls
```

**Reviewer checklist.**

- [ ] No invariant in §5 was touched.
- [ ] Any new limit is a named constant with a test that reads it, not a literal in a handler.
- [ ] Any new table has RLS enabled in the same migration, with a policy keyed on `auth.uid()`.
- [ ] Any migration applies twice cleanly.
- [ ] No literal palette colour in a component; no new `!important` override.
- [ ] No secret in a `NEXT_PUBLIC_*` variable, a log line, or a client bundle.
- [ ] No claim of verification the product does not perform — in code, comments, docs or UI copy.
- [ ] The PR names the task id it closes.
- [ ] Pushes are authored as **`Openmi`** — see [`agent-push-requirements.md`](agent-push-requirements.md).

---

## 23. Deploy runbook

**First deploy**

1. Create the Supabase project. Copy the project URL, anon key and service-role key.
2. Generate a 32-byte base64 `GITHUB_TOKEN_KEY` (`openssl rand -base64 32`).
3. In Supabase → Authentication → URL configuration, add `https://<domain>/auth/callback` and `http://localhost:3000/auth/callback`.
4. Import the repo into Vercel; set every key from §6 under **Preview** and **Production** separately.
5. Apply migrations: `supabase link --project-ref <ref> && supabase db push`. Vercel does not run these; order is migrate, then deploy.
6. Deploy. Open `/setup` and confirm every row is green.
7. Connect GitHub with a fine-grained PAT scoped to the repositories you intend to use: **contents: read/write, pull requests: write, metadata: read**.
8. Pick a repo, send one message, approve one trivial change, confirm the PR target is `openmi/agent/...`.

**Ongoing**

- Migrations are applied before the deploy that depends on them; never after.
- Rotating `GITHUB_TOKEN_KEY` invalidates existing sealed tokens; users reconnect. Plan it as a maintenance window.
- Preview deployments use a Supabase branch or a second project. Never point Preview at production data.

**Known limits to state in the README**

- Turns are bounded by `maxDuration`; a long turn returns a continuation rather than a background job.
- Top-ups are operator-issued codes in v1.
- No execution of any kind: the product reads and proposes, it does not run.

---

## 24. Rollback

| Phase | Revertible by `git revert`? | Notes |
|---|---|---|
| 0 | yes | No migrations beyond 001, which is additive |
| 1 | yes | `001`, `002` additive; dropping tables needs a manual migration |
| 2 | yes | `003` additive |
| 3–4 | yes | `004` additive; sealed tokens remain usable |
| 5–6 | yes | `005` additive; an open PR is a GitHub artefact, not a database row |
| 7 | partially | `006` adds money tables; revert leaves them unused, which is acceptable because nothing drops a column the app still selects |
| 8–9 | yes | No schema change |

A revert never deletes a PR that was already opened. That is a human decision on GitHub, not a deploy step.

---

*Plan written for a greenfield Vercel + Supabase build. Every task names its proving check; a task that cannot name one belongs in §21 instead.*
