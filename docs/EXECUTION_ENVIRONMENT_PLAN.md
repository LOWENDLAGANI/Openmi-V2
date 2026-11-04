# Execution environment — design plan (Phase 10)

**Status: implemented — the verification half.** This document is P10-T1: it
answers the four blocking decisions (D6.1–D6.4) and prices the work. The code
that follows those answers is `lib/execution/*`, `supabase/migrations/016_execution.sql`,
`app/api/execution/runs/*` and `components/ExecutionPanel.tsx`.

What ships is seed → apply → install → build, with the exit code recorded and
rendered. What is deliberately *not* in this build:

- the agent does not get a shell of its own; it proposes a changeset in chat,
  and the run verifies that changeset (P10-T3 below is still open);
- charging is implemented through the existing ledger
  (`017_execution_dew.sql`): reserve 0.5 Dew before the sandbox, settle at 0.05
  Dew per started minute, refund the unused part;
- tests are not run, so no card can say they were.

The old gate test (`tests/execution-gate.test.ts`) is gone, replaced by
`tests/execution.test.ts`, which holds the same honesty rule the gate existed
for: a success sentence is unreachable without a recorded exit code of 0.

**Provider: Daytona.** Chosen for sub-second sandbox creation from a snapshot,
per-second billing, a first-class TypeScript SDK, and sandbox-level egress
control. Figures below were read on 2026-11-03 from:

- https://www.daytona.io/pricing
- https://www.daytona.io/docs/en/limits/
- https://www.daytona.io/docs/en/network-limits/
- https://www.daytona.io/docs/en/snapshots/
- https://www.daytona.io/docs/en/typescript-sdk/daytona/
- https://www.daytona.io/docs/en/typescript-sdk/sandbox/

---

## 1. The flow, stated plainly

```
user asks for a change
        │
        ▼
agent proposes work (existing turn, bounded by MAX_STEPS)
        │
        ▼
 user starts a run ──► Openmi reserves Dew, creates a Daytona sandbox
                            │
                            ├── seed workspace at the pinned commit
                            ├── agent edits files through tools (no shell strings)
                            ├── install + build from an enumerated allowlist
                            ├── record exit codes, durations, log tail
                            └── produce a diff, destroy the sandbox
        │
        ▼
 diff becomes a signed changeset (unchanged review UI, unchanged signature)
        │
        ▼
 user approves ──► existing branch + pull request path (never the default branch)
```

The run **never** pushes. Approval still does, through
`lib/changesets/commit.ts` → `lib/github/write.ts`, exactly as it does today.
"Push back to GitHub" means "open a branch and a PR after review", which is the
one claim this product can defend.

---

## 2. Decisions

### D6.1 — What may the sandbox execute?

**Enumerated commands. The model never supplies a shell string.**

The runner owns the command. The model may only name a step.

| Step | Command (fixed by the runner) | Detected from |
|---|---|---|
| `install` | `npm ci` / `bun install --frozen-lockfile` / `pnpm install --frozen-lockfile` / `yarn install --immutable` / `pip install -r requirements.txt` / `go mod download` / `cargo fetch` | one lockfile, in that order |
| `build` | `npm run build` / `bun run build` / `pnpm run build` / `yarn build` / `cargo build` / `go build ./...` | `package.json` script, `Cargo.toml`, `go.mod` |
| `typecheck` | `npm run typecheck` / `tsc --noEmit` / `bun run typecheck` | `package.json` script, `tsconfig.json` |

Four further rules, all enforced in code rather than in a prompt:

1. Unknown repo shape → `refused: no_build_command`. Never "try something".
2. `npm run build` runs the repo's own script. That is arbitrary code, and it is
   the reason the sandbox holds no secrets (§4) — not a reason to allow a shell.
3. Each step gets `EXEC_STEP_TIMEOUT_MS = 180_000` and a 64 KiB output tail.
   Output over the cap keeps the **last** 64 KiB; the truncation is visible.
4. The agent gets `run_step(step)` with an enum. There is no `command`, `args`,
   `cwd`, `env` or `url` parameter on any execution tool, and a test asserts the
   tool schema has no string parameter that reaches a shell.

### D6.2 — How is sandbox time priced in Dew?

**0.05 Dew per started minute, prepaid against the cap, settled on real time.**

Measured cost basis (`daytona-medium`: 2 vCPU, 4 GiB, 8 GiB disk):

```
vCPU     2 × $0.0504/h            = $0.1008/h
memory   4 × $0.0162/h            = $0.0648/h
storage  (8 − 5 free) × $0.000108 = $0.000324/h
                                    ─────────────
                                    $0.165924/h  =  $0.00277/min
```

At the plan floor of **RM 0.75 per Dew** (Starter: RM15 / 20 Dew):

| | Cost to Openmi | Charged | Margin |
|---|---|---|---|
| 1 minute | RM 0.0126 | 0.05 Dew = RM 0.0375 | ~3× |
| 10-minute run | RM 0.126 | 0.5 Dew = RM 0.375 | ~3× |
| 1 hour | RM 0.754 | 3 Dew = RM 2.25 | ~3× |

The symmetry is deliberate and easy to say out loud: **an execution hour costs
the same as a chat hour.** Model tokens for the run are already covered by the
active hour (D4), so this price is for compute, not for tokens.

Mechanics, mirroring the existing billing rules (implemented in
`supabase/migrations/017_execution_dew.sql` as two service-role functions):

- `EXEC_DEW_PER_MINUTE = 0.05`, `EXEC_MIN_CHARGE_DEW = 0.05` (one minute),
  `EXEC_MAX_MINUTES = 10`, `EXEC_RESERVE_DEW = 0.5`.
- Reserve `EXEC_RESERVE_DEW` **before** `daytona.create`. A balance below the
  reserve returns `402` and creates nothing.
- Settle on the run's recorded wall time, rounded up to a started minute, capped
  at the reserve. Unused Dew is refunded through the existing refund path with
  `kind='refund'`, not by editing a ledger row.
- Daytona bills per second; we bill per started minute. The difference is the
  margin, and it is also what pays for a failed install that took 40 seconds.
- Revisit after the P10-T0 spike with measured token + compute cost per run. If
  the median run exceeds 4 minutes, the reserve moves, not the rate.

### D6.3 — Which secrets are absent from the sandbox?

**All of them.** Not "all of them except…".

| Secret | In the sandbox? | Why |
|---|---|---|
| `GITHUB_TOKEN_KEY`, user GitHub PAT | No | The sandbox never talks to the user's repo. Tree arrives as a tarball from Openmi. |
| `SUPABASE_SERVICE_ROLE_KEY`, any Supabase key | No | Results come back through `sandbox.fs`/`exec` responses, written by the server. |
| `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `DEEPSEEK_API_KEY` | No | The agent loop runs on the server (as today). The sandbox has no model client. |
| `DAYTONA_API_KEY` | No | Only the server calls Daytona. |
| `GITHUB_TOKEN_KEY`-derived signing keys | No | Signatures are computed server-side after the run. |
| Anything in `.env` of the target repo | No | The repo's own `.env*` files are excluded from the seeded workspace. |

The one credential-shaped thing that exists is a **source archive** of the repo,
which the user already has access to. There is no push credential because the
sandbox never pushes (§4).

If private-repo transfer ever becomes the bottleneck, the replacement is a
GitHub App installation token scoped to one repository, one hour, minted per
run — not a user PAT, and not a value the sandbox is trusted to keep. That is a
later decision (D6.5 below), not v1.

### D6.4 — What happens when the sandbox cannot start?

**A specific reason, stored, rendered, and refunded. Never a generic error and
never an optimistic default.**

| `failure_code` | When | Card text |
|---|---|---|
| `not_configured` | `DAYTONA_API_KEY` absent or `EXECUTION_ENABLED` off | "Execution is not configured on this deployment." |
| `quota` | Daytona `429`, or the org vCPU pool is exhausted | "The sandbox quota is exhausted right now. Nothing ran and nothing was charged." |
| `repo_too_large` | Archive over `EXEC_MAX_TARBALL_BYTES` (80 MB) | "This repository is too large to seed (83 MB, limit 80 MB)." |
| `clone_failed` | Tarball fetch or extraction failed | "The repository could not be seeded: <status>." |
| `install_failed` | install exit ≠ 0 | "Install failed (exit 1) after 47s. Last 20 lines: …" |
| `build_failed` | build exit ≠ 0 | "Build failed (exit 2) after 12s. Last 20 lines: …" |
| `no_build_command` | No recognised build step | "This repository has no build command Openmi recognises." |
| `timed_out` | Run exceeded `EXEC_MAX_MINUTES` | "Stopped at the 10-minute limit. The sandbox was destroyed; the diff up to that point is kept." |
| `cancelled` | User cancelled | "You cancelled this run after 2m 14s." |
| `crashed` | Server died mid-run (`heartbeat_at` stale) | "The run stopped reporting. No build result was recorded." |

Refunds: `not_configured`, `quota`, `repo_too_large` and `cancelled` before the
sandbox is created cost nothing and refund the full reserve. Anything after
creation is charged for its real duration, because it really ran.

---

## 3. Sandbox lifecycle

One run = one sandbox. No reuse, no cross-user state.

```ts
const sandbox = await daytona.create({
  snapshot: EXECUTION_SNAPSHOT,        // default: "openmi-exec" (§3.1)
  ephemeral: true,                     // delete on stop — belt
  autoDeleteInterval: 0,
  ttlMinutes: EXEC_MAX_MINUTES + 5,    // braces: survives our process dying
  autoStopInterval: EXEC_MAX_MINUTES + 2,
  labels: { run: runId, owner: ownerId.slice(0, 8) },
  networkBlockAll: false,
  domainAllowList: ALLOWED_EGRESS.join(","), // §5
  public: false,
});
```

`ttlMinutes` and `autoStopInterval` are the reason a crashed Openmi process
cannot bill a user forever: the sandbox removes itself even if we never call
`delete()`. The server still deletes explicitly in a `finally`.

### 3.1 The snapshot

Built once, versioned, referenced by name:

```
debian:12  +  git, curl, ripgrep, build-essential, python3, node 22, bun,
              npm, pnpm, yarn, go, cargo  (+ nothing else)
```

Built from a Dockerfile via `daytona.snapshot.create`, so the contents are
reviewable in this repo under `execution/Dockerfile`. Warm pools are optional
later; `daytona-medium` cold start is already sub-second, so v1 does not pay for
one.

### 3.2 Seeding the workspace

The sandbox never clones and never authenticates:

1. Server fetches `GET /repos/{owner}/{repo}/tarball/{sha}` with the user's
   sealed token (existing `lib/github/read.ts` credential path, server-side
   only), enforcing `EXEC_MAX_TARBALL_BYTES`.
2. Server uploads the archive with `sandbox.fs.uploadFile`, extracts it into
   `~/workspace`, strips `.env*`, `node_modules`, `.next`, `dist`, `build`,
   `vendor`, `target`.
3. Server runs `git init && git add -A && git commit -m base` **inside** the
   sandbox. That repository exists only to give us `git status --porcelain` and
   `.gitignore`-aware diffs. It has no remote and no credentials.

This is the trick that makes D6.3 say "all of them" without giving up git's diff
semantics.

---

## 4. Getting changes back out

At the end of the run, the server asks the sandbox for:

```
git status --porcelain=v1 -z        → changed + untracked, ignored files absent
git diff --no-color --binary HEAD   → text patch for tracked files
```

The server converts that into `ProposedFile[]`:

- `MAX_RUN_FILES = 40`, `MAX_RUN_BYTES = 400_000` total. Over the cap →
  `refused: patch_too_large`, with the count stated.
- Binary or oversized single file → that file is recorded with an `error` row
  (the review UI already renders per-file errors).
- Untracked-but-not-ignored files are new files; deletions are represented as
  empty-content markers and rendered as deletions.

Then, unchanged from today: `changesets` + `changeset_files` rows, content hash,
HMAC signature, review card, approval, branch, PR. Approval is still the only
write to GitHub and the only path that can open a PR.

**Why not let the sandbox push?** Because pushing needs a credential, and a
credential is the thing a `postinstall` script is best at stealing. The
server-side commit path already exists, is already tested, already enforces
`openmi/agent/*`, and already stamps the author (**Openmi**, per
`agent-push-requirements.md`). Moving the push into the sandbox would weaken
three guarantees to save one round trip.

---

## 5. Egress

`domainAllowList` on the sandbox, deny-by-default:

```
registry.npmjs.org, registry.yarnpkg.com, codeload.github.com,
objects.githubusercontent.com, github.com, api.github.com,
pypi.org, files.pythonhosted.org, proxy.golang.org, sum.golang.org,
static.crates.io, index.crates.io, deb.debian.org, security.debian.org
```

Notes from the Daytona docs that shape this:

- **Tier 1 and Tier 2 organizations cannot override network policy per sandbox**;
  the org-level restriction wins and only "essential services" are reachable.
  Tier 3 (a $500 top-up) is required for custom allow lists. Until then,
  execution runs on whatever the org policy allows and the card says so.
- On Tier 3+, an allow list is strict: essential services are **not**
  auto-added. Missing `registry.npmjs.org` is a broken install, not a bug.
- `networkBlockAll` is the kill switch for a "verify only, no install" mode.

If the install needs a host that is not on the list, the failure is
`install_failed` with the blocked host in the tail — a real observation, not a
guess.

---

## 6. Data model — `supabase/migrations/016_execution.sql`

```sql
create table public.execution_runs (
  id             uuid primary key default gen_random_uuid(),
  owner          uuid not null references auth.users(id) on delete cascade,
  chat_id        uuid not null references public.chats(id) on delete cascade,
  changeset_id   uuid references public.changesets(id) on delete set null,
  repo_full_name text not null,
  base_sha       text not null,
  status         text not null default 'queued'
                 check (status in ('queued','running','done','failed','timed_out','cancelled')),
  stage          text check (stage in ('provision','seed','code','install','build','collect','commit')),
  failure_code   text,
  failure_detail text,
  sandbox_id     text,
  install_command text,
  build_command  text,
  exit_code      integer,
  duration_ms    integer,
  reserved_dew   numeric(10,3) not null,
  charged_dew    numeric(10,3) not null default 0,
  started_at     timestamptz not null default now(),
  heartbeat_at   timestamptz,
  ended_at       timestamptz
);

create unique index execution_runs_one_active_per_owner
  on public.execution_runs (owner) where status in ('queued','running');

create table public.execution_events (
  id      bigserial primary key,
  run_id  uuid not null references public.execution_runs(id) on delete cascade,
  owner   uuid not null references auth.users(id) on delete cascade,
  seq     integer not null,
  at      timestamptz not null default now(),
  kind    text not null check (kind in ('status','step','output','observation')),
  body    text not null,
  unique (run_id, seq)
);
```

RLS on both, owner-select only, no client insert (writes go through the service
role in the run route). `body` is bounded in the writer: 4 KiB per event, 200
events per run, `MAX_LOG_BYTES = 64_000` per run, tail-kept.

Repository size, cost, and failure distribution are the numbers P10-T2 needs, so
`duration_ms`, `exit_code` and `failure_code` are columns, not log lines.

---

## 7. Routes

| Route | Method | Behaviour |
|---|---|---|
| `/api/execution/runs` | `POST` | Auth, chat + pin ownership, Dew reserve, insert `queued`, start run, `202 { runId }`. `402` below reserve, `409` if an active run exists, `503` if not configured. |
| `/api/execution/runs/[id]` | `GET` | SSE of `execution_events` after `seq`, then close on terminal status. `no-store`. |
| `/api/execution/runs/[id]` | `DELETE` | Cancel: set `cancelled`, delete the sandbox, settle. Idempotent. |
| `/api/execution/runs/[id]/changeset` | `POST` | Turn the collected patch into a signed changeset (server-only, idempotent by run id). |

The run executes **inside the POST handler** with `maxDuration = 300`, streaming
into Postgres as it goes, so a closed browser loses nothing. If a build outlives
the function ceiling, the run ends `timed_out` and the sandbox self-destructs.
A queue-driven worker is the v2 answer; it is not needed to ship this.

## 8. Tools the agent gains

Added to `lib/agent/tools.ts`, active only during a run:

| Tool | Parameters | Notes |
|---|---|---|
| `list_files` | `prefix?` | Existing cap (200) reimplemented over the sandbox. |
| `read_file` | `path` | Existing 200 KB cap, existing path sanitiser. |
| `search_code` | `query` | `rg --fixed-strings`, 10 candidates / 20 hits. |
| `apply_edit` | `path`, `mode`, `content`/`find`+`replace` | Writes to the workspace. Reuses `validateEdits`. |
| `run_step` | `step: "install" \| "build" \| "typecheck"` | Enum. Returns exit code + tail. |

`propose_edits` stays for chats with no sandbox. A run replaces it rather than
competing with it: the changeset is built from the workspace, not from the model's
claim about the workspace.

---

## 9. Honesty contract (the part that must not slip)

Every claim on the card is a rendering of a stored row:

| Card says | Only when |
|---|---|
| "Build passed" | `build_command` is non-null, `exit_code = 0`, `ended_at` set, and the process was observed to exit |
| "Tests passed" | The same, for a **typed** `test` step. Not promised in v1; v1 ships install + build + typecheck only |
| "Build failed" | `exit_code ≠ 0`, with the recorded tail |
| "Timed out" | `status = 'timed_out'` |
| "Could not start" | `not_configured` / `quota` / `repo_too_large`, and `ended_at` set |
| "Not verified" | No run row at all |

`tests/execution.test.ts` holds this rule now, and asserts:

1. `describeRun` returns a success sentence only for a row whose `exit_code` is
   `0`; a failed or codeless run can never render as one.
2. Every `failure_code` maps to its own sentence — install, quota, timeout and
   "stopped reporting" are distinguishable.
3. Command detection resolves a lockfile to a fixed string, and an unrecognised
   repository is refused with a reason instead of guessed at.
4. The egress list contains no wildcard, and the Dew charge rounds up to a
   started minute and never exceeds the reserve.

What it does not assert, and cannot without a key: that a sandbox starts. That
is the one claim this build makes only after `DAYTONA_API_KEY` is set and a run
has actually produced a row.

---

## 10. Work breakdown

| Task | Work | Acceptance |
|---|---|---|
| **P10-T0** | Spike, no product code: sandbox from snapshot, tarball seed, install + build three real repos (Next.js/Bun, Python, Go), measure cold start, install, build, patch out, cost | **Not run**: no Daytona key in this environment. Offline timings only (§2) |
| **P10-T1** | `execution/Dockerfile` + snapshot build + `lib/execution/provider.ts` (only module importing the SDK) + env spec + `/setup` probe | Missing key reads "execution not configured"; one snapshot hash recorded; no other file imports the SDK |
| **P10-T2** | `016_execution.sql`, run orchestrator, POST/GET/DELETE routes, event writer with caps | An interrupted run resumes its stream after reload; every `failure_code` reachable in a test |
| **P10-T3** | Sandbox tools + prompt clause change + step enum + no-shell test | A model-supplied string never reaches a shell; a path traversal is refused before any exec |
| **P10-T4** | Patch → changeset, observations on the review card, replace the gate test | Card never claims a build it did not observe; timed-out renders as timed out |
| **P10-T5** | Dew reserve/settle/refund, concurrency guard, cancel, teardown, kill switch | Concurrent start impossible; a failed start refunds in full; a killed server leaves no running sandbox after TTL |
| **P10-T6** | Limits page copy, README, `/about` change (it currently says "no execution"), runbook | `/about` and the card agree with behaviour, verified by a test that greps for the old claim |

P10-T4 and P10-T6 are the two that touch existing copy. `/about` line 30 and
`lib/prompt.ts`'s `NO_EXECUTION_CLAUSE` both become conditional ("in a chat with
no run") rather than deleted — a chat without a sandbox still cannot claim a
build.

---

## 11. Risks, ranked

1. **Install time.** A cold `npm ci` on a monorepo can take 4 minutes. Mitigation:
   `EXEC_MAX_MINUTES`, a clear `timed_out` state, and a later repo-scoped
   dependency cache snapshot. Not a v1 blocker, but it bounds usefulness.
2. **Network tier.** Custom egress needs Tier 3. On Tier 1 the install may hit
   hosts the org policy blocks. Known, stated on the card, not hidden.
3. **Prompt injection through repo content.** Real, and the reason D6.1 forbids
   model-authored commands. A malicious `postinstall` still runs — with no
   secrets, an allowlisted network, and a 10-minute life.
4. **Cost runaway.** Bounded four ways: per-run cap, one active run per owner,
   global concurrency cap (`EXEC_MAX_CONCURRENT = 2` on Tier 1's 10 vCPU), and
   Daytona's own TTL.
5. **Diff transport.** 40 files / 400 KB is enough for an agent-sized change and
   too small for a generated lockfile churn. `package-lock.json` diffs will be
   refused with a stated reason rather than silently truncated.

## 12. Open questions for the owner

- **D6.5** — Do private-repo users get the tarball path (slower, no credential)
  or a per-run installation token (faster, credential in the sandbox)?
  Recommendation: tarball in v1.
- **D6.6** — Does a run count against the same hour as chat, or does it need its
  own active session? Recommendation: same hour (unchanged D4), with execution
  minutes charged separately from that hour's flat price.
- **D6.7** — Is `test` a step at all in v1? Recommendation: no. `install`,
  `build` and `typecheck` are enough to catch "it does not compile", and a
  test-runner allowlist is a second product.
