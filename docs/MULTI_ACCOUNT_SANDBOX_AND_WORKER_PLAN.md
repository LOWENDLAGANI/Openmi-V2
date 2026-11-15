# Multiple E2B accounts and multiple run workers

**Status:** plan — nothing implemented yet.
**Scope:** chat workspaces, verification runs, missions, previews, checkpoints, the
sandbox sweep, the run worker fleet, and the automatic switching between them.

## 0. In plain words

Openmi today has **one** E2B membership and **one** worker machine. When the
membership reaches its free limit, or that machine stops answering, work stops
until a person fixes it.

After this change you can add several memberships and several worker machines,
and Openmi moves work between them on its own:

- Every chat keeps a note of **which membership its workspace lives in**. Every
  job keeps a note of **which machine ran it**. Those notes are the memory — they
  survive restarts, so the app always knows where to look.
- When a workspace has to be built and the chosen membership says "limit
  reached", Openmi tries the next one, builds there, and writes that down. The
  next message in that chat goes to the new one.
- A membership that is full or whose key stops working is set aside for a while,
  so the app does not keep knocking on a door that will not open. You can see
  which one is set aside and why.
- A workspace that is **already running is never moved** just because its
  membership is at the limit. Moving it would throw away everything installed in
  it. The limit only steers where a *new* workspace is built.
- What can be lost when a workspace is replaced: files that existed only inside
  that workspace and were never pushed to GitHub. The project is downloaded again
  at the exact version the chat is pinned to, and anything Openmi proposed lives
  in a pull request, so it survives.
- At most **two tries** per setup, so a project that cannot be downloaded cannot
  bounce from membership to membership forever.
- The person sees one short line when this happens: the workspace was replaced
  and the project was downloaded again. No error, no action needed.
- Same idea for the machines that run jobs. If the machine handling a job goes
  quiet, Openmi puts that job back in line and another machine picks it up — once.
  The new machine reads the same saved conversation and reuses the same workspace
  when it is still there.
- If a job is waiting, Openmi wakes the machine with the most room. If nothing
  happens for a while it wakes the next one. If every machine is asleep, the job
  waits and the reader is told, as today.
- A job that is retried **does not charge again**, and the stop button still works
  after a switch.
- You can see which membership is full or set aside, and which machine handled
  which job, on the admin page.
- What you have to do: put the extra membership keys in the settings, one per
  line, and start the extra worker machine from your other Render account.

## 1. The problem, stated precisely

Today one credential is read from `process.env.E2B_API_KEY` on every provider
call (`lib/execution/provider.ts` → `clientOptions()`), and one worker health URL
is pinged when a run is queued (`lib/runs/wake.ts`).

Three facts make "just add a second key" wrong:

1. **E2B sandbox ids are scoped to the team that created them.** Connecting to a
   box with another account's key answers 404. With two keys in the environment
   and no record of who created which box, every attach, pause and kill becomes
   a coin flip — and `destroySandboxConfirmed` treats a 404 as `missing`, so a
   wrong key would look like success and leak the container.
2. **Nothing records which credential owns a box.** `chat_sandboxes` and
   `runs` store `sandbox_id` and `provider`, but not the account. That column is
   the whole change: it is what makes a box attachable a week later, a sweep
   safe, and a key rotation survivable.
3. **Nothing retries on purpose.** A worker that dies marks its run failed; a
   full E2B account fails the turn. There is no second attempt, so one free
   instance or one free membership is a single point of failure.

Same shape for workers: `runs.worker_id` records an instance, but there is no
record of *which* worker deployment (Render account / free instance) claimed a
run, and the wake ping goes to one hardcoded host.

So the requirement is one invariant, plus one rule:

> **Every sandbox id is stored next to the credential that can open it, and every
> run is stored next to the worker that claimed it.**
>
> **A failure that another account or machine could survive is retried exactly
> once, and the place the retry succeeded is remembered.**

## 2. Target architecture

```
web app / worker
  │
  ├─ lib/execution/accounts.ts ── resolve, select, set aside
  │        │
  │        └─ provider(accountId)  ── E2B account A / B / C
  │
  ├─ chat_sandboxes.sandbox_account   ← which key created this box
  ├─ runs.sandbox_account             ← which key created this box (web-agent runs)
  ├─ execution_runs.sandbox_account   ← same, for verification runs and missions
  ├─ sandbox_accounts                 ← fleet memory: cooling / disabled / last error
  ├─ runs.worker_pool                 ← which worker deployment ran it
  └─ run_workers                      ← fleet memory: who is alive, how busy
```

Chat workspaces are created by the **web app**, so their account is chosen there.
Run sandboxes are created by **workers**, so their account is chosen there. The
pools are independent: one worker may create run boxes on any E2B account.

## 3. Part A — the E2B account pool

### 3.1 Configuration

Keep the existing single key working (a deployment with one key must behave
exactly as it does today), and add a list:

```bash
# today, still valid — becomes account id "default"
E2B_API_KEY=e2b_...

# new — labelled accounts, one per line or comma-separated
E2B_ACCOUNTS="acct-1:e2b_aaa,acct-2:e2b_bbb,acct-3:e2b_ccc"

# optional knobs
E2B_ACCOUNT_MAX_SANDBOXES=4          # per-account ceiling; unset means uncapped
E2B_ACCOUNT_COOLDOWN_MINUTES=15      # how long a full account is set aside
E2B_FAILOVER=on                      # "off" restores fail-loudly behaviour
```

- Account ids are **labels, not secrets**: `acct-1`, `billing-b`, anything stable,
  matched against `^[a-z0-9][a-z0-9_-]{0,31}$`. They are written to the database
  and may appear in the admin panel, so they must not contain a key fragment.
- `E2B_API_KEY`, when present, is appended as account `default` and remains the
  fallback if `E2B_ACCOUNTS` is malformed. A malformed list must **not** silently
  disable execution: log once, fall back to the single key.
- Duplicate ids keep the first entry and log; an entry with no colon is ignored.
- Secrets are never logged, never returned to the browser, never stored in the DB.
  Extend the redaction pattern in `lib/runs/redact.ts` to `E2B_ACCOUNTS`.

### 3.2 Resolver (`lib/execution/accounts.ts`, new)

Pure where possible so it is testable without the SDK:

| function | purpose |
| --- | --- |
| `sandboxAccounts(env)` | parse into `{ id, key }[]`, legacy key → `default` |
| `accountById(id, env)` | the credentials for a recorded id, or `null` |
| `accountsConfigured(env)` | replaces the key test inside `executionConfigured()` |
| `pickAccount({ accounts, load, caps, blocked, owner })` | pure selection |
| `accountLoad()` | counted from the DB, 30 s cache per process |
| `setAsideAccount(id, reason, until)` | writes `sandbox_accounts` |

**Selection rule:** drop accounts at or over the cap, set aside, or missing from
the configured list; among the rest choose the lowest live-sandbox count,
tie-broken by `hash(owner) % n` so a given chat keeps landing on the same account
and the spread is stable. Load is read from a small view over `chat_sandboxes` +
`runs` + `execution_runs` rather than from provider billing APIs: one query, no
extra credentials, and it counts what *we* created.

**Unknown account:** `accountById` returning null maps to
`SandboxStartError("missing")`. That is deliberate — a key that was rotated out
means the box is unreachable to us, and the caller's existing `missing` path
(recreate a chat workspace / destroy a run box best-effort) is the correct
outcome. It must never be reported as `refused`, or a chat retries forever.

### 3.3 Schema (migration `048_sandbox_accounts.sql`)

```sql
alter table public.chat_sandboxes
  add column if not exists sandbox_account text not null default 'default';
alter table public.runs
  add column if not exists sandbox_account text;
-- Verification runs and missions are the same table, split by `kind`.
alter table public.execution_runs
  add column if not exists sandbox_account text;

create index if not exists chat_sandboxes_account_idx
  on public.chat_sandboxes (sandbox_account, state);
create index if not exists runs_account_idx
  on public.runs (sandbox_account)
  where sandbox_id is not null;
create index if not exists execution_runs_account_idx
  on public.execution_runs (sandbox_account)
  where sandbox_id is not null;

-- The fleet's memory of which accounts are usable right now. Keyed by the label
-- in E2B_ACCOUNTS, not by any key material.
create table if not exists public.sandbox_accounts (
  id               text primary key,
  state            text not null default 'active'
                     check (state in ('active','cooling','disabled')),
  set_aside_until  timestamptz,
  last_failure     text,
  last_failure_at  timestamptz,
  failures         integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.sandbox_accounts enable row level security;
revoke all on public.sandbox_accounts from anon, authenticated;

insert into public.openmi_meta (key, value)          -- schema marker, as 000_base does
values ('sandbox_accounts', '1')
on conflict (key) do update set value = excluded.value;
```

- `default` for existing rows is correct **only while `E2B_API_KEY` is still
  present**. The rollout keeps it for one `CHAT_SANDBOX_TTL_HOURS` window (48 h)
  and the plan says so in the operator steps (§6).
- `sandbox_accounts` is service-role only. It is the durable version of the
  "do not knock on that door again" memory, so a full account is skipped by every
  server process, not just the one that saw the failure.
- The migration is written to be re-runnable; `scripts/check-migrations.mjs`
  applies the whole set twice and must stay green.

### 3.4 Provider surface (`lib/execution/provider.ts`)

Every function that touches an existing box takes the account:

```ts
attachSandbox(sandboxId, accountId)
destroySandboxConfirmed(sandboxId, accountId)
createSandbox(runId, { accountId, ... })    // returns handle carrying accountId
createRunSandbox(runId, accountId)
createChatSandbox({ ..., accountId })
listChatSandboxes(accountId)                // per account
listRunSandboxes(accountId)                 // per account
listChatSandboxesEveryAccount()             // loops accounts, isolates failures
listRunSandboxesEveryAccount()
```

- `SandboxHandle` gains `accountId: string` (in-memory only; the handle is never
  serialized). Callers persist it in the same write that stores `sandbox_id`.
- `handleFor(...)` takes the account so nothing has to thread it through every
  method call.
- `clientOptions()` becomes `clientOptionsFor(accountId)`; there is no ambient
  key any more, which is what prevents a caller from accidentally using the
  wrong one.
- `executionConfigured()` asks `accountsConfigured()`; the kill switch is
  unchanged.

### 3.5 Call sites

| file | change |
| --- | --- |
| `lib/execution/chat-env/open.ts` | pick an account before `createChatSandbox`; insert the row with `sandbox_account`; on a per-account refusal, retry once on the next-best account (§3.7); `resume()` attaches with `row.sandboxAccount` |
| `lib/execution/chat-env/destroy.ts` | `attachSandbox`/`destroySandboxConfirmed` with `row.sandboxAccount` |
| `lib/execution/chat-env/store.ts` | select + insert the column (`ChatSandboxRow.sandboxAccount`) |
| `lib/execution/chat-env/seed.ts` | unchanged (works through the handle) |
| `lib/files/session.ts`, `lib/execution/sync/session.ts`, `lib/execution/checkpoints/session.ts`, `lib/execution/preview/session.ts` | attach through the chat row's account. These four already read a `ChatSandboxRow` and attach from it, so they inherit the account with a signature change and need no column of their own — `chat_previews` and `sandbox_checkpoints` keep pointing at the chat's live box, which is the existing contract when a workspace is recreated |
| `lib/execution/run.ts`, `lib/execution/store.ts` | verification run: choose an account, record `sandbox_id` **and** `sandbox_account` in one update (`execution_runs`) |
| `lib/runs/loop.ts` | same record on resume; destroy with the recorded account (`runs`) |
| `lib/agent/sandbox.ts`, `lib/sandbox/rebase.ts` | ephemeral boxes: choose + use the handle's account, no row |
| `lib/execution/mission/loop.ts`, `lib/execution/mission/store.ts`, `app/api/missions/[id]/route.ts` | persist and use `sandbox_account` on the mission's `execution_runs` row; teardown takes the account |
| `app/api/cron/sandbox-sweep/route.ts` | destroy per row with its account; reconcile by looping accounts |
| `lib/runs/worker.ts` (`sweepRunSandboxes`) | iterate accounts; destroy each box with the account that listed it |
| `lib/setup/probes.ts` | report per-account presence/count, never the key |
| `lib/env.ts`, `.env.example`, `README.md`, `docs/E2B_SANDBOX_READINESS.md`, `render.yaml` | document `E2B_ACCOUNTS`, the caps, `E2B_FAILOVER`; pass all keys to the worker |

### 3.6 Failure semantics (this is where a pool usually goes wrong)

- **Attach fails `missing` for a row that names an account** → do **not** probe
  other accounts. Recreate a chat workspace; clear a run's `sandbox_id`.
- **Attach fails for a row with no account (legacy `null`)** → sweep the
  configured accounts once to find the box, then write the account it was found
  under. This is the only case where cross-account probing is allowed, and it is
  bounded by the number of accounts.
- **A box is listed under account A but its row names account B** → trust the
  row, log the mismatch, and let the row-driven path destroy it with B. The
  label-based reconciliation only destroys boxes with **no** row, and only after
  checking that row's id under the same account's listing.
- **Deleting a key** is a supported operation with one rule: drain first. Remove
  it from `E2B_ACCOUNTS` only after its boxes are gone (`sandbox_account` count
  is zero), or accept that those boxes are unreachable and will be orphaned until
  E2B's own retention collects them.

### 3.7 Automatic switching between accounts

This is the behaviour that makes a pool worth having. It is deliberately narrow:
switch only when the alternative is failure, try twice, and remember the result.

#### Triggers

| what happened | what the app does | what it remembers |
| --- | --- | --- |
| A new workspace is needed, and the chosen account refuses with a quota / rate-limit / 429 answer | set that account aside as `cooling` until `now + E2B_ACCOUNT_COOLDOWN_MINUTES`, choose the next-best, build there | the chat row now names the new account; the account row says when it may be used again |
| The account's key is rejected (401/403) or the id is no longer configured | set it aside as `disabled` (no automatic return), choose the next | the chat row names the new account; the admin panel shows the disabled account until an operator clears it |
| The chat's recorded workspace cannot be opened at all (`missing`, expired, provider 404) | recreate on the best healthy account and rewrite the row — **this is the ordinary daily path**, not a failure | the chat row names the new account |
| The account is at its cap, but this chat's workspace is alive | **do nothing.** The cap steers new workspaces only; a live workspace is never thrown away to balance a number | nothing changes |
| The account fails at seeding (the project cannot be downloaded) | try the next account once; if it fails the same way, stop and report | the failure stays on the chat row's `failure_code`; no third attempt |
| Every account is full or set aside | report the existing capacity message and leave the chat usable in GitHub-only mode; do not queue silently | the earliest `set_aside_until` is quoted in the message ("about N minutes") |
| The failure happens **mid-turn**, after the box was already in use | do not replay the turn: it ends with the existing message and the hour is released as today. The *next* message builds a workspace on a healthy account | the chat row is rewritten on that next open |

#### Rules that keep it safe

- **Two attempts per creation, maximum.** Not one per account in the list: a
  fleet of five memberships must not turn a broken project into five downloads.
- **Never switch mid-turn.** Tool calls have already happened; replaying half a
  turn is worse than ending it honestly. Switching is a *before work starts*
  decision, or a *workspace is gone* decision.
- **Never move a live workspace for balance.** Only a box that cannot be opened
  is replaced.
- **Set-aside is fleet-wide, not per process.** It lives in `sandbox_accounts`,
  so the serverless instances that handled one failure do not each rediscover it.
  A cooling account returns by itself at `set_aside_until`; a disabled one needs
  an operator.
- **`E2B_FAILOVER=off` restores today's behaviour** — one attempt, fail loudly —
  for an operator who would rather see the error than a switch.

#### What the reader sees

One line on the chat, once, and no error state:

> “This chat's workspace was replaced on another machine. The project was
> downloaded again at the commit this chat is pinned to.”

It is a `notice` on the existing open result (the same field that already says
"Waking this chat's workspace…"), so no new UI surface. If the second attempt
also fails, the reader gets the ordinary failure message with the real reason.

#### What is remembered, and where

| memory | lives in | survives a restart | used by |
| --- | --- | --- | --- |
| which account this chat's workspace is in | `chat_sandboxes.sandbox_account` | yes | every attach for that chat |
| which account a job's workspace is in | `runs.sandbox_account`, `execution_runs.sandbox_account` | yes | the worker, the sweep, teardown |
| which accounts are full / broken | `sandbox_accounts` | yes | account selection, the admin panel |
| that a switch just happened | the chat's `failure_code`/notice and the run's events | yes | diagnosis, the reader's note |

## 4. Part B — the render worker fleet

The worker is already queue-safe (`for update skip locked`), so adding capacity is
mostly bookkeeping, a smarter wake, and one retry rule.

### 4.1 Schema (same migration or `049_run_worker_pool.sql`)

```sql
create table if not exists public.run_workers (
  id            text primary key,           -- "render-a", "render-b", ...
  label         text,
  health_url    text,
  concurrency   integer not null default 1,
  state         text not null default 'active'
                  check (state in ('active','draining','disabled')),
  active_runs   integer not null default 0,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.runs
  add column if not exists worker_pool text,
  add column if not exists retry_count integer not null default 0,
  add column if not exists last_wake_at timestamptz,
  add column if not exists wake_attempts integer not null default 0;
```

- Service-role only; no RLS policies and no grants to `authenticated`, matching
  `chat_sandboxes`.
- `runs.worker_pool` is written by `claim_next_run`, so it is set atomically with
  `worker_id` instead of a second update.
- `retry_count` is what makes "retry exactly once" enforceable across processes.
- `last_wake_at` / `wake_attempts` are what stop the cron pass from pinging a
  sleeping machine every minute forever.

### 4.2 Worker identity and registration

- `RUN_WORKER_ID` (new env, e.g. `render-a`) defaults to today's
  `hostname-pid-uuid`; `RUN_WORKER_LABEL` and `RUN_WORKER_HEALTH_URL` are optional
  cosmetics/diagnostics.
- On start: upsert its `run_workers` row and log the pool id.
- Heartbeat every 30 s while running: `last_seen_at`, `active_runs`. Written with
  the service role, best effort — a database blip must not stop the queue.
- On `SIGTERM`: set `state = 'draining'` so the wake picker stops sending work
  there, then finish in-flight runs as today.
- On start: if `last_seen_at` was older than 5 minutes, the row is stale; a new
  process with the same id simply overwrites it.

### 4.3 Claim

`claim_next_run(p_worker, p_pool, p_pool_filter)` — records both columns. The
filter is optional so one deployment can run a dedicated pool (e.g. a
high-memory instance for large repos) without splitting the queue into tables.

### 4.4 Wake, with escalation

`lib/runs/wake.ts` keeps its role and its kill switch, and gains selection and a
second chance:

1. On queue, read `run_workers` where `state = 'active'` and `last_seen_at` is
   fresh. Drop members at `active_runs >= concurrency`.
2. Wake the one with the most free slots (tie-break: least recently woken, then
   id). **If the best candidate has not been seen for more than two minutes**
   — likely asleep or gone — wake the next one as well. Two requests, not a
   broadcast.
3. If nobody is eligible, wake every configured member once, bounded and
   fire-and-forget as today.
4. A queued run older than 45 seconds gets one escalation: wake the next
   candidate, at most once every two minutes per run, recorded in
   `wake_attempts` / `last_wake_at`. It fires from the existing
   `GET /api/cron/run-sweep` pass when a scheduler is pointed at it (as
   `docs/WEB_AGENT_RUNS.md` already describes), and otherwise from the run's own
   status read that the open tab already polls — throttled by the same two
   timestamps, so the escalation works with no extra infrastructure.
5. `RUN_WORKERS` / `RUN_WORKER_URL` remain as a static fallback when the table is
   empty (a fresh deployment with no worker has registered yet), so the first
   cold start still wakes.

`/healthz` reports `pool` and counters; nothing about runs.

### 4.5 Render setup (one account at a time)

`render.yaml` stays a single-service blueprint. Each additional Render account
deploys the same blueprint with:

- `RUN_WORKER_ID` = that account's member id,
- the same `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`,
- **all** `E2B_ACCOUNTS` (a worker must be able to open any run box),
- the same artifacts bucket credentials (`RUN_ARTIFACTS_*`) — a shared bucket is
  what lets any worker read another worker's artifacts after a failover.

Free instances sleep after 15 minutes; the wake picker prefers a member that is
known to be awake, and the escalation in §4.4 is what covers the case where the
first choice was asleep or suspended.

### 4.6 Observability

- Admin panel: a **Workers** block listing each member, state, last seen, active
  runs, and the count of runs currently owned per pool member; and a **Sandbox
  accounts** block listing each label, live count, cap, state, and the time it
  was set aside (never the key).
- `/api/admin/status` gains `workers` and `sandboxAccounts` alongside `sandboxes`,
  so "which membership is full" is visible without a dashboard login.

### 4.7 Automatic switching when a worker goes wrong

| what happened | what the app does | what the reader sees |
| --- | --- | --- |
| The worker claimed a run and then stopped reporting (heartbeat older than `RUN_HEARTBEAT_STALE_MS`) | if `retry_count = 0`: put the run back in the queue (`status='queued'`, `retry_count=1`, clear `worker_pool`, keep `sandbox_account` and `sandbox_id`), append a `run.warning`. If `retry_count = 1`: settle it as failed, as today | “The machine running this stopped responding. Trying again on another machine.” then, if it fails again, the ordinary error |
| The worker is asleep when a run is queued | the wake picker prefers a recently-seen member; the escalation covers a sleeping first choice | “Waiting for a machine to pick this up…” (already exists) |
| A worker account is suspended or you stop it | its `run_workers` row goes stale, or an operator sets `state='disabled'`; it stops being chosen | nothing, until the queue waits long enough to say so |
| Every worker is down | the run stays queued; the existing 20-minute rule settles it with the existing message | the existing “no machine picked this up” message |
| The run's own workspace is gone when the retry starts | the retry re-attaches by `sandbox_id` when it exists, otherwise creates a new box on a healthy E2B account and records it | the existing “workspace was replaced” note |

Rules:

- **One retry per run, ever.** `retry_count` is the guard, and it is persisted, so
  two servers cannot both decide to retry.
- **Retrying does not charge again.** The hourly charge is on the chat's hour
  session (`dew_session_id`) and is settled once; `record_run_usage` runs at the
  end, once. A retried run reuses the same session and the same budget counters.
- **Cancel wins over retry.** A run with `cancel_requested = true` is never
  requeued; the retry path checks it first.
- **The transcript is the handover.** A retried run reads its prompt, its chat
  history and its sandbox account from the database, so the second worker does
  not need anything from the first one.
- **Draining is not failure.** A worker shutting down finishes its runs; only a
  lost heartbeat triggers the requeue.

## 5. Test plan

New:

- `tests/sandbox-accounts.test.ts` — parsing (legacy, list, malformed, duplicate
  id, whitespace), `accountById`, selection (cap, set-aside, load, stable
  tie-break), `executionConfigured` with zero/one/many keys.
- `tests/sandbox-failover.test.ts` — quota refusal switches once and the row
  records the new account; a second refusal stops; a live box is not moved when
  its account is at cap; a missing key maps to `missing` and recreates; a cooling
  account is skipped until `set_aside_until`; `E2B_FAILOVER=off` attempts once.
- `tests/chat-env-accounts.test.ts` — a provisioned row carries the account; a
  resume attaches with the row's account; the notice is produced exactly once.
- `tests/worker-pool.test.ts` — wake selection order, stale/disabled/at-capacity
  members skipped, asleep-first-choice double ping, empty-table fallback;
  `claim_next_run` stores pool + instance.
- `tests/run-retry.test.ts` — a lost-heartbeat run is requeued exactly once, a
  cancelled run is not, the second loss settles it, `retry_count` survives, no
  extra charge is recorded.

Updated (they assert on source text or column lists): `chat-env-resolver`,
`chat-env-provider`, `chat-env-sweep`, `mission-default`, `runtime`,
`sandbox-activation`, `checkpoints`, `preview`, `files`, `apply-dialog`.

Migration check: `bun run check:migrations` (applies the set twice).

## 6. Rollout order

1. **Migration first** — `048` adds columns, `sandbox_accounts` and `run_workers`;
   nothing reads them yet, so it is safe on a live deploy.
2. **Provider + resolver, single key, failover off** — behaviour identical with
   one key; legacy `E2B_API_KEY` resolves to `default` so old rows keep working.
3. **Record and use the account** at every create/attach/destroy listed in §3.5.
   Verify on one account: create a chat, reload it, trash it, run a sweep.
4. **Turn failover on** with a second key added and `E2B_FAILOVER=on`. Test the
   switch by exhausting the first account's cap on purpose.
5. **Wait one TTL window (48 h)** so no `default`-owned box can still be live.
6. **Remove `E2B_API_KEY`** only when
   `select count(*) from chat_sandboxes where sandbox_account = 'default'`
   is zero.
7. **Worker fleet** — deploy the second blueprint, watch `run_workers` fill, then
   confirm a queued run wakes the least-loaded member, and that killing a worker
   mid-run produces exactly one retry on the other.
8. **Retire** nothing else: the single-key and single-worker paths stay supported
   for small deployments, which is why step 2 is a compatibility layer and not a
   migration.

## 7. Risks and mitigations

| risk | mitigation |
| --- | --- |
| Wrong-key attach looks like a deleted box and leaks a container | the account is stored with the id; cross-account probing only for `null` accounts |
| A switch loop that rebuilds a workspace on every message | two attempts per creation; set-aside is fleet-wide; a seed failure fails the same way everywhere and stops |
| A rotated key strands chats on an unreachable account | `missing` → recreate the workspace; the row is rewritten with the new account |
| Moving a healthy workspace to "balance" and losing installed packages | the cap only applies to new workspaces; a live box is never moved |
| An account comes back at the wrong moment and gets hammered | cooling returns at a fixed time, one creation at a time, and the load count still steers selection |
| Two servers both retry a dead worker's run | `retry_count` is a persisted compare-and-set guard |
| Retrying charges the account twice | the hour session and the usage row settle once, at the end |
| Fleet wake storms | one ping to the best member, a second only when it looks asleep or gone, and a two-minute floor per run |
| Free Render instance asleep at claim time | `last_seen_at` freshness is part of eligibility; escalation covers the rest |
| No scheduler is pointed at `run-sweep`, so the escalation never fires | the same escalation also runs from the run's polled status read, throttled by `last_wake_at`, so it needs no cron at all |
| Key material in logs or the admin panel | labels only; extend the redactor; a test asserts the panel never renders a key |
| Migration not re-runnable | `check:migrations` runs the whole set twice in CI |

## 8. Deliberately out of scope

- Billing per account (E2B spend attribution beyond sandbox counts). The counts
  in the admin panel are the honest minimum; a cost report needs E2B's usage API
  and a second credential policy.
- Moving a live sandbox between accounts. Not possible at the provider; a chat
  that loses its account is recreated, which is the contract in §3.7.
- Resuming a half-finished run at the exact tool it was on. The retry restarts
  the loop against the saved conversation and the surviving workspace, which is
  honest about what happened; replaying a half-applied tool call is not.
- Per-account provider templates. One `EXECUTION_TEMPLATE` still applies to all
  accounts; a mixed-template pool is a separate decision.
