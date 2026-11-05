# Mission mode — agent-driven Linux execution (Phase 11, plan)

**Status: built — P11-T1 … P11-T8. P11-T9 (a dedicated mission snapshot) is not
built.** This is the design that turns Openmi from "propose a diff, then verify
it" into "name a goal, watch an agent work a real Linux box". It is the
remaining half of Phase 10 that `docs/EXECUTION_ENVIRONMENT_PLAN.md` explicitly
deferred.

Two build notes where the code is simpler than the plan below and neither
changes a contract:

- the tick is authorised by the owner's session plus a same-origin check, not a
  signed ticket. A replayed tick can only advance a mission the caller already
  owns, and `claimTick` makes two concurrent ticks harmless, so a ticket added
  machinery without adding authority;
- the collected diff becomes a changeset inside the finishing tick rather than
  in a separate route, so there is no window where a mission is `done` with no
  card to review.

It is the remaining half of Phase 10 that

> the agent does not get a shell of its own; it proposes a changeset in chat,
> and the run verifies that changeset.

Mission mode gives the agent that shell. It supersedes one decision and keeps
the rest:

| Decision | Verify runs (built) | Mission runs (this plan) |
|---|---|---|
| D6.1 — who picks the command | the runner, from an enumerated list | **the model, no list** |
| D6.2 — price | 0.05 Dew per started minute | same rate, bigger reserve |
| D6.3 — secrets in the sandbox | none | **none — unchanged** |
| D6.4 — failure vocabulary | specific and stored | same, plus mission-specific codes |
| GitHub write | approval → branch → PR | **unchanged: still approval** |

The one sentence to hold on to: **full access inside the sandbox, zero access to
the platform.** That is not a compromise on the request; it is what makes the
request safe to ship.

---

## 1. The request, as behaviour

Today a turn is: read files → propose edits → the browser shows a diff → a run
builds it. The user's ask is one sentence: *"here is the goal — go do it."*

```
user types: "make the landing page load under 1s, then open a PR"
        │
        ▼
 POST /api/missions            reserve Dew, record the mission, create the sandbox
        │
        ▼
 tick loop (server, ≤4 min per tick, sandbox reused across ticks)
        │
        ├── model sees: goal, repo tree, last command outputs, remaining budget
        ├── model decides: run `npm run build`, read `app/page.tsx`, write a file…
        ├── server runs it verbatim in the sandbox, records command + exit + tail
        └── model calls finish(summary) or the budget runs out
        │
        ▼
 server collects `git status` + `git diff` → signed changeset (existing path)
        │
        ▼
 user reviews → approve → branch + PR   (existing path, unchanged)
```

Nothing about approval changes. The agent may run anything; it still cannot
write to GitHub. A "ship it" autonomy level exists (§9) and it still goes
through the same server-side commit function, on an `openmi/agent/*` branch,
with the **Openmi** author required by `agent-push-requirements.md`.

## 2. What already exists, and what is actually missing

Reusable as-is:

- `lib/execution/provider.ts` — the only module that imports `@daytona/sdk`.
  It already creates an ephemeral, credential-free sandbox with a TTL and a
  classified start error. It needs a wider handle, not a replacement.
- `lib/execution/archive.ts` — repo → tarball → `sandbox.fs.uploadFile`. The
  seeding trick (no remote, no credential, throwaway `git init`) is exactly
  what a mission needs too.
- `supabase/migrations/016_execution.sql` + `017_execution_dew.sql` — run rows,
  event rows, owner RLS, reserve/settle ledger functions. Missions extend this
  table rather than inventing a second billing system.
- `lib/execution/cost.ts` — per-started-minute arithmetic and `chargeForDuration`.
- `lib/execution/status.ts` — the "a sentence comes from a row" pattern.
- `components/ExecutionPanel.tsx` — the poll-a-row UI pattern to copy.
- `lib/agent/run.ts` — the bounded tool loop, provider fallback, step accounting.
- `lib/changesets/*` — signed changeset → approval → branch → PR.

Missing, and therefore the work:

1. A tool that takes a **shell string** from the model. Nothing in
   `lib/agent/tools.ts` can do that today, by design.
2. **Persistence of an agent conversation across server invocations.** A Vercel
   function ends at 300s; a mission does not.
3. A **sandbox that outlives one request** — verify runs create and destroy one
   per run; a mission reuses one across ticks.
4. **Per-command records** — `execution_runs` stores one `install_command` and
   one `build_command`. A mission runs dozens of commands and the UI must show
   each one truthfully.
5. A **mission-shaped changeset**: today a changeset is the input to a run; for
   a mission it is the output.

## 3. Decisions

### D11.1 — Who chooses what runs?

**The model. No allowlist, no enumerated steps, no "the runner knows best".**

`run_command` takes a string and executes it verbatim as the sandbox user. This
is the request, and it is the only honest way to offer "the AI decides".

Guards are **environmental, not lexical**:

- the sandbox is ephemeral, credential-free, network-isolated from Openmi's own
  infrastructure, and capped in wall-clock time;
- every command is recorded before its output is accepted;
- a command timeout kills the process, not the mission;
- one mission per account, N missions per deployment (`MISSION_MAX_CONCURRENT`).

A denylist of "bad commands" is explicitly rejected: it is unenforceable
(`bash -c "$(printf …)"`), it breaks legitimate work (`rm -rf node_modules`),
and it creates the false impression that the sandbox is safe because of a
string filter. The sandbox is safe because of what is *not* in it.

**Verify runs keep D6.1.** A user clicking "verify this diff" gets the
deterministic install/build/typecheck path; it is cheaper, faster and its
result is comparable across runs. Two modes, two contracts, both stated.

### D11.2 — What does "full access" mean?

**Root inside the sandbox. Nothing outside it.**

| The model can | The model cannot |
|---|---|
| run any command, including `sudo`, `apt-get`, `pip`, `npm`, `curl` | read any Openmi secret (`DAYTONA_API_KEY`, `GITHUB_TOKEN_KEY`, provider keys, Supabase keys) |
| read/write/delete any file under the sandbox home, and as root, anywhere in the sandbox | reach Openmi's Postgres, Supabase, Vercel or internal network |
| install software, start daemons, bind ports inside the sandbox | expose a sandbox port to the public internet (`public: false`) |
| make outbound requests the Daytona org's network policy allows | push to GitHub: there is no token, no remote and no credential in the sandbox |
| run for up to the mission's wall-clock cap | outlive the mission: TTL and explicit `delete()` on every exit path |

Why the platform secrets stay out — this is the part worth being blunt about.
A mission reads repository content, and repository content is attacker-controlled
(a README, a fixture, a `postinstall`). An agent with a shell *and* the user's
GitHub token is one prompt injection away from pushing to `main` or exfiltrating
the token. The same is true of `SUPABASE_SERVICE_ROLE_KEY`, which would let
injected content rewrite every account's Dew balance. The product already made
this call in D6.3; a shell does not change the reasoning, it strengthens it.

So the boundary is enforced where it cannot be argued with:

1. **Environment scrubbing.** The sandbox process env is built explicitly —
   `PATH`, `HOME`, `TERM=dumb`, `LANG`, `CI=1`, `OPENMI_MISSION=1` — never
   `process.env`. A test asserts no key matching `/(KEY|TOKEN|SECRET|PASSWORD)/`
   is reachable from the env builder.
2. **No credential in the workspace.** `.env*` is stripped at seed time (already
   implemented in `lib/execution/run.ts`); the archive is fetched server-side
   with the user's sealed token and never carries it.
3. **No push path.** The throwaway `git init` has no remote. Approval still runs
   in `lib/changesets/commit.ts` on the server.
4. **Network is the provider's policy, not ours.** `EXEC_NETWORK_ALLOWLIST`
   stays off by default, for the reason already documented in
   `lib/execution/provider.ts`: a restricted org rejects the field and every
   sandbox fails. Mission mode needs the open internet to `apt-get` and
   `npm install`; with no secrets in the box, the residual risk is compute
   abuse, which §D11.3 bounds by time, concurrency and price.

**Residual risk, stated rather than hidden:** a sandbox with open egress can be
used to send traffic at a third party for the length of one mission. That is a
terms-of-service problem, not a secret-leak problem, and the mitigation is an
abuse report path plus the same email-verified account that tops up Dew. It is
listed in §15.

### D11.3 — How is a long-running mission bounded?

A mission is not one request. Vercel gives 300s; a real goal takes longer. The
design reuses the pattern the product already trusts — **a row is the state, a
signed ticket is the right to advance it** (`lib/agent/envelope.ts`).

- `MISSION_TICK_MS = 240_000`. One tick is one server invocation that runs
  model steps until 240s elapse, the model calls `finish`, or a cap is hit.
  Every tick ends by writing `last_tick_at` and a signed continuation ticket
  into the row.
- The **browser's poll advances the mission** (`POST /api/missions/{id}/tick`
  carrying the ticket). This is deliberate and it is not a lie: a mission is
  interactive, like a terminal session. If the tab closes, the mission stops
  advancing and the row says **`paused — no tick for 60s`**, not "running".
  A closed tab never bills for work that is not happening.
- `deadline_at = started_at + maxMinutes`. A tick that would cross it ends the
  mission as `timed_out` and keeps the partial diff.
- Caps, all enforced in code:

| Cap | Value | Why |
|---|---|---|
| `MISSION_MAX_MINUTES` | 20 default, 30 hard ceiling | one mission, one sitting |
| `MISSION_MAX_COMMANDS` | 200 | bounds the ledger row count and abuse |
| `MISSION_MAX_STEPS` | 60 model decisions | a model that has not converged in 60 steps will not |
| `MISSION_MAX_COMMAND_TIMEOUT_MS` | 120s foreground, 300s background | one hung command is not a hung mission |
| `MISSION_MAX_OUTPUT_BYTES` | 32 KiB tail per command | a mission's output is a stream, not an archive |
| `MISSION_MAX_TOKENS` | 240,000 | same envelope discipline as a turn |
| `MISSION_MAX_CONCURRENT` | 2 globally (env) | Tier 1 vCPU pool |
| one active mission per owner | unique index (reuse `execution_runs_one_active_per_owner`) | no double billing, no racing sandbox |

- **Stall detection.** Two consecutive ticks with no command, no file write and
  no `finish` → `stalled`, sandbox destroyed, partial diff kept. The model gets
  one explicit nudge ("you have not acted in two ticks; act or call finish")
  before this fires.

### D11.4 — Price

Same rate as verification, different reserve. An execution hour costs the same
as a chat hour, as `docs/EXECUTION_ENVIRONMENT_PLAN.md` established.

```
EXEC_DEW_PER_MINUTE      0.05     (unchanged, lib/execution/cost.ts)
EXEC_MISSION_MAX_MINUTES 20       (30 hard ceiling)
MISSION_RESERVE_DEW      1.0      = 0.05 × 20, reserved before daytona.create
```

- Reserve before the sandbox exists; `402` and no row if the balance cannot
  cover it.
- Settle on recorded wall time, rounded up to a started minute, capped at the
  reserve — the same `execution_settle_dew` function, no new ledger kind.
- A mission that never got a sandbox is refunded in full (existing behaviour in
  `executeRun`'s `finally`).
- Model tokens are covered by the active session, exactly as a turn's are (D4).
- The card shows minutes and Dew as two numbers, because they are two facts.

### D11.5 — What may the UI claim?

**Every sentence is a rendering of a stored row.** The mission card may say
"ran 34 commands, `npm run build` exited 0" only because `execution_commands`
contains 34 rows and the build row has `exit_code = 0`. It may never say "all
tests pass" — there is no test-runner contract in this phase, and a command that
happens to be named `test` is not proof of coverage.

`finish` is a request, not a truth: the server accepts it only if the sandbox
recording agrees (`git status` non-empty, or an explicit `no_changes` recorded).
A model that says "done" with no diff produces `no_changes`, not a success card.

## 4. Architecture

```
app/api/missions/route.ts            POST create · GET latest for a chat
app/api/missions/[id]/route.ts       GET state · DELETE cancel
app/api/missions/[id]/tick/route.ts  POST advance (signed ticket required)
app/api/missions/[id]/changeset/route.ts  POST collect diff → signed changeset
lib/execution/mission/loop.ts        the tick: model → command → observe
lib/execution/mission/tools.ts       run_command, read/write/list/search, finish
lib/execution/mission/prompt.ts      the mission system contract
lib/execution/mission/state.ts       mission_messages persistence + compaction
lib/execution/mission/collect.ts     git status/diff → ProposedFile[]
lib/execution/mission/budget.ts      caps, clock, stall detection (pure)
lib/execution/provider.ts            + execWithTimeout, readFile/list, sessions
lib/http/origin.ts                   same-origin check for mutating routes (new)
components/MissionPanel.tsx          composer + live terminal + result
```

The loop, per tick:

```ts
while (elapsed < MISSION_TICK_MS && !finished) {
  const decision = await streamModel({ system, messages, tools: MISSION_TOOLS });

  if (decision.tool === "run_command") {
    const row = await recordCommand(runId, decision.args);      // before exec
    const result = await sandbox.exec(decision.args.command, cwd, timeout);
    await completeCommand(row.id, result);                      // exit, tail
    messages.push(toolResult(result));
  }

  if (decision.tool === "finish") { finished = true; }
}

await writeTicketAndTickTime(runId);
if (!finished && beforeDeadline) return { state: "running" };   // browser ticks again
```

The model conversation lives in `mission_messages` (JSONB, service-role only)
and is compacted deterministically between ticks: the last 12 messages are
kept verbatim, older ones are replaced by a generated ledger note built from
`execution_commands` rows — not by another model call, so compaction cannot
invent an observation.

## 5. The tool surface (mission-only)

Added in `lib/execution/mission/tools.ts`; **not** in `lib/agent/tools.ts`,
which keeps its no-shell guarantee and its test.

| Tool | Parameters | Notes |
|---|---|---|
| `run_command` | `command`, `cwd?`, `timeout_ms?`, `purpose` | The shell. Executed verbatim. Output tail 32 KiB. |
| `read_file` | `path`, `offset?`, `limit?` | Path must stay under the workspace root. |
| `write_file` | `path`, `content` | Whole file; parents created; path sanitised with `safeRepoPath`. |
| `list_files` | `path?` | `find`-based, 300-entry cap. |
| `search_files` | `query`, `path?` | `rg --fixed-strings`, 40 hits. |
| `start_process` | `command`, `cwd?` | Background session (dev server, watcher); returns a session id. |
| `read_process` | `id`, `lines?` | Tails a background session. |
| `kill_process` | `id` | Killed automatically at mission end. |
| `finish` | `summary`, `checks?` | `checks` is a list of `{command, expect_exit_zero}` the model claims to have run; the server verifies each against `execution_commands`. |

`purpose` is required on `run_command` and stored: it is the one-line reason the
agent gives, and it is what makes the terminal readable instead of a wall of
`npm` output.

No tool takes a URL. No tool touches GitHub. No tool knows a platform secret.

## 6. Data model — `supabase/migrations/022_missions.sql`

Missions are `execution_runs` with `kind = 'mission'`, because billing, RLS,
staleness, concurrency and the events table must not fork.

```sql
alter table public.execution_runs
  add column kind text not null default 'verify'
    check (kind in ('verify','mission')),
  add column goal text,
  add column autonomy text not null default 'act'
    check (autonomy in ('plan','act','ship')),
  add column model text,
  add column deadline_at timestamptz,
  add column last_tick_at timestamptz,
  add column commands_count integer not null default 0,
  add column changed_files integer,
  add column diff_bytes integer,
  add column result_changeset_id uuid references public.changesets(id) on delete set null,
  alter column changeset_id drop not null;      -- a mission starts with no diff

-- new terminal states and stages
-- status:     + 'paused', 'stalled'
-- stage:      + 'plan', 'work', 'collect'
-- failure_code: + 'agent_failed', 'budget_exhausted', 'no_changes', 'stalled'

create table public.execution_commands (
  id           bigserial primary key,
  run_id       uuid not null references public.execution_runs(id) on delete cascade,
  owner        uuid not null references auth.users(id) on delete cascade,
  seq          integer not null,
  at           timestamptz not null default now(),
  purpose      text not null,
  command      text not null,
  cwd          text,
  exit_code    integer,
  duration_ms  integer,
  output_tail  text not null default '',
  truncated    boolean not null default false,
  timed_out    boolean not null default false,
  unique (run_id, seq)
);

create table public.mission_messages (
  id      bigserial primary key,
  run_id  uuid not null references public.execution_runs(id) on delete cascade,
  seq     integer not null,
  message jsonb not null,
  unique (run_id, seq)
);
```

- `execution_commands`: owner-select RLS, no client insert (the service role
  writes it). 8 KiB tail per row, 200 rows per mission, enforced in the writer.
- `mission_messages`: RLS enabled with **no policy** — service role only. The
  conversation is not a user-facing artefact; the command ledger is.
- `changeset_id` becoming nullable is a real change to a `not null` column; the
  migration must be idempotent per `bun run check:migrations` (guard with
  `if exists` on the constraint drop, and re-adding it is not needed because the
  column stays nullable for both kinds).
- `execution_runs_one_active_per_owner` already covers missions, because they
  are rows in the same table. No new index, no new race.

## 7. Routes

| Route | Method | Behaviour |
|---|---|---|
| `/api/missions` | `POST` | Auth, chat + repo ownership, reserve Dew, insert `kind='mission'`, seed sandbox, `202 { missionId, ticket }` |
| `/api/missions` | `GET` | The latest mission for `chatId`, with commands, events and `describeMission(row)` |
| `/api/missions/[id]` | `GET` | One mission: row, last 200 commands, last 100 events |
| `/api/missions/[id]/tick` | `POST` | Advance one tick; requires the signed ticket; `409` if terminal, `423` if paused-by-deadline |
| `/api/missions/[id]` | `DELETE` | Cancel: status `cancelled`, settle, destroy sandbox. Idempotent. |
| `/api/missions/[id]/changeset` | `POST` | Collect diff → signed changeset; idempotent by mission id |

`runtime = "nodejs"`, `dynamic = "force-dynamic"`, `maxDuration = 300`,
`cache-control: no-store` on every response.

Every mutation derives the owner from the session — never from the body — and
checks the request's `Origin` against `NEXT_PUBLIC_SITE_URL`. That helper does
not exist yet (no route currently reads `Origin`), so P11-T6 adds
`lib/http/origin.ts` with one function and uses it on all four mutating routes;
forging a mission POST from another origin is a CSRF hole with a bill attached.

## 8. Getting the work back out

Reuse the verify-run collector, with two differences:

1. **Exclusions.** `node_modules`, `.next`, `dist`, `build`, `target`, `vendor`,
   `.venv`, `__pycache__`, and the repo's own `.gitignore` (the throwaway git
   repo reads it). A mission that installs 400 MB of dependencies must not
   produce a 400 MB diff.
2. **Caps unchanged.** 40 files / 400 KB
   (`EXEC_MAX_FILES`, `EXEC_MAX_PATCH_BYTES`). Over the cap →
   `refused: patch_too_large`, with the count and the reason stated on the card.
   A locked lockfile churn is refused, not truncated.

Then, unchanged: `changesets` + `changeset_files` rows, content hash, HMAC
signature, review card, approval, branch, PR. A mission writes
`result_changeset_id` so the review card can link back to the terminal log that
produced it.

## 9. Autonomy levels, and where the human stays

| Level | Commands | File writes | Changeset | PR |
|---|---|---|---|---|
| `plan` | read-only (enforced: no `write_file`, and `run_command` refuses mutating commands? **no** — see below) | no | no | no |
| `act` | any | yes | yes, **needs approval** | on approval |
| `ship` | any | yes | yes, auto-approved **only if** every recorded `checks` command exited 0 | automatic, still on `openmi/agent/*` |

`plan` is the one place a lexical guard is honest, because it is a product
promise rather than a security boundary: `write_file` is not offered as a tool,
and the UI says "planning — the agent will not modify the workspace". It does
not try to detect `rm` inside a shell string; if the model runs it anyway, the
sandbox is destroyed at the end and no changeset is collected. The card says
"plan mode: nothing was collected", which is true.

`ship` is the "whole website is AI driven" path: goal in, PR out, no click. It
is opt-in per mission, it is gated on recorded exit codes, and it is
rate-limited by Dew like everything else. The commit still runs server-side
through the one approval function the product has — mission mode never gains a
new write path.

## 10. Prompt and copy

- New `MISSION_CLAUSE` in `lib/execution/mission/prompt.ts` — the mission
  system prompt is separate, because it must **replace** `NO_EXECUTION_CLAUSE`
  rather than sit beside it. A mission prompt that says both "you cannot run
  anything" and "run commands" is a contradiction, and contradictions are how
  models start narrating work they did not do.
- `lib/prompt.ts` keeps `NO_EXECUTION_CLAUSE` for chat turns and gains a
  sentence: *"A mission can be started from this chat; while it runs, the
  mission's own log is the only evidence of anything running."*
- `SANDBOX_CLAUSE` is rewritten to describe both modes: a sandbox this
  deployment can start, either to verify a diff or to work a goal you name.
- `/about` line 30 ("It runs an install and a build in a sandbox when one is
  configured; it does not run your tests or start a preview server.") becomes a
  true sentence about missions: commands it ran are listed, exit codes are
  recorded, tests are only "run" if a recorded command says so. A test greps
  for the old claim, mirroring the existing P10-T6 rule.
- README gains a "Missions" section with the caps table and the two-mode
  distinction.

## 11. Honesty contract

| Card says | Only when |
|---|---|
| "Running `npm install` (purpose: add a date library)" | an `execution_commands` row with that command and purpose exists, `exit_code` null |
| "`npm install` exited 0 in 12s" | that row has `exit_code = 0`, `ended_at` set |
| "The build failed (exit 1)" | the row's `exit_code ≠ 0`, tail attached |
| "Finished — 3 files changed" | `finish` accepted, `git status` non-empty, `changed_files = 3` |
| "Nothing to change" | `finish` accepted with an empty diff → `no_changes` |
| "Stopped at the 20-minute limit" | `status = 'timed_out'` |
| "Paused" | `last_tick_at` older than 60s, not terminal |
| "Stopped reporting" | `heartbeat_at` stale (`clearStaleRuns` path) |
| "Tests passed" | **never** — there is no test contract in this phase |

`tests/mission.test.ts` asserts each row-to-sentence mapping, the budget
arithmetic, and that a `finish` with an empty diff cannot render as success.

## 12. UI

`components/MissionPanel.tsx`, mounted in the chat workspace beside
`ExecutionPanel`:

- **Composer**: goal textarea (the chat message that starts it becomes the
  goal), repo already pinned by the chat, autonomy radio, minutes selector, the
  Dew reserve shown before the button, a disabled state that names the missing
  key ("`DAYTONA_API_KEY` is not set…") like `ExecutionPanel` already does.
- **Live terminal**: one line per command — purpose, command, spinner, then
  `exit 0 · 12s`, collapsible tail. Auto-scroll only when the user is already at
  the bottom.
- **Header**: elapsed / cap, commands used / 200, Dew so far, Stop.
- **Result**: files changed, the diff (reusing `ReviewPanel`'s rendering), and
  the per-check list with the recorded exit codes.
- **Close the tab** → the next visit shows `paused`, not a spinner.

## 13. Work breakdown

Each task is one PR, branch `phase-11/<task>-<slug>`, and each names its proving
check.

| Task | Work | Acceptance / check |
|---|---|---|
| **P11-T0** | Wire Phase 11 into `OPENMI_BUILD_PHASES.md` (§19, §20, open decisions) and link this doc from the README | The phase index lists P11-T1…T9; no code |
| **P11-T1** | `022_missions.sql`: columns, `execution_commands`, `mission_messages`, status/stage/failure vocabulary, idempotent `changeset_id` relax | `bun run check:migrations` applies twice cleanly; `tests/rls.test.ts` extended for command rows |
| **P11-T2** | `lib/execution/mission/budget.ts` + `cost.ts` additions: caps, clock, stall rule, reserve | `tests/mission.test.ts`: 0 ms costs 0, 61s costs 0.10, cap never exceeds reserve, stall fires on the second empty tick |
| **P11-T3** | `lib/execution/provider.ts` widening: timeout override, background sessions, `readText` offset/limit, `listPaths`; env builder with the scrub test | No secret name reachable from the env builder; a mocked provider asserts the exact command string reaches `executeCommand` |
| **P11-T4** | `mission/tools.ts` + `mission/prompt.ts`: the nine tools, the `finish` verifier, path sanitiser | A tool call with `path: "../../etc/passwd"` is refused before any filesystem call; `finish` with an unrun `checks` entry is refused with the reason |
| **P11-T5** | `mission/loop.ts` + `state.ts`: tick, message persistence, deterministic compaction, ticket | A 3-tick simulated mission keeps its message log under budget and its ledger complete; a replay with a stale ticket is refused |
| **P11-T6** | Routes: create / get / tick / cancel / changeset, plus `lib/http/origin.ts` | Signed-out `401`; foreign owner `404`; foreign `Origin` `403`; second active mission `409`; cancel settles once (existing idempotency test extended) |
| **P11-T7** | `mission/collect.ts`: diff collection with exclusions and caps → signed changeset → `result_changeset_id` | A mission's changeset verifies through the existing approval path in `tests/changesets.test.ts`; over-cap produces `patch_too_large`, not a truncated diff |
| **P11-T8** | `components/MissionPanel.tsx` + workspace mount + `/about` + README copy | The panel renders a paused mission as paused; `tests/context.test.ts` and a copy test hold the new clauses |
| **P11-T9** | Optional, **not built**: `execution/Dockerfile` + a dedicated mission snapshot with node/bun/python/go/build-essential preinstalled | A mission on the snapshot installs nothing before its first build; cold start measured and recorded |

Checks after every task, unchanged from the README:
`bun run typecheck && bun run test && bun run check:migrations`, plus
`NEXT_PUBLIC_SITE_URL=https://ci.invalid bun run build` before the phase gate.

## 14. Tests to add / change

- `tests/mission.test.ts` (new): budget arithmetic, stall detection, `finish`
  gating, claimed-vs-recorded checks, command tail caps, sentence mapping.
- `tests/mission-tools.test.ts` (new): path traversal, missing `purpose`,
  command string passthrough (asserting it is **not** rewritten), env scrub.
- `tests/rls.test.ts` (extend): an owner reads their commands, another account
  reads nothing, `anon` reads nothing, no client can insert a command.
- `tests/context.test.ts` (extend): a chat turn still contains
  `NO_EXECUTION_CLAUSE`; a mission prompt contains none of it and does contain
  the tool contract.
- `tests/execution.test.ts` (extend): verify runs still refuse a model-supplied
  command — the no-shell test stays exactly as strong for the verify path.

## 15. Risks, ranked

1. **Compute abuse.** Open egress + a shell is a mining rig or a scanner for 20
   minutes. Mitigations: Dew reserve, one active mission, global concurrency
   cap, TTL, verified-email accounts, and an abuse report path. Accepted
   residual risk, stated in the terms page.
2. **Cost runaway through model loops.** 200 commands × 32 KiB tails is a lot of
   tokens. Mitigation: `MISSION_MAX_TOKENS`, step cap, stall detection,
   12-message verbatim window.
3. **Prompt injection now has a shell.** The blast radius is the sandbox: no
   secrets, no remote, no platform network, destroyed on exit. This is the
   design's whole justification and must be re-verified whenever a new tool is
   added.
4. **Vercel function ceiling.** Ticks are capped at 240s inside a 300s
   `maxDuration`; the mission clock lives in Postgres, not in the function.
   A tick that dies leaves `last_tick_at` behind, which the UI reads as paused.
5. **Diff size.** 40 files / 400 KB. A mission that rewrites a lockfile is
   refused with a reason, which is a worse experience than a bigger cap and a
   much better one than a corrupted patch.
6. **Daytona org tier.** Restricted orgs override network policy per sandbox;
   a mission that needs `apt-get` may be blocked. The first failed command's
   tail names the blocked host, and the card says so rather than guessing.
7. **Model quality.** An agent that wanders is expensive. Mitigation: the goal
   is restated in every tick's system prompt, `finish` is a tool rather than an
   inference, and the plan-mode level exists for goals that are really
   questions.

## 16. Rollout and kill switch

- Missions are the default for a chat with a repository; `DAYTONA_API_KEY`
  (plus `EXECUTION_ENABLED=off` as the kill switch) is the only switch. The
  plan originally put them behind `MISSION_MODE_ENABLED` (new env, off unless explicitly `on`) gating the
  composer and the routes. `EXECUTION_ENABLED=off` still kills everything.
- Week 1: admin allowlist only (`lib/admin/allowlist.ts` already exists), cap
  10 minutes, `act` only.
- Week 2: all accounts, 20 minutes, `plan`/`act`/`ship`.
- Rollback is the sandbox key: with `DAYTONA_API_KEY` unset, `/api/missions/*`
  returns `503` with the same "not configured" sentence and no sandbox is ever
  created. Existing verify runs are untouched.

## 17. Open decisions for the owner

| ID | Question | Recommendation |
|---|---|---|
| **D11.1** | Does "full access" include `sudo` and package installation? | Yes. It is the difference between an agent and a code-completion box. |
| **D11.2** | 20 minutes default, or 10 to start? | 10 for the allowlist week, 20 after; the reserve follows the cap. |
| **D11.3** | Does closing the tab pause a mission, or should it continue server-side? | Pause. Continuing needs a queue/worker the stack does not have, and a background agent bills a user who is not watching. |
| **D11.4** | Should `ship` exist in v1, or only `plan`/`act`? | Ship in v1, gated on recorded exit 0 — it is the request's headline behaviour. |
| **D11.5** | Is a preview URL (a port from the sandbox) in scope? | Not in v1. It needs a signed proxy and its own abuse story; the agent can `curl` its own dev server to verify. |
| **D11.6** | Do missions share the verification snapshot, or get their own richer image? | Own image (P11-T9), but land it after T1–T8 so the loop ships on `daytona-medium`. |
