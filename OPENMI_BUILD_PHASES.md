# Openmi — Build Phases

**Source of truth:** `OPENMI_ARCHITECTURE_AUDIT.md`, taken from `LOWENDLAGANI/Openmi` branch `test` @ `08a049d`.
**Scope:** the 15 findings in that register, sequenced into phases that can each be merged on their own.
**Status:** ready to build from **Phase 0** through **Phase 5**. Phase 6 is design-gated and deliberately not buildable yet.

---

## Contents

1. [How to use this document](#1-how-to-use-this-document)
2. [Verified baseline](#2-verified-baseline)
3. [Invariants — do not "fix" these](#3-invariants--do-not-fix-these)
4. [Phase map](#4-phase-map)
5. [Phase 0 — Baseline and truth](#5-phase-0--baseline-and-truth)
6. [Phase 1 — Accessibility gates](#6-phase-1--accessibility-gates)
7. [Phase 2 — Money, identity and determinism](#7-phase-2--money-identity-and-determinism)
8. [Phase 3 — Edge and abuse surface](#8-phase-3--edge-and-abuse-surface)
9. [Phase 4 — Runtime confidence](#9-phase-4--runtime-confidence)
10. [Phase 5 — Structural debt](#10-phase-5--structural-debt)
11. [Phase 6 — Execution (gated)](#11-phase-6--execution-gated)
12. [Coverage matrix](#12-coverage-matrix)
13. [Open decisions](#13-open-decisions)
14. [Per-PR gates](#14-per-pr-gates)

---

## 1. How to use this document

**One phase = one merge window.** Phases are ordered so that each one can be verified against the last, and so that the cheap, high-confidence work lands before anything that touches money or the agent.

**One task = one pull request.** Task IDs are stable (`P2-T3`). Every task names its files, the change, the acceptance criterion that proves it, and the check that runs in CI. If a task cannot name a proving check, it is not ready to build and belongs in [§13](#13-open-decisions) instead.

**Definition of ready (per task).** File paths exist at `08a049d`; the change is described as a diff-shaped instruction, not a goal; the acceptance criterion is measurable by a command or a test assertion.

**Definition of done (per phase).** Every task merged; the phase gate in [§4](#4-phase-map) satisfied; no regression in `bun run test`; the phase's findings closed in the audit with the commit sha that closed them.

**Branching.** Work branches from the current default branch as `phase-<n>/<task-id>-<slug>`. The agent's own branch policy (`agent/*`) is unrelated to this and must not be reused.

**Everything below assumes the repository is `test` @ `08a049d`.** Line numbers are anchors for reading, not stable identifiers — re-grep before editing.

---

## 2. Verified baseline

Re-measured at `08a049d` while writing this plan. Where these differ from the audit, **these are correct** and the audit was approximate.

| Fact | Value | Location |
|---|---|---|
| `MAX_STEPS` | `40` | `lib/agent/turns.ts:17` |
| `MAX_TURN_TOKENS` | `200_000` | `lib/agent/turns.ts:19` |
| `TURN_TTL_MS` | `30 * 60_000` | `lib/agent/turns.ts:21` |
| Client-held turn state | comment: "The client can read it and send it back" | `lib/agent/turns.ts:8` |
| `--text-low` | `#5d7167` / `#8a8172` / `#837e96` | `app/globals.css:20`, `:81`, `:133` |
| `--on-accent` | `#ffffff` / `#15130f` / `#ffffff` | `app/globals.css:27`, `:88`, `:140` |
| `.on-accent` rule | `396`, light override `400` | `app/globals.css` |
| Theme override block | lines **167–411**; **115** grouped selector rules; **49** `!important` declarations | `app/globals.css` |
| Seal format | `v1.<iv>.<tag>.<ciphertext>` | `lib/github/crypto.ts:57–64`; open `:77–80` |
| `GITHUB_TOKEN_KEY` reads | key, borrowed turn secret, borrowed seal fallback | `lib/github/crypto.ts:32`, `:46`, `:52` |
| `PRODUCT_NAME` whitelist | `lib/models.ts:146`, silent `"Openmi"` fallback `:150` | `lib/models.ts` |
| Message ordering | `nextMessageTime` | `lib/db.ts:404` |
| Memory residue | `syncMemoryUp` `:800`, `syncMemoryDelete` `:821`, `loadMemoriesFromAccount` `:840`; `Memory` at `lib/types.ts:218` | `lib/cloudHistory.ts` — the Dexie store is **already** gone |
| Rate limiter | Redis when `UPSTASH_*` is set, per-instance otherwise; presence reported at `lib/setupChecks.ts:72` | `lib/rateLimit.ts`, `lib/serverControl.ts:340–347` |
| CSP | `script-src … 'unsafe-inline'`; `style-src … 'unsafe-inline'` | `next.config.mjs:82`, `:83` |
| Last migration | `20261029000600_agent_runs_service_grants.sql` | `supabase/migrations/` |
| Browser test tooling | none — no Playwright, Puppeteer, Vitest or Jest in `package.json` | `package.json` |

**Corrections to the audit, recorded so the plan does not inherit them:**

- The override block is **167–411**, not "209–330". It is **245 lines containing 115 grouped selector rules and 49 `!important` declarations** — dense, not the "~400 lines" the audit stated. The work is smaller than the audit implied but the mechanism and the risk are exactly as described.
- The audit's suggested key envelope `v1.<keyid>.<iv>.<tag>.<ct>` reuses the version already in the wild for a **4-part** payload. Phase 2 uses **`v2`** for the keyed format and keeps `v1` readable, otherwise every stored token becomes undecryptable.

**Literal-colour density per component** — the slicing order for Phase 1, measured by counting `text-white/`, `bg-white/`, `bg-[#`, `text-[#` occurrences:

| File | Literals | | File | Literals |
|---|---|---|---|---|
| `AdminPanel.tsx` | 116 | | `AdminControls.tsx` | 35 |
| `RepoPanel.tsx` | 81 | | `ReceiptUpload.tsx` | 26 |
| `Sidebar.tsx` | 45 | | `SettingsPanel.tsx` | 23 |
| `AccountSection.tsx` | 38 | | `AdminReceipts.tsx` | 21 |
| `ChangeReview.tsx` | 37 | | `AuthDiagnostics.tsx` | 19 |

---

## 3. Invariants — do not "fix" these

Every phase below touches something adjacent to the following. None of these may be refactored, generalised or "simplified" on the way past. They are the parts of the product that are already correct.

1. **One charge function with no price parameter.** `start_hour_session()` takes no amount. Never add one back "for flexibility".
2. **`hour_sessions.owner` is the primary key.** This is what makes two concurrent sessions structurally impossible. Do not replace it with a surrogate id plus a unique index.
3. **Change-set signature covers `baseSha` + content hash and excludes `status`.** Lifecycle transitions must never invalidate an artefact.
4. **The GitHub read client is GET-only by construction**, and one write module is the only path to a commit.
5. **Service role stays confined** to `lib/supabaseAdmin.ts` and the `agent/runs*` routes.
6. **CI runs build-with-no-secrets and apply-migrations-twice.** Keep both.
7. **RLS is the authority**, not a route guard. Phase 3 adds defence in depth; it never moves the decision out of Postgres.
8. **The agent never claims a build ran.** No phase may introduce text that implies verification the product does not perform.

---

## 4. Phase map

```
P0 baseline ──┬── P1 accessibility ──┬── P4 runtime ──┐
              │                      │               │
              ├── P2 money/identity ─┴── P3 edge ────┼── P6 execution (gated)
              │                      │               │
              └──────────────────────┴── P5 structure┘
```

| Phase | Name | Findings | PRs | Depends on | Exit gate |
|---|---|---|---|---|---|
| **P0** | Baseline and truth | F-04 | 2 | — | Documented budgets equal exported constants, asserted in CI |
| **P1** | Accessibility gates | F-01, F-02, F-03, F-11 | 7 | P0 | Every text pair ≥4.5:1; every accent fill ≥4.5:1; override block deleted |
| **P2** | Money, identity, determinism | F-05, F-07, F-08, F-10 | 5 | P0 | Replayed turn rejected; keys rotatable; limiter survives restart; two-device order stable |
| **P3** | Edge and abuse surface | F-06, F-09, F-13, F-14, F-15 | 5 | P2 | Signed-out `/chat` handled; share reads capped; no memory sync; CSP nonce |
| **P4** | Runtime confidence | F-12 | 2 | P1 | Stream/stop/approve/commit-refusal covered in CI |
| **P5** | Structural debt | — | 5 | P1, P2 | Largest files decomposed, tests unchanged |
| **P6** | Execution | — | 4+ | P4, §13 D6 | Review card can truthfully say "tests passed" |

**Why this order.** P0 first because a plan verified against a lying README is not verifiable. P1 before everything visible because it is the only phase whose defect is *measurable* rather than argued, and it is small. P2 before P3 because the limiter and the key ring are prerequisites for bounding anything new. P4 after P1 because the theme work stabilises the selectors a browser test needs. P5 last among the shippable phases because decomposing `app/chat/page.tsx` before the theme migration would collide with it in every slice.

---

## 5. Phase 0 — Baseline and truth

**Outcome:** a repository where the documented limits are the enforced limits, and a recorded baseline that later phases are measured against.
**Finding:** F-04. **Contract:** no product behaviour changes in this phase.

### P0-T1 — Establish the local baseline

| | |
|---|---|
| **Change** | Run the exact CI command set on a clean clone of `08a049d` and record the output as the reference. No source edits. |
| **Files** | none |
| **Acceptance** | All five commands exit `0`; the test summary line and the contrast table are committed under `docs/baseline-08a049d.md`. |
| **Verify** | the block below |

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run check:migrations
NEXT_PUBLIC_SITE_URL=https://ci.invalid bun run build
```

`--frozen-lockfile` is not optional: a drifted `bun.lock` is a hard CI failure, and the fix is to revert the drift, never to regenerate the lockfile into the PR.

### P0-T2 — Make the limits documentary

| | |
|---|---|
| **Change** | Replace the stale claims with the constants, and add a test that fails when they diverge again. |
| **Files** | `README.md:71–72`; `docs/OVERHAUL_SPEC.md:36`, `:62`, `:89`, `:205`, `:362`, `:378`, `:425`; new `tests/limits-docs.test.ts` |
| **Acceptance** | `README` states **40 steps / 200,000 tokens / 30-minute turn** and **3 Dew per hour, no per-message charge**; `OVERHAUL_SPEC` §5 and §9 agree; the new test asserts every documented number equals its exported constant and fails if either is edited alone. |
| **Verify** | `bunx tsx tests/limits-docs.test.ts` and `bun run test` |

The four specific lies to remove: "up to eight steps and 60k tokens per turn, one flat Code charge per turn" (`README:71–72`), "`MAX_STEPS` (8) and `MAX_TURN_TOKENS` (60k)" (`OVERHAUL_SPEC:89`), "flat per request, per model" (`:36`, `:378`), and the "twelve steps can be 60k tokens" price argument (`:425`). The `Corrected 2026-10-28` note at `:62` already fixes the *price*; it left the *budget* wrong beside it, which is why the section reads as current while being half-stale.

Do not link the test to a single constant file. Read `MAX_STEPS` and `MAX_TURN_TOKENS` from `lib/agent/turns.ts` and `DEW_PER_HOUR` from `lib/dew.ts`, then assert the README text contains those exact values — the same source-contract style the repo already uses, which is why it will actually hold.

**Phase gate:** `bun run test` green including the new suite; `docs/baseline-08a049d.md` present.

---

## 6. Phase 1 — Accessibility gates

**Outcome:** every theme is readable, and the override block that makes theming fragile is gone.
**Findings:** F-01, F-02, F-03, F-11. **Ship order matters:** T1 and T2 are one-session fixes with immediate user-visible benefit, so they land first and independently of the long migration.

### P1-T1 — Fix accent fill legibility (F-01)

| | |
|---|---|
| **Change** | Set `--on-accent` to the near-black ink in `:root` and `html.ink`, matching what Paper already does. |
| **Files** | `app/globals.css:27` (`#ffffff` → `#15130f`), `app/globals.css:140` (same) |
| **Acceptance** | White-on-accent disappears from dark and ink. Computed: `#15130f` on sage `#6ec294` ≈ **8.66:1**; on lavender `#a09ad8` ≈ **7.16:1** (both above 4.5). Paper unchanged at 5.37. |
| **Verify** | the contrast script from P1-T3, plus a visual pass over `.on-accent` (`:396`) and its light override (`:400`) |

Why the constant and not "darken the accent": the accent is also used as *text* on the canvas at 8.80:1 (dark) and 6.73:1 (ink). Darkening it fixes the fill and breaks the text. Changing the ink is the only move that satisfies both, and it is the move Paper already made.

Three surfaces to check after the flip, because they use accent fills rather than the class: the send control, the Dew chip's active state, and the user bubble (`--bubble-user`, which is *not* `--accent` and already measures 6.33:1 dark / 8.75:1 ink — leave it alone).

### P1-T2 — Lift `--text-low` to AA (F-02)

| | |
|---|---|
| **Change** | Raise the hint token until it clears 4.5:1 on its own canvas in all three themes. |
| **Files** | `app/globals.css:20` (dark), `:81` (Paper), `:133` (ink) |
| **Acceptance** | ≥4.5:1 in all three; no other token changes; hierarchy preserved (`--text-mid` stays visibly stronger). |
| **Verify** | contrast script; grep the four call sites at `:497`, `:598`, `:710`, `:779` |

Candidates that clear the floor (computed with the same formula, to be asserted rather than trusted):

| Theme | Now | Ratio | Candidate | Ratio |
|---|---|---|---|---|
| dark | `#5d7167` | 3.61 | `#6f8478` | **4.71** |
| Paper | `#8a8172` | 3.40 | `#756b5d` | **4.62** |
| ink | `#837e96` | 4.47 | `#8a85a0` | **4.93** |

The ink theme misses by 0.03 — it is the one that looks fine and is not. Do not skip it because the diff is a single hex.

### P1-T3 — Enforce contrast in CI

| | |
|---|---|
| **Change** | Parse the three palettes out of `globals.css`, compute WCAG ratios, fail below threshold. Land it in report mode in the same PR as T2, then flip to enforcing. |
| **Files** | new `scripts/check-contrast.mjs`; `package.json` (`check:contrast`); `.github/workflows/ci.yml` (step in `verify`) |
| **Acceptance** | Script exits `1` when `--on-accent` is reverted to `#ffffff`; exits `0` on the fixed tree; prints the full table so a reviewer sees the numbers, not just a pass. |
| **Verify** | `node scripts/check-contrast.mjs` then `git stash` the token, re-run, confirm non-zero |

Pairs and thresholds to encode: `--text-hi`/`--text`/`--text-mid`/`--text-low` on `--bg` **≥4.5**; `--on-accent` on `--accent` **≥4.5**; `--accent` on `--bg` **≥3.0** (UI/large only, which is how Paper's orange legitimately sits at 3.05); bubble text on `--bubble-user` **≥4.5**.

Parse by block, not by file: `:root`, `html.light`, `html.ink`. A regex over the whole file would pick the wrong `--on-accent`, since all three define it.

### P1-T4 — Ratchet the literal colours (F-03, part 1)

| | |
|---|---|
| **Change** | Add a test that counts forbidden literal utilities per file and fails when any count rises. |
| **Files** | new `tests/theme-literals.test.ts` |
| **Acceptance** | Counts match [§2](#2-verified-baseline); adding `bg-[#111a16]` to any component fails the suite; lowering a count passes and the baseline must then be updated downward in the same PR. |
| **Verify** | `bunx tsx tests/theme-literals.test.ts` |

Forbidden patterns: `text-white/`, `bg-white/`, `border-white/`, `bg-[#`, `text-[#`, `border-[#`, `text-black/`. Ratchet table seeded from §2 with the remaining components added at their measured counts. This is the phase's load-bearing safety net — without it, every subsequent slice quietly re-adds a literal and the migration never converges.

### P1-T5 → P1-T8 — Migrate literals in slices, deleting overrides as you go

One PR per surface, highest count first, so the riskiest files are done while attention is highest and later slices get easier.

| Task | Surface | Literals | Files |
|---|---|---|---|
| **P1-T5** | Admin | 116 + 35 + 21 + 16 | `AdminPanel`, `AdminControls`, `AdminReceipts`, `AdminGate` |
| **P1-T6** | Repository | 81 + 37 | `RepoPanel`, `ChangeReview` |
| **P1-T7** | Shell and account | 45 + 38 + 23 | `Sidebar`, `AccountSection`, `SettingsPanel` |
| **P1-T8** | Money and auth | 26 + 19 + 14 | `ReceiptUpload`, `AuthDiagnostics`, `SearchOverlay` |

Each slice: replace literal utilities with the semantic aliases already defined in `tailwind.config.ts` (`bg-canvas`, `bg-raised`, `bg-card`, `bg-chip`, `bg-hover`, `border-line`, `text-hi`, `text-body`, `text-mid`, `text-low`, `accent`), delete the corresponding selector rules from `app/globals.css:167–411`, lower the ratchet, and confirm the theme still renders by toggling all three palettes.

**Two rules for every slice.** (1) Delete the override rule in the *same* PR that removes its last consumer — deleting ahead of the migration breaks a surface nobody is looking at. (2) Never add a new literal to compensate; if a colour has no token, add the token to all three palettes first, which is the point of the exercise.

The prefix-matching bug stays until the text rules are deleted, so **do not** "fix" `[class*=" text-white/1"]` by adding more prefixes. Removal is the fix. The file itself records what prefix matching already cost once: `[class*="bg-white/"]` matched `hover:bg-white/[0.06]`, so every control wore its hover background permanently.

### P1-T9 — Decide what Ink is (F-11)

| | |
|---|---|
| **Change** | Either document Ink as layout-locked, or decouple it into a selectable appearance. |
| **Files** | `lib/settings.ts` (`applyDocumentTheme`), `README.md`, `components/SettingsPanel.tsx` |
| **Acceptance** | README no longer implies three independent themes; if decoupled, `appearance` and `homeLayout` are independent and the Focus layout no longer forces `ink`. |
| **Verify** | `bunx tsx tests/focus-home.test.ts`; manual toggle matrix |

Recommendation: **document it** (Option A). It is a true statement about the design, it costs one paragraph, and decoupling opens a fourth palette combination that nobody has designed. Take Option B only on an explicit product decision — this is D2 in [§13](#13-open-decisions).

**Phase gate:** contrast script enforcing and green; override block deleted (verified by `grep -c "!important" app/globals.css` falling from 49 to the handful in primitives); ratchet at or near zero; `bun run test` green.

---

## 7. Phase 2 — Money, identity and determinism

**Outcome:** the agent's budget cannot be reset by replay, secrets can be rotated one class at a time, and message order is decided by the server.
**Findings:** F-05, F-07, F-08, F-10. **Contract:** every change here is additive to the schema; nothing drops a column.

### P2-T1 — Server-authoritative agent steps (F-05)

| | |
|---|---|
| **Change** | Mirror the signed turn's counters into a row updated conditionally, so a replayed token cannot rewind the budget. |
| **Files** | new migration `supabase/migrations/2026…_agent_turn_steps.sql`; `lib/agent/turns.ts` (`readTurn`, `advanceTurn`); `app/api/agent/step/route.ts` |
| **Acceptance** | Sending an older valid token after `advanceTurn` returns `409` and does not decrement `steps`; a fresh turn starts at zero; the signed blob remains the transport. |
| **Verify** | new `tests/agent-turn-steps.test.ts` plus `bun run check:migrations` |

Shape: `agent_turns(turn_id text pk, owner uuid, steps int, tokens int, exp timestamptz, updated_at)`. `advanceTurn` becomes an RPC that updates `where turn_id = $1 and owner = auth.uid() and steps = $2` — a compare-and-set, so the second of two racing steps loses instead of both winning.

**Do not** replace the HMAC token. It carries `exp`, the model binding and the prompt hash that the step route needs before it can query anything. The row is authority over *counters only*.

The honest alternative is to close this as accepted risk: the exposure is bounded by a prepaid hour, so a replayed turn buys more reads, not more hours. If that is the decision, say so in `docs/AGENT_TOOLS_AND_RESUME.md` and skip the task — but do not leave the comment at `lib/agent/turns.ts:8` as the only place the trade-off is written down.

### P2-T2 — Per-purpose keys with a key id (F-07)

| | |
|---|---|
| **Change** | Split the seal so GitHub tokens and user provider keys no longer share one key, and add a key id to the envelope for rotation. |
| **Files** | `lib/github/crypto.ts:32`, `:46`, `:52`, `:57–64`, `:77–80`; `.env.example`; `lib/providerKeys.ts` call sites |
| **Acceptance** | Existing `v1.<iv>.<tag>.<ct>` payloads still decrypt; new payloads are `v2.<keyid>.<iv>.<tag>.<ct>`; rotating the provider key does not break GitHub tokens and vice versa; the last-four display is unchanged. |
| **Verify** | new `tests/crypto-rotation.test.ts` covering seal→open across a key change and a legacy `v1` fixture |

The format is **`v2`**, not the audit's `v1.<keyid>…`: `v1` is already deployed as a four-part payload, so reusing it would make stored ciphertexts ambiguous. Openers dispatch on the prefix: `v1` = four parts, legacy key; `v2` = five parts, key id selects from a ring.

Lazy re-seal on read is what makes this shippable without a migration script: a token read under `v1` is rewritten as `v2` the next time it is used. Accept that tokens nobody uses stay on the old key — that is the residual risk, not a bug.

New env var: `PROVIDER_KEY_KEY`, falling back to `GITHUB_TOKEN_KEY` when unset so existing deployments boot. `AGENT_TURN_SECRET`'s borrow at `:46` is a *signing* key, not a seal — leave the fallback, it is a separate concern and changing it invalidates live turns.

### P2-T3 — A limiter that survives a cold start (F-08)

| | |
|---|---|
| **Change** | Give the rate limiter a Postgres fallback so serverless instances stop counting in isolation. |
| **Files** | `lib/serverControl.ts:340–347`, `lib/rateLimit.ts`; new RPC in a migration; `lib/rateLimitPolicy.ts` untouched (the policy is correct); `lib/setupChecks.ts:72` already reports presence, so no setup-screen work |
| **Acceptance** | Two instances observe one shared counter; with `UPSTASH_*` set, Upstash is used; without it, the RPC is used; a burst across instances returns `429` at the documented threshold. |
| **Verify** | `bunx tsx tests/rate-limit.test.ts` extended with a fallback case; PGlite replay |

Shape: `rate_limit_hit(bucket text, window_start timestamptz, max int) returns boolean` — one atomic upsert, no read-then-write. The bucket key must include the caller id where the policy does, not only the IP.

Do **not** make a missing limiter a boot failure. The product's stated posture is "nothing is required to boot"; a hard failure contradicts it and turns a degraded protection into an outage. Add the fallback and keep the `.env.example` sentence truthful.

### P2-T4 — Server-assigned message order (F-10)

| | |
|---|---|
| **Change** | Add a per-chat sequence to `chat_messages`, assign it server-side, and order reads by it. |
| **Files** | new migration; `app/api/chat/route.ts` insert path; read path in `lib/cloudHistory.ts`; `lib/db.ts:404` stays for local display |
| **Acceptance** | Two devices inserting in the same millisecond yield a total order that both then read identically; existing rows backfill deterministically by `created_at, id`; local optimistic ordering is unchanged before sync. |
| **Verify** | `tests/chat-sync.test.ts` extended with a same-millisecond two-device case; `bun run check:migrations` |

Backfill in the migration, not in application code — a chat with 400 messages must not renumber on every read. Order reads by `(seq, created_at)` so a NULL from an in-flight insert never sorts above a real row.

Keep `nextMessageTime()`. It is the optimistic local order and it is correct for its job; it simply stops being the authority after sync.

### P2-T5 — Regression pass

| | |
|---|---|
| **Change** | None. Prove the four changes compose. |
| **Acceptance** | Full suite green, migrations apply twice, build with no secrets succeeds, and the money paths still charge exactly 3 Dew per hour in `tests/dew.test.ts` and `tests/refund.test.ts`. |
| **Verify** | the P0-T1 command block |

**Phase gate:** replay rejected (or documented as accepted); rotation test green; limiter shared; ordering stable under tie.

---

## 8. Phase 3 — Edge and abuse surface

**Outcome:** the public edge is bounded, the dead memory path is gone, and the CSP stops needing `unsafe-inline`.
**Findings:** F-06, F-09, F-13, F-14, F-15.

### P3-T1 — Resolve the `/chat` gate question (F-06)

| | |
|---|---|
| **Change** | Either add an edge redirect, or record why it cannot exist yet. |
| **Files** | `app/chat/page.tsx`, `app/chat/layout.tsx`, possibly new `middleware.ts` |
| **Acceptance** | A signed-out visitor to `/chat` either redirects before paint, or the audit finding is closed as "not implementable without cookie sessions" with that reason written down. |
| **Verify** | manual: clear storage, request `/chat`, observe |

**This one is not the simple fix it looks like.** The session lives in the browser (bearer token, `AuthScreen` gate), not in a cookie. Middleware cannot read it, so a `middleware.ts` that redirects on "no session cookie" would redirect **every** signed-in user too. Making F-06 real means moving the session to an httpOnly cookie — a genuine auth change that touches every handler's `verifyCaller`, not a matcher.

Recommendation: **defer and document.** The data is already protected by RLS and per-route bearer checks; the exposure is a shell paint and a search-engine-noindexed page. Spending a session-migration on it is worse than spending that session on P2. This is D4.

### P3-T2 — Cap public share reads (F-09)

| | |
|---|---|
| **Change** | Put the public snapshot read behind a bounded route instead of letting the page read the table directly. |
| **Files** | `app/api/share/[id]/route.ts` (currently `DELETE` only), `app/share/[id]/page.tsx`, `lib/share.ts` |
| **Acceptance** | `GET` returns a snapshot with `cache-control: no-store`; the token is matched exactly, never prefix-scanned; more than N reads per IP per minute returns `429` with `Retry-After`; revoking makes the next read `404`. |
| **Verify** | `tests/share.test.ts` extended; manual revoke-then-read |

The table read under RLS stays as the storage mechanism — the route is the throttle and the shape, not a second source of truth. 30-day expiry and revocation already work; do not touch them.

### P3-T3 — Delete the memory residue (F-13)

| | |
|---|---|
| **Change** | Remove the sync functions and drop the table, or restore the feature. Pick one. |
| **Files** | `lib/cloudHistory.ts:800`, `:821`, `:840`; `lib/types.ts:218` (`Memory`); new migration `drop table public.memories`; `docs/OVERHAUL_SPEC.md` §3 |
| **Acceptance** | No `Memory` type, no sync call, no table; `bun run typecheck` clean. The local Dexie store was **already** dropped in v5, so no schema bump is needed — confirm that still holds instead of assuming it. |
| **Verify** | `grep -rn "memor" lib app components tests` returns only the changelog entry; migrations apply twice |

Recommendation: **delete** (Option A). The feature was removed deliberately; the residue is dead code that still writes rows. But it is a data-destroying migration, so it needs an explicit owner decision — D5.

If restored instead, the work is larger than the deletion: the panel, the suggestions, the Dexie store, the RLS policy and the spec section all need to come back, and none of them are in this plan.

### P3-T4 — CSP without `unsafe-inline` (F-14)

| | |
|---|---|
| **Change** | Issue a per-request nonce and drop `'unsafe-inline'` from `script-src`; move the artifact preview off `srcdoc`. |
| **Files** | `next.config.mjs:82`; the middleware from P3-T1 if it exists, otherwise a route-level header |
| **Acceptance** | `script-src 'self' 'nonce-…' 'strict-dynamic'`; the app hydrates; the artifact preview renders from a sandboxed frame that is not same-origin; no console CSP violations on `/chat`, `/`, `/about`. |
| **Verify** | build, load each route, read the console; a test asserting `next.config.mjs` contains no `'unsafe-inline'` in `script-src` |

Depends on P3-T1: a nonce needs something to mint it per request, and that is middleware. If P3-T1 is deferred, this task is deferred with it — the two are one decision, not two.

`style-src 'unsafe-inline'` stays. Next injects inline style attributes and removing it breaks layout; the audit only flagged the script directive, and that is the one with an exploit path.

### P3-T5 — Notice when the whitelist rejects a label (F-15)

| | |
|---|---|
| **Change** | Count rejections instead of silently rewriting to "Openmi". |
| **Files** | `lib/models.ts:146–150` |
| **Acceptance** | A rejected label still renders "Openmi"; a counter records the input; the counter is inert when no DSN is configured. |
| **Verify** | `tests/navigation.test.ts` or a new case asserting fallback + counter call |

Small and worth doing precisely because it is small: the failure mode it guards against is a future model shipping and every user seeing "Openmi" with no signal that anything went wrong.

**Phase gate:** share reads bounded; memory path gone; CSP nonce live or explicitly deferred with P3-T1.

---

## 9. Phase 4 — Runtime confidence

**Outcome:** the paths that only exist at runtime are covered by something that runs them.
**Finding:** F-12.

### P4-T1 — Browser harness on the paths static tests cannot reach

| | |
|---|---|
| **Change** | Add Playwright and a small, deliberately unambitious suite. |
| **Files** | `package.json` (dev dep), `playwright.config.ts`, `tests/e2e/*.spec.ts`, `.github/workflows/ci.yml` (new `e2e` job) |
| **Acceptance** | Four specs pass: signed-out gate, send→stream→stop, approve flow up to the commit refusal, theme contrast on the three palettes. |
| **Verify** | `bunx playwright test` locally against `bun run dev` |

**Scope discipline.** Four specs, not forty. The existing 32 suites already pin source contracts well; a browser layer's only job is the gap — streaming, the composer, and the approval gate. Anything that a regex test can assert belongs in a regex test, because it is a hundred times cheaper to run.

The highest-value single spec is **commit refusal**: sign in, open a change set, attempt a commit to a non-`agent/*` branch, assert `403 "Openmi only commits to agent/ branches."`. That is the product's central safety claim and today nothing executes it.

**Honest limitation to record in the spec file:** the authenticated specs need a test account and a seeded repository. If CI has no such secret, run only the unauthenticated specs and mark the rest `test.skip` with a comment naming what is missing — do not fake a session, and do not report a skipped spec as coverage.

### P4-T2 — Wire it, or don't

| | |
|---|---|
| **Change** | Add the CI job if credentials exist; otherwise document the manual run. |
| **Acceptance** | Either `e2e` runs on PRs, or `README` documents `bunx playwright test` as a pre-release manual step. |
| **Verify** | CI run, or the README section |

**Phase gate:** the four specs exist and pass wherever they can run; the limitation is stated in the repository, not only in a chat.

---

## 10. Phase 5 — Structural debt

**Outcome:** the files that make every change expensive get smaller, without a behaviour change.
**Findings:** none — this is risk reduction, not a defect. **Contract:** zero functional diff; the 32 suites are the safety net and must stay untouched.

Ordered after P1 because the theme migration touches the same components; running them concurrently guarantees conflicts in `AdminPanel` and `RepoPanel`.

| Task | Target | Now | Split |
|---|---|---|---|
| **P5-T1** | `app/chat/page.tsx` | 2,321 | hooks by concern: session/pricing, repo workspace, streaming, search, appearance |
| **P5-T2** | `tests/repo-agent.test.ts` | 2,121 | split by concern: signature, hash/expiry, branch policy, double submit |
| **P5-T3** | `components/AdminPanel.tsx` | 1,375 | per view: console, codes, receipts |
| **P5-T4** | `components/RepoPanel.tsx` | 1,353 | connection, picker, tree/file viewer |
| **P5-T5** | `lib/cloudHistory.ts` + `lib/cloudAdmin.ts` | 925 + 1,074 | per domain, matching the table groups |

**Rules.** Move code, do not rewrite it. One extraction per PR, ≤300 lines moved, no new props and no renamed exports. If an extraction needs a behaviour change to work, the boundary is wrong — stop and pick a different seam.

`app/chat/page.tsx` is the one worth doing first and the one most likely to go wrong: it holds ~25 `useState` and ~20 effects. Extract the *effects and their state together* into `useHourSession`, `useRepoWorkspace`, `useThreadStream`, `useSearch`, `useAppearance` — extracting state without its effect leaves the coupling behind and produces a hook that is harder to follow than the original page.

**Phase gate:** no file above 900 lines except `globals.css`; suite count unchanged; no test edits.

---

## 11. Phase 6 — Execution (gated)

**Outcome:** the review card can truthfully say "tests passed" — and says nothing when it cannot.
**Status:** **not ready to build.** Four decisions are missing and inventing answers here would produce a sandbox that costs money in ways nobody priced.

This is the product's stated third phase (`docs/ROADMAP.md`) and the audit's Phase 5. It is last for a reason: it is the only phase that changes what the product *claims*, and the honesty contract in §3.8 is the thing most likely to be broken by it.

| Task | Work | Blocked on |
|---|---|---|
| **P6-T1** | Design doc: what runs, where, for how long, at what cost, with which secrets absent | D6.1–D6.4 |
| **P6-T2** | Provider selection and a cost model in Dew/hour terms | D6.2 |
| **P6-T3** | Wire results into the review card, including the failure text | P6-T1 |
| **P6-T4** | Contract tests: a "tests passed" claim is impossible without a real run, and a failed run cannot render as success | P6-T3 |

The one rule that cannot be relaxed: **every state the card can show must be reachable from a real observation.** If the sandbox times out, the card says timed out. If it cannot start, the card says it could not start. There is no optimistic default, because the entire product proposition is that the review is honest about what it verified.

---

## 12. Coverage matrix

| Finding | Sev | Task | Phase |
|---|---|---|---|
| F-01 accent ink 2.14 / 2.59 | P1 | P1-T1 | 1 |
| F-02 `--text-low` 3.61 / 3.40 / 4.47 | P1 | P1-T2 | 1 |
| F-03 `!important` override block | P1 | P1-T4 → T8 | 1 |
| F-04 README/spec drift | P1 | P0-T2 | 0 |
| F-05 client-held step budget | P2 | P2-T1 | 2 |
| F-06 no `/chat` middleware | P2 | P3-T1 (likely defer) | 3 |
| F-07 one key, two secret classes | P2 | P2-T2 | 2 |
| F-08 per-instance limiter | P2 | P2-T3 | 2 |
| F-09 uncapped share reads | P2 | P3-T2 | 3 |
| F-10 client-clock ordering | P2 | P2-T4 | 2 |
| F-11 Ink is not selectable | P2 | P1-T9 | 1 |
| F-12 no browser layer | P2 | P4-T1, T2 | 4 |
| F-13 memory residue | P3 | P3-T3 | 3 |
| F-14 CSP `unsafe-inline` | P3 | P3-T4 | 3 |
| F-15 silent label fallback | P3 | P3-T5 | 3 |

All 15 are assigned. Nothing in the register is left as "future work".

---

## 13. Open decisions

These need an owner answer before the named task starts. Each is a real fork, not a formality.

| ID | Decision | Blocks | Recommendation |
|---|---|---|---|
| **D1** | Delete the override block entirely, or keep a residual block for surfaces that cannot be tokenised? | P1-T9 | Delete. Anything that cannot be tokenised should not be styled. |
| **D2** | Is Ink a theme or a layout? | P1-T9 | Document as layout-locked. |
| **D3** | Postgres limiter vs requiring Upstash in production | P2-T3 | Postgres. No new vendor, and the app must boot unconfigured. |
| **D4** | Move sessions to cookies for a real `/chat` gate? | P3-T1, P3-T4 | Defer. Cost is a session migration across every handler; benefit is a shell paint. |
| **D5** | Delete the memory table, or restore the feature? | P3-T3 | Delete. It is a destructive migration, so it needs an explicit yes. |
| **D6.1** | What may the sandbox execute? | P6-T1 | Must be enumerated, not "the project's tests". |
| **D6.2** | How is sandbox time priced in Dew? | P6-T2 | Per minute, prepaid, refused before start — never metered after the fact. |
| **D6.3** | Which secrets are absent from the sandbox? | P6-T1 | All of them. No provider keys, no service role, no GitHub token. |
| **D6.4** | What happens when the sandbox cannot start? | P6-T3 | The card says so, and the commit gate stays closed on a claim. |

---

## 14. Per-PR gates

Every phase PR runs the same five commands, and all five must be green before review:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run check:migrations
NEXT_PUBLIC_SITE_URL=https://ci.invalid bun run build
```

Plus, once Phase 1 lands:

```bash
node scripts/check-contrast.mjs
bunx tsx tests/theme-literals.test.ts
```

**Reviewer checklist.**

- [ ] No invariant in [§3](#3-invariants--do-not-fix-these) was touched.
- [ ] Any new limit is a named constant with a test that reads it, not a literal in a handler.
- [ ] Any new table has RLS enabled, a policy keyed on `auth.uid()`, and `revoke all from anon, authenticated` where it moves money or identity.
- [ ] Any new migration applies twice cleanly (the CI job enforces it, but read the diff).
- [ ] No new literal colour outside the ratchet.
- [ ] No claim of verification the product does not perform — in code, comments, docs or UI copy.
- [ ] The PR names the finding it closes, and the audit is updated with the sha.

**Rollback.** Phases 0, 1, 3 and 5 are revertible by a single `git revert` because nothing in them is a migration. Phases 2 and 3 add migrations; those are additive and re-runnable, so a revert leaves the objects in place and unused — acceptable, and the reason none of them drops a column the running app still selects.

---

*Plan derived from `OPENMI_ARCHITECTURE_AUDIT.md` at `test` @ `08a049d`. Line anchors verified against that tree; re-grep before editing. Contrast candidates are computed with the WCAG relative-luminance formula over the shipped tokens and must be asserted by the script, not trusted from this table.*
