# Chat-scoped sandbox lifecycle — design plan (Phase 12)

**Status: implemented (P12-T1 … P12-T7).** This document planned the change from
"one sandbox per message, destroyed at the end" to "one sandbox per chat,
stopped when idle and wiped after 48 hours of inactivity". It now also records
what shipped and how to operate it; see §15 for the runbook. The code it touches
is `lib/agent/sandbox.ts`, `app/api/chat/route.ts`,
`lib/execution/provider.ts`, `app/chat/actions.ts`, migration 023, and
`app/api/cron/sandbox-sweep/route.ts`.

The three requirements, restated as the invariants the implementation must hold:

1. **One environment per chat.** Two messages in the same chat share one
   filesystem, one `node_modules`, and one set of edits.
2. **Idle stops preserve disk.** When the chat goes quiet the container stops
   (compute released) and is started again on the next message, with the
   workspace exactly as it was left. Processes do not survive; files do.
3. **48 hours of inactivity wipes it.** Container, disk and environment row are
   destroyed, and the chat itself is untouched.

---

## 1. What exists today

| Caller | Sandbox | Lifetime | Teardown |
|---|---|---|---|
| Chat turn (`createShellTurn`) | ephemeral, TTL 10 min | created lazily on the first shell tool call | `close()` in `finally` → `destroy()` |
| Verification run (`executeRun`) | ephemeral, TTL `EXEC_MAX_MINUTES + 5` | one run | `finally` → `destroy()` |
| Mission tick (`runMissionTick`) | ephemeral, TTL mission minutes + 5 | across ticks, reattached by id | `end()` → `destroySandbox()` |

Four facts in the current code are what block persistence:

- `createSandbox` sends `ephemeral: true`. Per Daytona, that sets
  `autoDeleteInterval = 0`, and an ephemeral sandbox is **deleted on stop** —
  its filesystem is not kept. A persistent chat environment must be created
  with `ephemeral: false`.
- `ShellTurn.close()` calls `handle.destroy()`. Even a non-ephemeral box would
  not survive the turn.
- The chat path keys the sandbox on `turnId` (`lib/agent/sandbox.ts`), and
  nothing records a sandbox id anywhere. There is no row a later turn could
  look up.
- Chat deletion is database-only. `purgeChat` and `emptyTrash`
  (`app/chat/actions.ts`) delete `chats` rows; Postgres cascades, Daytona does
  not. A persistent box would leak unless deletion is given an explicit hook.

The lifecycle facts below decide several of the choices, and were read from
Daytona's documentation on 2026-11-05:

- <https://www.daytona.io/docs/en/linux-sandboxes/>
- <https://www.daytona.io/docs/en/typescript-sdk/daytona/>
- <https://www.daytona.io/docs/en/typescript-sdk/sandbox/>

The relevant ones:

| Fact | Consequence here |
|---|---|
| Container sandboxes preserve their filesystem across stop/start; stopped containers keep counting against disk quota | Stop is enough to release compute; archiving is the only way to release disk before the wipe |
| Pause is Linux-VM only, and mutually exclusive with auto-stop | The default snapshot is a container, so **stop** is the mechanism. Pause is a later option, not this plan |
| `autoStop` fires on inactivity; SDK interactions and state changes count as activity | Provider-side idle stop is a free safety net behind our own sweep |
| `autoDeleteInterval` counts **continuously stopped** time, not wall clock | 48 h after the idle stop is 48 h of inactivity — this is the backstop that works without a cron |
| Wall-clock TTL destroys in **any** state, from creation or the last `setTtl` | Never set a bare 48 h TTL at creation; it would kill a chat used every day. Refresh it on activity, with slack |
| `autoArchiveInterval: 0` means "maximum interval" (30 days), **not** off | Send the field only when archiving is actually wanted |

---

## 2. Decisions

### D12.1 — Stop, not pause

A chat environment is a **non-ephemeral container**. Idle means
`sandbox.stop()`: compute is released, the filesystem stays on the runner, and
`sandbox.start()` boots it again in seconds. Memory and background processes are
gone, which is fine: the chat shell has no `start_process` tool and every
`run_command` waits for its process. Missions, which do use background
processes, stay ephemeral (§D12.7).

If the default snapshot ever moves to a Linux VM, `autoPauseInterval` and
`sandbox.pause()` can preserve memory too. That is a separate decision because
pause and auto-stop cannot both be set, and because a paused VM still holds
compute-adjacent resources. This plan does not depend on it.

### D12.2 — One environment per chat, keyed by the pin it was seeded from

`chat_sandboxes` has one live row per `chat_id`, carrying `repo_full_name` and
`base_sha`. The disk is not the source of truth; the pinned commit is.

- Same `(repo, sha)` → reuse the disk.
- Different pin (the user attached another repository or moved the branch) →
  retire the old box and reseed. Keeping a disk from a different commit is how a
  model ends up reasoning about code that is not there.
- Approved pull requests do not reach the disk. The environment records the sha
  it was seeded from and keeps saying so; syncing a merged PR into a live
  workspace is out of scope.

### D12.3 — Opened lazily, on the first tool call

Nothing is provisioned when a message is sent. `createShellTurn` already builds
its handle inside `ensure()`, which only `run()` reaches; the resolver replaces
the `createSandbox` call in that same place. A question that needs no command
still costs no sandbox, and a chat that only talks never creates an environment
merely because it is open.

### D12.4 — Idle is five minutes, enforced three ways

`CHAT_SANDBOX_IDLE_MINUTES` (default **5**, clamped 1–60):

1. Provider `autoStopInterval` — stops the box even if Openmi is not running.
2. The sweep route — stops boxes whose `last_active_at` is older than the window.
3. A lease — a box held by a live turn is never stopped by either of the above.

Why five and not thirty: while a box is running, a 2 vCPU / 4 GiB container
costs about $0.00277/min, so five idle minutes cost roughly $0.014 of
unrecovered compute. A reseed plus a reinstall costs more than that in wall
clock and latency, and persistence is the product requirement. Below ~2 minutes
the start latency eats the benefit; above ~15 minutes an abandoned chat is
paying for nothing. Five is the balance, and it is configurable because the
right number is a cost observation, not a principle.

### D12.5 — The 48-hour wipe is sliding, and only deleted after the provider agrees

`delete_after = last_active_at + CHAT_SANDBOX_TTL_HOURS` (default **48**),
recomputed on every open and on every turn close. The wipe path is:

1. Provider `autoDeleteInterval = 2880` — after 48 h continuously stopped, the
   provider deletes the box even if our sweep never runs.
2. Wall-clock `ttlMinutes = 2880 + 60`, refreshed on open and close — a
   provider-side backstop for the case where auto-stop itself fails. The hour of
   slack exists so a turn that starts at minute 2879 is not killed mid-command.
3. The sweep destroys anything whose `delete_after` has passed, regardless of
   provider state, and deletes the row **only after** the provider confirms the
   box is gone (or reports 404).

The sweep is what enforces "48 hours" exactly. The provider timers are what keep
the promise when the sweep is not running (a Hobby deployment gets a daily cron
at best, and an outage is a normal Tuesday). No design here depends on cron
frequency for correctness.

### D12.6 — A per-owner cap, no new Dew charge

Running chat time is already paid for by the chat hour or request charge; the
sandbox is one of the things that charge buys. Pausing does not add a charge,
because the user is not consuming the workspace. What pausing does cost is disk:

| Resource | Rate | Cost per environment | At the cap (3 / owner) |
|---|---|---|---|
| Running container (2 vCPU / 4 GiB) | $0.1659/h | $0.00277/min | recovered by the chat charge |
| Stopped container, 3 GiB billable | $0.000108/GiB/h | ≈ $0.0078/day, ≈ $0.016 per 48 h | ≈ $0.05/owner/month worst case |

So: `CHAT_SANDBOX_MAX_PER_OWNER` (default **3**). On creating a fourth, the
least-recently-active environment for that owner is destroyed first. The
eviction is silent to the user — the next message in that chat reseeds and says
so — and it is the difference between "a useful cache" and "free storage".

Charging for a paused sandbox would need a new ledger kind, a new reservation,
and a product answer for what happens when the balance runs out while a box sits
idle. Not worth it for four cents a month; the cap is the control.

### D12.7 — Missions and verification stay ephemeral

A mission is a bounded, autonomous job with a deadline and its own budget, and a
verification run is one observation of one changeset. Neither may share a chat's
disk: a mission writes freely, and a verification run must not inherit the
model's earlier experiments. `createSandbox` keeps its current semantics;
persistence is a separate factory, not a flag someone can forget to set.

### D12.8 — Trash and purge destroy the box explicitly

`chats` rows cascade; containers do not. Both destructive paths get a provider
call:

- **Trash** — stop the box, mark it wipe-due now. Restoring the chat starts a
  fresh workspace. A trashed chat is intent to stop working; keeping a warming
  box for it is exactly the waste this plan is about.
- **Purge / empty trash** — set `state = 'wiping'` and `delete_after = now()`
  on the environment row *before* deleting the chat, then destroy inline. If
  the request dies between the two, the row survives because `chat_id` is
  `on delete set null`, and the next sweep wipes it. This is why the row's
  primary key is its own `id`, not `chat_id`.

Provider-side reconciliation by label is the last line: any sandbox labelled
`app=openmi, kind=chat` with no live row is destroyed. Labels are the only
ledger that survives a crash before the row insert.

### D12.9 — A paused shell turn can now continue

Today a turn that hits its time limit with a shell is not continued, because
`close()` destroys the sandbox and the continuation would re-provision and re-run
what the reader already watched (`app/api/chat/route.ts`). With persistence the
box is still there, so the `pausable = result.stopped === "paused" && !shellTurn`
rule becomes `pausable = result.stopped === "paused"`. The continuation
reattaches, and the step ledger still prevents replay. This falls out of the
change and removes a user-visible dead end.

---

## 3. Data model — migration `023_chat_sandboxes.sql`

Sketch, not applied. It follows the house style: `if not exists`, comments that
explain the decision, no client writes.

```sql
-- One live Linux workspace per chat.
--
-- Not a column on `chats`: a chat exists without an environment, an environment
-- can outlive its chat row (purge), and the sweep queries by lifecycle state,
-- not by chat. `id` is the primary key for that second reason; `chat_id` is
-- unique but nullable, and `on delete set null` is what lets a wipe survive the
-- cascade.

create table if not exists public.chat_sandboxes (
  id                  uuid primary key default gen_random_uuid(),
  chat_id             uuid unique references public.chats(id) on delete set null,
  owner               uuid not null references auth.users(id) on delete cascade,
  provider            text not null default 'daytona'
                        check (provider in ('daytona')),
  sandbox_id          text not null unique,
  state               text not null default 'provisioning'
                        check (state in ('provisioning','running','stopped',
                                         'archived','wiping','failed')),
  repo_full_name      text not null,
  base_sha            text not null,
  workspace_seeded_at timestamptz,
  last_active_at      timestamptz not null default now(),
  -- A live turn holds the box; a sweep must not stop or wipe it.
  lease_until         timestamptz,
  stopped_at          timestamptz,
  archived_at         timestamptz,
  -- last_active_at + TTL. Stored, not computed, so the sweep is an index scan.
  delete_after        timestamptz not null,
  wipe_attempts       integer not null default 0,
  failure_code        text,
  failure_detail      text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists chat_sandboxes_owner_active_idx
  on public.chat_sandboxes (owner, last_active_at desc);
create index if not exists chat_sandboxes_idle_idx
  on public.chat_sandboxes (state, last_active_at)
  where state = 'running';
create index if not exists chat_sandboxes_wipe_idx
  on public.chat_sandboxes (delete_after)
  where state in ('running','stopped','archived','failed','provisioning');

alter table public.chat_sandboxes enable row level security;

-- Service role only. The browser has no sandbox control surface: no client
-- read, no client write, no grants. Everything here is a server observation.
revoke all on public.chat_sandboxes from anon, authenticated;
```

`delete_after` is written from `last_active_at + interval`, using the same
function that computes the plan's numbers (`lib/execution/chat-env/lifecycle.ts`)
so the sweep and the card cannot disagree.

`state = 'wiping'` is the only state that survives a failed delete: the row
stays, `wipe_attempts` increments, and the sweep retries with a growing delay.
Deleting the row first is how a container becomes invisible and keeps billing.

---

## 4. State machine

```
                 first tool call
   (no row) ─────────────────────────► provisioning ──seeded──► running
                                            │                     │
                                            │ seed fails          │ idle 5 min
                                            ▼                     ▼
                                          failed ◄──────────── stopped
                                            │                     │
                                            │ next tool call      │ next tool call
                                            └────► provisioning   │ (start)
                                                                  ▼
                                                               running
   any state ──delete_after passed / trash / purge──► wiping ──provider confirms──► (row deleted)
```

| From | To | Actor | Guard |
|---|---|---|---|
| none | provisioning | `ensureChatSandbox` | execution configured, chat pinned |
| provisioning | running | resolver | workspace marker and `.git` verified |
| provisioning | failed | resolver | seed failed; container destroyed |
| running | stopped | sweep / provider auto-stop | `lease_until` in the past |
| stopped | running | resolver | `start()` succeeded, marker verified |
| stopped | wiping | sweep | `delete_after < now`, no live lease |
| archived | running | resolver | `start()` restores the filesystem |
| any | wiping | trash/purge | row marked before the chat delete |
| wiping | (deleted) | sweep | provider `delete` succeeded or 404 |

`provisioning` older than 15 minutes with an expired lease is an orphan: attach,
destroy, mark `failed`. The next message reseeds.

---

## 5. Execution provider changes (`lib/execution/provider.ts`)

The handle grows the operations lifecycle needs. Everything is optional on the
type only where a caller may legitimately not use it; `createChatSandbox`
returns a handle that has them.

```ts
export type SandboxState =
  | "pending" | "starting" | "started" | "stopping" | "stopped"
  | "archiving" | "archived" | "error" | "destroyed";

export type SandboxHandle = {
  id: string;
  exec: ...; upload: ...; readText: ...; destroy: ...;
  /** Normalised provider state, for the sweep and resume decisions. */
  state: () => Promise<SandboxState>;
  start: (timeoutSeconds?: number) => Promise<void>;
  stop: (options?: { force?: boolean }) => Promise<void>;
  /** Refresh the wall-clock ceiling. Persistent boxes only. */
  setTtl: (minutes: number) => Promise<void>;
};
```

Two factories, not a boolean:

```ts
/** Unchanged: verification runs and missions. */
createSandbox(runId, { ttlMinutes, labels });
/** A chat's long-lived workspace. */
createChatSandbox({ chatId, owner, ttlMinutes, idleMinutes, archiveMinutes });
```

`createChatSandbox` sends, and this is the whole of the difference:

```ts
{
  snapshot: executionSnapshot(),
  ephemeral: false,
  ttlMinutes: chatTtlMinutes,          // 48h + 1h slack, refreshed on activity
  autoStopInterval: idleMinutes,       // 5
  autoDeleteInterval: chatTtlMinutes,  // 48h continuously stopped
  ...(archiveMinutes > 0 ? { autoArchiveInterval: archiveMinutes } : {}),
  labels: { app: "openmi", kind: "chat", chat: chatId, owner: owner.slice(0, 8) },
  public: false,
  ...(networkAllowlistEnabled()
    ? { domainAllowList: EXEC_ALLOWED_DOMAINS.join(",") }
    : {}),
}
```

The archive field is conditional because `autoArchiveInterval: 0` means the
maximum interval (30 days), not "off" — sending it by accident would keep a
stopped disk for a month. Default `CHAT_SANDBOX_ARCHIVE_HOURS = 0` (do not send),
with 24 h as the optional middle tier for an organisation whose disk quota is
tight: it frees the runner's quota, and a later `start()` restores the filesystem.

`attachSandbox` is unchanged; a stopped sandbox can be fetched, so the resolver
attaches and then calls `start()`. Error classification gains one case:

```ts
new SandboxStartError("missing", ...)   // 404 / not found / already deleted
```

`missing` is recoverable by reseeding. `quota`, `not_configured` and `refused`
keep their current meaning and are reported to the user as they are today.

---

## 6. Session handler integration

### 6.1 `lib/agent/sandbox.ts`

`ShellTurnOptions` gains `chatId`, `owner`, and `notice?: (message: string) => void`.
The lazy `ensure()` becomes:

```ts
const opened = await openChatSandbox({
  chatId, owner, repo, sha,
  leaseMs: CHAT_SANDBOX_LEASE_MS,   // 10 min, above maxDuration = 300 s
});
if (!opened.ok) return failure(opened.message);
sandbox = opened.handle;
if (opened.notice) options.notice?.(opened.notice);
```

`close()` becomes a release, not a destroy:

```ts
async close() {
  if (closed) return;
  closed = true;
  if (starting) await starting;             // never abandon an in-flight create
  await releaseChatSandbox({ chatId, owner, sandbox });   // last_active, lease, TTL
  sandbox = null;
}
```

Two exceptions still destroy:

- The create succeeded but seeding failed. The row is deleted and the container
  destroyed; there is no workspace to keep.
- The turn's chat was deleted mid-turn (the row is gone). Destroy rather than
  leave a box no row points at.

The in-flight `starting` promise stays awaited, as it is today, so the box that
was created is the one recorded and released rather than one left to a TTL.

### 6.2 `app/api/chat/route.ts`

- Pass `chatId` and `session.user.id` into `createShellTurn`.
- Wire `notice` to the existing SSE writer: `notice: (message) => send("notice", { message })`.
  Resuming an archived box can take a few seconds; the reader should see
  "Waking this chat's workspace…" instead of a silent pause.
- `await shellTurn?.close()` stays where it is, in the `finally`.
- The pause branch drops the `!shellTurn` condition (D12.9).
- `maxDuration = 300` and `CHAT_SHELL_BUDGET_MS = 200_000` are unchanged. The
  resume happens inside the turn's budget; a start that cannot finish in time
  returns a tool failure, and the next message retries.

### 6.3 What the model is told (`lib/prompt.ts`)

`SHELL_CLAUSE` gains one sentence: the workspace may hold uncommitted changes
from earlier messages in this chat, and `git status` is how to see them. Without
it a model will assume a clean checkout and "restore" files it never changed.

### 6.4 The resolver (`lib/execution/chat-env/open.ts`, server-only)

Order of operations, all inside the turn's lease:

1. Read the owner's rows lazily during this call (bounded, see §7.4) so a
   low-traffic deployment still cleans up without a cron.
2. If no row → enforce the per-owner cap by evicting the LRU, create, **insert
   the row immediately with `sandbox_id`**, then seed. Recording before seeding
   is what makes a crash mid-seed recoverable instead of an invisible container.
3. If the row's pin differs → mark wiping, destroy, insert/update with the new
   pin, reseed.
4. If `state = 'stopped' | 'archived'` → `attach`, `start(90)`, verify the
   workspace marker (`openmi-workspace/.openmi/env.json` plus `.git`), scrub
   `.env*`, set `running`.
5. If `state = 'running'` → attach, verify reachable. A 404 means the provider
   lost it: destroy the stale row and provision once, with a notice.
6. Set `last_active_at = now`, `delete_after = now + TTL`, `lease_until`, and
   `setTtl(ttlMinutes + slack)` before returning.

The marker is new: `workspace_seeded_at` in the row is the database's opinion of
the disk, and a marker file is the disk's opinion of itself. Seeding writes both;
resume compares both. A disk without the marker is reseeded rather than trusted.

Single-flight: an in-process `Map<chatId, Promise>` covers two tabs hitting the
same deployment; the row's `lease_until` covers two deployments. A second turn
that finds a live lease waits up to 20 s and then reports that the workspace is
being prepared in another tab, rather than starting a second box.

---

## 7. The sweep (`app/api/cron/sandbox-sweep/route.ts`)

A Node route, `dynamic = "force-dynamic"`, `maxDuration = 300`, no session. It
authenticates one way: `Authorization: Bearer ${CRON_SECRET}`, compared with
`crypto.timingSafeEqual`. With no `CRON_SECRET` set it returns 503 and says so;
the provider timers still stop and wipe boxes.

`vercel.json`:

```jsonc
{ "crons": [{ "path": "/api/cron/sandbox-sweep", "schedule": "0 5 * * *" }] }
```

The schedule is daily because Vercel Hobby rejects any cron that runs more than
once a day (`*/10` fails the deployment outright), and Pro is not required for a
backstop. A less frequent sweep is acceptable because of §D12.5: the provider's
own `autoStopInterval`, `autoDeleteInterval` and `ttlMinutes` timers enforce the
idle stop and the wipe times, and the resolver cleans up lazily on every open.
The sweep is what reconciles the database and the provider ledger, not the
clock that keeps boxes from billing.

To run it every ten minutes on a Hobby plan, call the same route from an
external scheduler (for example a GitHub Actions `schedule` workflow) with the
`Authorization: Bearer $CRON_SECRET` header; the route does not care who
invokes it.
The route is safe to call by hand with `?dry=1`, which returns the planned
actions and changes nothing.

Order matters: **wipe → stop → reconcile**. Wiping first means a due box is not
stopped first and left for a second pass.

| Pass | Query | Action | On failure |
|---|---|---|---|
| expire | `delete_after < now()`, no live lease | state `wiping` → attach → destroy → delete row | keep row, `wipe_attempts += 1`, retry next sweep; never delete before confirmation |
| stop | `state = 'running'`, `last_active_at < now() - idle`, no live lease | attach → `stop()` → `stopped_at = now()` | leave `running`, record detail |
| archive (opt-in) | `state = 'stopped'`, `stopped_at` old, archive enabled | rely on `autoArchiveInterval`; the pass only records `archived_at` from provider state | no-op |
| reconcile | provider list, label `app=openmi,kind=chat` | destroy boxes with no row, older than 15 min | log and retry next run |

Each pass is bounded (`limit 25`) so one invocation cannot exceed the ceiling.
Leases are the rule that prevents a wipe from landing on a turn that started
one second before the deadline: every pass filters
`coalesce(lease_until, 'epoch') < now()`.

### 7.1 Monitoring, not a dashboard

One structured line per pass: `{ pass, candidates, acted, failed, durationMs }`.
The admin status surface can later show live/stopped/due counts; no new user UI
is needed for this phase.

---

## 8. Failure matrix

| Situation | What the user sees | Data | Money |
|---|---|---|---|
| Resume start times out | "The workspace could not be woken; this command did not run." Then a reseed on the next try | row `failed`, container destroyed | no extra charge; chat charge unchanged |
| Provider says 404 for a recorded id | "The workspace had to be recreated; uncommitted files are gone." | row replaced, seed at the pinned sha | reseed is free |
| Seed fails after create | "The repository could not be seeded." | row deleted, container destroyed | no sandbox charge for chat |
| Two tabs, same chat | second tab: "The workspace is being prepared in another tab." | one lease holder, one box | one box |
| Sweep misses the 5-min idle | box keeps running until the provider's auto-stop | none | up to the provider's idle window |
| Sweep misses 48 h | provider auto-delete at 48 h continuously stopped | row remains until the next sweep deletes it | none |
| Provider delete fails | nothing user-visible | row stays `wiping`, `wipe_attempts` grows, retried | disk cost continues until delete works; this is visible in the log |
| Chat purged mid-turn | turn ends; next message is "that chat does not exist" | row survives `chat_id = null` until the wipe | none |
| Account deleted | provider reconcile finds label-only boxes | rows cascade | bounded by reconcile |
| Pin changed between messages | "The workspace was reseeded at the new commit; uncommitted files are gone." | destroy + reseed | one reseed |
| Daytona outage during resume | "The sandbox could not be started: …" | row `failed`; no infinite retry | none |
| A mission is running | unchanged, ephemeral, own container | unaffected | unchanged |

The rule behind the table: **never claim the workspace survived when it did
not.** A reseed is announced; a lost disk is named as a lost disk.

---

## 9. Billing, caps and storage

- **No new ledger kind.** Chat sandboxes are covered by the existing hour or
  request charge. This keeps the ledger's `sum(amount) = dew_balance` invariant
  untouched and avoids a new reservation to refund when a chat is abandoned.
- **Cap per owner:** 3 live environments. Eviction is by `last_active_at`,
  oldest first, and happens before the create, not after. Eviction destroys the
  container and deletes the row.
- **Cap per deployment:** alert when live environments exceed 50; the sweep logs
  it. A hard global cap is a later operational decision, because the right number
  depends on the Daytona plan's disk quota.
- **Archive middle tier:** off by default. Turning on `CHAT_SANDBOX_ARCHIVE_HOURS`
  (24 is the sensible value) frees the runner's disk quota while keeping the
  filesystem in object storage; the cost is a longer resume. Worth enabling only
  if the quota, not the dollar cost, becomes the limit.

---

## 10. Security

- The table is service-role only: RLS on, no policies, no grants to
  `anon`/`authenticated`. The browser never names a sandbox id. The resolver
  derives it from `chat_id` and the session owner, which the chat select has
  already proved.
- The sandbox still holds no credential. The seed strips `.env*`; resume strips
  them again, because a previous message's `write_file` could have created one.
- No filesystem snapshots are created for chat environments. A snapshot would
  outlive the 48-hour wipe and quietly defeat it.
- Destruction is idempotent: treat 404 on delete as success. A `stop` on an
  already-stopped box is a no-op.
- The workspace is not a trust boundary between messages in the same chat; it is
  one owner's own machine. It is a boundary between chats, and the row's unique
  `chat_id` plus owner-scoped resolver is what enforces that.

---

## 11. Tests and exit gates

Pure logic, in the house style (`lib/execution/chat-env/lifecycle.ts`, no
`server-only`):

- `deleteAfter(lastActive)` is exactly +48 h.
- `shouldStop` false at 4 m 59 s, true at 5 m.
- `shouldWipe` false at 47 h 59 m, true at 48 h.
- A live lease blocks both stop and wipe.
- Resuming at 47 h recomputes `delete_after`, so the box is not wiped while in use.
- Cap eviction picks the least-recently-active row and never the current chat.
- Pin mismatch is a reseed, not a reuse.

Contract tests (`tests/chat-env.test.ts`), reading source the way
`tests/mission-default.test.ts` already does:

- `createShellTurn`'s `close()` contains no `destroy()` on the happy path.
- `createChatSandbox` is the only place that sends `ephemeral: false`.
- `autoArchiveInterval` is sent conditionally.
- The chat route passes `chatId` and wires the resume notice.
- `purgeChat`/`emptyTrash` mark the environment wiping before deleting the chat.
- The sweep route compares `CRON_SECRET` and returns 503 without it.
- Migration 023 contains the table, the unique `chat_id`, and no client grants.

Infrastructure gates:

- `bun run check:migrations` — both passes clean; add `chat_sandboxes` to the
  script's required tables in the same PR.
- `tests/rls-audit.test.ts` — the new table must appear as "enabled, no client
  policy", not be missed by the audit.
- `bun run typecheck`, `bun test tests`.
- One manual provider smoke test, gated on `DAYTONA_API_KEY`, never in CI:
  create → write a file → `stop()` → `start()` → read the file → `destroy()`.
  This is the one claim that cannot be proven with mocks: stop preserves disk.
  It is also the test that would have caught `ephemeral: true`.

---

## 12. PR sequence

One task per pull request, each independently deployable and reversible.

| Task | Files | Deliverable | Exit gate |
|---|---|---|---|
| **P12-T1** Schema and constants | `supabase/migrations/023_chat_sandboxes.sql`, `lib/execution/chat-env/lifecycle.ts`, `lib/env.ts`, `.env.example`, `scripts/check-migrations.mjs` | table, indexes, pure lifecycle math, env spec entries | migrations twice; pure tests green; no behavior change |
| **P12-T2** Provider lifecycle | `lib/execution/provider.ts` | `state/start/stop/setTtl`, `createChatSandbox`, `missing` classification | typecheck; existing execution/mission tests unchanged |
| **P12-T3** Store and resolver | `lib/execution/chat-env/store.ts`, `open.ts`, `release.ts` | row operations, cap eviction, resume/reseed, marker | resolver tests with a fake handle |
| **P12-T4** Chat turn integration | `lib/agent/sandbox.ts`, `app/api/chat/route.ts`, `lib/prompt.ts` | lazy open, release instead of destroy, resume notice, paused continuation | channel test; `tests/mission-default.test.ts` still green |
| **P12-T5** Sweep | `app/api/cron/sandbox-sweep/route.ts`, `vercel.json`, `app/api/admin/status/route.ts` | expire/stop/reconcile, auth, dry run, counts | route contract test; dry run on a deployment |
| **P12-T6** Destructive paths | `app/chat/actions.ts` | trash stops, purge/empty-trash wipe, LRU eviction | actions test; purge leaves no row and no container |
| **P12-T7** Docs and rollout | `docs/SANDBOX_LIFECYCLE_PLAN.md`, `README.md` | status, config, runbook | manual provider smoke recorded |

P12-T1 through T3 change no user-visible behavior; the irreversible switch is
T4. That means the rollout can stop after T3 with a schema and a provider
surface that nothing uses yet.

---

## 13. Rollout and rollback

Rollout:

1. Apply migration 023 (`supabase db push`) before deploying T1. The check script
   proves it is safe to apply twice.
2. Deploy T2–T3 dark.
3. Enable T4 for one account (owner allowlist env, `CHAT_SANDBOX_OWNERS`) and
   watch: resume latency, idle stops, wipe count, provider 404 rate.
4. Remove the allowlist.

Rollback:

- Set `CHAT_SANDBOX_ENABLED=off`. New turns create ephemeral sandboxes exactly as
  they do today (the old path stays in the provider), and the sweep continues to
  run purely as a drainer.
- Drain: mark every row `delete_after = now()`, let one sweep destroy them, then
  remove the cron. No chat data is touched — the transcript was never in the box.
- The table can stay deployed indefinitely; an unused table costs nothing and
  dropping it would make the rollback irreversible.

---

## 14. Open decisions for the owner

Two, both operational rather than architectural:

1. **Archive at 24 h?** Off in the default. Turn it on if the Daytona
   organisation's disk quota, not the dollar cost, is the constraint. Resume gets
   slower; nothing else changes.
2. **Is three environments per account the right cap?** It is set from the
   worst-case storage arithmetic, not from usage data. If real accounts touch
   more than three repository chats in 48 hours, the number moves; the eviction
   path already exists.

Everything else above is decided, because the code and the provider semantics
decide it.

---

## 15. What shipped, and how to run it

### 15.1 Implementation status

| Task | Delivered |
|---|---|
| P12-T1 | `supabase/migrations/023_chat_sandboxes.sql`; `lib/execution/chat-env/lifecycle.ts`; env spec entries; migration check updated |
| P12-T2 | `state/start/stop/setTtl` on the handle; `createChatSandbox`; `missing` classification |
| P12-T3 | `chat-env/store.ts`, `seed.ts`, `open.ts`; provisional row before seed; marker; LRU eviction; lease claim |
| P12-T4 | Chat turn opens the chat's workspace, releases on turn end, resume notice, paused continuation, prompt paragraph |
| P12-T5 | `/api/cron/sandbox-sweep` (expire → stop → reconcile, `?dry=1`), `vercel.json`, confirmed provider delete, labelled list, admin counts |
| P12-T6 | Trash stops and queues the disk; purge and empty-trash mark wiping and destroy before the chat row goes |
| P12-T7 | This section and the README configuration |

Two departures from the sketch above, both deliberate:

- The row is claimed with a conditional `update … where lease_until is null or
  lease_until < now` rather than a read-then-write. Two deployments otherwise
  both see a free lease.
- A failed provider delete leaves the row `wiping` with `wipe_attempts + 1`.
  `chat_id` stays attached until the chat row goes; the cascade then nulls it,
  which is why the row is keyed by its own `id`.

### 15.2 Configuration

| Variable | Default | Meaning |
|---|---|---|
| `CHAT_SANDBOX_ENABLED` | on | `off` restores one box per message (rollback) |
| `CHAT_SANDBOX_IDLE_MINUTES` | 5 | idle before stop; clamped 1–60 |
| `CHAT_SANDBOX_TTL_HOURS` | 48 | inactivity before wipe; clamped 1–168 |
| `CHAT_SANDBOX_ARCHIVE_HOURS` | 0 (off) | archive stopped disks; `24` when quota is the limit |
| `CHAT_SANDBOX_MAX_PER_OWNER` | 3 | live environments per account; clamped 1–10 |
| `CRON_SECRET` | unset | required for the sweep; unset → 503, provider timers only |

The provider receives `autoStopInterval = idle`, `autoDeleteInterval = 48h` and a
wall-clock `ttlMinutes = 48h + 60min` refreshed on open and close. Archiving is
sent only when the hours are greater than zero: in the provider, zero means the
maximum interval, not "off".

### 15.3 Deploy and verify

1. Apply migration 023 before deploying (`bun run check:migrations` proves it is
   safe twice; `supabase db push` is still the deployment step).
2. Set `CRON_SECRET` and confirm `vercel.json` was picked up (Vercel → Cron
   Jobs). Call `GET /api/cron/sandbox-sweep?dry=1` with the bearer token: it must
   return the three pass reports and change nothing.
3. Send two messages in one chat, each running `pwd` and writing a file. The
   second must see the first file. This is the product claim.
4. Wait past the idle window and confirm the provider state is `stopped` while
   the row says `stopped`; send another message and confirm it starts and the
   file is still there.
5. Gated manual provider smoke (never in CI, needs `DAYTONA_API_KEY`):
   `createChatSandbox` → write a file → `stop()` → `start()` → read the file →
   `destroySandboxConfirmed()`. This is the one claim mocks cannot prove.
6. Trash a chat with a workspace: the container stops, the row becomes
   `wiping` with `delete_after = now`. Purge it: the row and the container go.
   A failed provider delete must leave a `wiping` row, not a missing one.

### 15.4 Triage

| Symptom | First place to look |
|---|---|
| A chat never resumes | `chat_sandboxes.state`, `failure_code`, `wipe_attempts`; then provider state for `sandbox_id` |
| The sweep returns 503 | `CRON_SECRET` unset; the provider timers are still enforcing stop/delete |
| A container bills with no row | sweep `reconcile` pass; provider label `app=openmi, kind=chat` |
| Duplicate workspaces | the row's `lease_until`; a live lease should make the second turn wait |
| Wipe never lands | `delete_after` in the past and `lease_until` in the past; the provider delete is retried by every sweep |
