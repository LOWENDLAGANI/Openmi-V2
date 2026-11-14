# Web agent runs

A run is the server-owned agent. The browser sends a prompt, receives an event
stream, and renders. It never executes tool work, never holds the loop, and
never owns the transcript.

This is the implementation of the "Web Agent — Finalized Build Plan" in this
repository. It reuses the existing base — Supabase auth/RLS, the provider
adapter, the E2B sandbox provider, Dew and the rate limiter — and replaces the
in-request chat turn as the place agent work happens.

```
Browser
  ├─ POST /api/runs              → queue a run, 202 + runId
  ├─ GET  /api/runs/:id/stream   → SSE, replayable from Last-Event-ID
  ├─ GET  /api/runs/:id          → snapshot (run, messages, steps, tools, diff)
  └─ POST /api/runs/:id/cancel   → set the cancel flag
                    │
             Next.js routes (auth, RLS, quota, rate limit)
                    │
               Postgres: runs, run_events, run_steps, run_messages,
                         run_tool_calls, run_artifacts, run_usage_daily
                    │
             worker process (bun run worker; no public route)
                    ├─ agent loop (provider adapter, six tools)
                    ├─ one E2B sandbox per run (/home/user/work)
                    └─ artifacts → object storage, events → Postgres
```

## What moved

| Concern | Before | Now |
|---|---|---|
| Loop owner | `app/api/chat/route.ts`, inside the request | `lib/runs/loop.ts`, in the worker |
| Progress | SSE built from in-memory state | append-only `run_events`, replayed on reload |
| Cancellation | provider abort flag on a turn row | `runs.cancel_requested`, read at step boundaries |
| Workspace | chat sandbox / GitHub-only turn | one sandbox per run, paused when it settles, destroyed after 48 h |
| Budget | Dew hour + turn caps | plus per-account concurrent, daily-run and daily-token caps |
| Output | changeset rows | diff + files as artifacts, reviewed in the UI |

The chat surface still exists and still works; `/agent` is the run surface.

## Phase map

| Plan phase | Where it lives |
|---|---|
| 0 Audit | This doc and the schema: `supabase/migrations/043_agent_runs.sql` |
| 1 Run skeleton | `app/api/runs/**`, `lib/runs/store.ts`, `lib/runs/worker.ts`, `worker/main.ts`, `components/RunView.tsx` |
| 2 Real loop | `lib/runs/loop.ts`, `lib/runs/tools.ts`, `lib/runs/sandbox.ts`, `lib/runs/prompt.ts` |
| 3 Streaming/UX | `lib/runs/events.ts`, `app/api/runs/[id]/stream/route.ts`, `components/RunView.tsx` |
| 4 Context/cost | `lib/runs/limits.ts` (compaction, budgets, cost), `lib/runs/prompt.ts`, `run_usage_daily` |
| 5 Evals | Not built (see below) |
| 6 Hardening | `lib/runs/redact.ts`, egress guard in `lib/runs/tools.ts`, `lib/execution/provider.ts` (`RUN_EGRESS_DENY`), orphan sweep, `app/api/cron/run-sweep` |

## Data model

Plan name → table:

- `runs` → `runs` (status, stop_reason, timestamps, tokens, cost, sandbox id,
  heartbeat, cancel flag, `last_event_seq`)
- `steps` → `run_steps` (per-step hashes, tokens, finish reason, tool names)
- `messages` → `run_messages` (`content_json`, tags)
- `tool_calls` → `run_tool_calls` (args and full result, per step)
- `artifacts` → `run_artifacts` (path, kind, storage key, bytes, sha256)
- `usage_daily` → `run_usage_daily` (per account per UTC day)

`runs.status` is the only source of truth: `queued | running | done | failed |
cancelled | blocked`. Every read is scoped by `auth.uid() = owner` through RLS;
every write is service-role only. The browser has no INSERT/UPDATE policy and no
execute grant on a mutating function.

## Lifecycle

1. `POST /api/runs`: same-origin, session, rate limit, provider configured,
   chat read through the reader's client, quota read from `run_quota`, row
   inserted as `queued`. 202. No provider call, no sandbox.
2. Worker claims with `select … for update skip locked` inside `claim_next_run`
   (`running`, `started_at`, `heartbeat_at`, `worker_id`).
3. Sandbox created, repository seeded at the pinned commit (or an empty git
   workspace), prompt built from the tree and the repository's own instruction
   files.
4. Each iteration: `begin_run_step` (compare-and-set, refuses a cancelled run),
   model call with streaming deltas, tool calls, persisted step and tool rows,
   `usage` event, then the next iteration.
5. Settle: artifacts collected, `runs` updated, usage recorded once, terminal
   event appended, sandbox paused in `finally` (compute released, disk kept).
   The sweep destroys it 48 hours later — `RUN_SANDBOX_TTL_HOURS`.

Cancellation is a flag checked before each step and before each tool call. A
tool in flight is allowed to finish: a half-applied edit is worse than a slow
cancel.

A run whose heartbeat stops is marked failed by `reapStaleRuns`, called on
worker start and from `GET /api/cron/run-sweep` with `CRON_SECRET`. The same
sweep reconciles sandboxes: a box with no row is destroyed as an orphan, a live
run's box is kept, and a settled run's box is kept until its 48-hour window
closes.

## Event protocol

`run.started`, `message.delta`, `message.done`, `tool.started`, `tool.finished`,
`usage`, `warning`, `preview.ready`, `run.finished`, `run.error`.

- SSE over `fetch` with a manual reader, not `EventSource`.
- `id:` on every frame, so `Last-Event-ID` replays exactly what was missed.
- A `: keep-alive` comment every 15 s; the stream closes after ten minutes and
  the client reconnects from its cursor.
- Tool results reach the client as previews; the full text is in the snapshot.
- Chain-of-thought is never streamed. `RunView` shows tool summaries.

`preview.ready` is defined for compatibility but not emitted: it would need a
dev server kept running inside the box and a signed proxy in front of it. The
paused workspace is retained but not served.

## Limits

| Limit | Value | Where |
|---|---|---|
| Steps per run | 40 | `RUN_MAX_STEPS` |
| Tokens per run (estimate) | 120,000 | `RUN_MAX_TOKENS` |
| Wall clock | 15 min (`RUN_MAX_MINUTES`) | `runWallClockMs` |
| Concurrent runs per account | 1 | `RUN_MAX_CONCURRENT` + unique index |
| Runs per account per UTC day | 20 | `RUN_DAILY_RUNS` |
| Tokens per account per UTC day | 400,000 | `RUN_DAILY_TOKENS` |
| Run requests per minute | 6 | `RATE_LIMITS.run` |
| Compaction | 0.8 × 128k context | `RUN_COMPACT_AT` |
| Sandbox pause | 15 min (`RUN_SANDBOX_IDLE_MINUTES`) | `runSandboxIdleMinutes` |
| Sandbox destroy | 48 h after the run settles (`RUN_SANDBOX_TTL_HOURS`) | `runSandboxExpired` |
| Files / file size / diff | 40 / 200 KB / 400 KB | `lib/runs/limits.ts` |

Every number is a named constant and `tests/runs.test.ts` reads it.

## Sandbox

One box per run, from `EXECUTION_TEMPLATE`, `onTimeout: pause`, no credential,
no docker socket. Tools see paths relative to the workspace root.

The workspace outlives the run, on purpose. At 15 minutes — the run's own
ceiling — the provider pauses the box (`RUN_SANDBOX_IDLE_MINUTES`), and the
worker pauses it again the moment the run settles. Compute stops billing and
the disk keeps the installed packages and the edits. The box is destroyed 48
hours after the run ended (`RUN_SANDBOX_TTL_HOURS`), the same contract a chat
workspace has. Nothing reattaches to it in this build; retaining it is what
makes a resume cheap when that lands, and it is why a crashed worker leaves a
paused workspace rather than a running box.

- The plan says `/work`. E2B's user can only write under `/home/user`, so the
  workspace is **`/home/user/work`**. The tool layer only ever sees relative
  paths; the absolute root is provider detail.
- CPU, memory and pid limits come from the template, not from the create call.
  A production template should bake `--cpus 2`, `--memory 2g` and a pid ceiling
  into the image. E2B applies image limits, so `EXECUTION_TEMPLATE` is the
  control.
- Egress: `allowOut: ['*']` with `denyOut` = `RUN_EGRESS_DENY` (loopback,
  RFC1918, link-local incl. `169.254.169.254`, CGNAT, IPv6 equivalents). The
  provider evaluates allow before deny, so the run's `run_command` also refuses
  commands that name an internal address, `/proc/*/environ` or a unix socket.
  This is defence in depth, and it must be verified against a real sandbox
  before launch (see below).
- No provider key, no Supabase key, no GitHub token and no artifact credential
  is ever placed in the sandbox environment or on a command line. The GitHub
  token is used once by the worker to fetch a tarball; the box gets the code and
  a credential-free `origin` with `push.default nothing`.

## Running it

```bash
supabase db push          # applies 043_agent_runs.sql
bun run worker            # one long-lived process, no public route
bun run dev              # the app; /agent is the run surface
```

The worker needs `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`GITHUB_TOKEN_KEY` and at least one provider key. It does not need
`NEXT_PUBLIC_*` for the provider — that is the point.

Artifacts go to `RUN_ARTIFACT_DIR` (single host) or an S3-compatible bucket
(`RUN_ARTIFACTS_BUCKET`, `RUN_ARTIFACTS_ENDPOINT`, `RUN_ARTIFACTS_*` keys).
A worker on another machine needs the bucket; a local directory on the worker is
not readable by the web app.

Vercel does not run workers. Run the worker on a small VM or a container with a
restart policy. `vercel.json` still schedules only the sandbox sweep (a Hobby
plan allows one daily cron), so the run sweep is called on worker start and can
be pointed at by any external scheduler with the same bearer header. Without a
worker, runs wait in `queued` exactly as the row says.

## Deploying the worker on Render

The repository ships `Dockerfile.worker` and `render.yaml` for this. The
Blueprint uses a **Web Service on the free plan**, because that is the instance
type Render gives away: the worker binds to `$PORT` and answers
`GET /healthz`, and keeps polling the queue behind that health route. It is
still not a product server — `/healthz` is the only route, and it returns
counters, never run content. A paid **Background Worker** also works with the
same image and needs no port at all.

1. **Apply the migration first.** `supabase link --project-ref <ref> && supabase db push`.
   The worker claims runs through `claim_next_run`; without 043 applied it
   cannot claim anything.
2. **Push this repository to GitHub.** Render builds from a Git repo.
3. **Create the service.** Render Dashboard → **New +** → **Blueprint**, point
   it at the repository (it reads `render.yaml` and creates the free Web
   Service with `healthCheckPath: /healthz`). Or manually: **New +** → **Web
   Service**, Language **Docker**, Dockerfile Path `Dockerfile.worker`, Docker
   Context `.`, plan **Free**, health check path `/healthz`.
4. **Set the environment variables.** The Blueprint lists them; values marked
   `sync: false` are prompts, so secrets are entered in the dashboard and never
   in Git. Required: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `GITHUB_TOKEN_KEY`, one provider key, `E2B_API_KEY`. Set the five
   `RUN_ARTIFACTS_*` values too — see step 5.
5. **Set the artifact bucket.** Required on Render: the worker's disk is
   ephemeral and the web app runs on a different host, so `RUN_ARTIFACT_DIR`
   would be unreadable. Use `RUN_ARTIFACTS_BUCKET` + `RUN_ARTIFACTS_ENDPOINT` +
   `RUN_ARTIFACTS_ACCESS_KEY_ID` + `RUN_ARTIFACTS_SECRET_ACCESS_KEY` (and
   `RUN_ARTIFACTS_REGION=auto` for R2). Uploads are SigV4-signed by
   `lib/runs/artifacts.ts`; no SDK is involved.
6. **Deploy and read the first log lines.** A healthy start prints
   `[runs] worker <id> starting, concurrency <n>`. Any configuration problem is
   named on its own line, never with a key value.
7. **Prove it end to end.** Queue one run from `/agent` on the deployed web app.
   The Render log shows `[runs] claimed <runId>` then `[runs] finished <runId>:
   done`, and the run page streams events as they arrive. Close the tab
   mid-run; the log still reaches `finished` and a reload replays the log.

**Free-plan behaviour, plainly.** A free Web Service sleeps after 15 minutes
without inbound traffic, so while it sleeps no run is claimed — queued runs wait
and execute on the next wake. Keep it awake with an external pinger every five
minutes (UptimeRobot, cron-job.org) pointed at `/healthz` if runs should start
immediately. A deploy or a spin-down also sends `SIGTERM`: the worker pauses the
sandbox and lets the current run finish inside the grace period; a run killed by
that window is settled as failed by the reaper, while its workspace stays paused
for the rest of the 48 hours.

Operations that matter on Render:

- **A deploy stops the worker.** Render sends `SIGTERM` and waits
  `maxShutdownDelaySeconds` (300 in the Blueprint; free instances may use a
  shorter grace period). The worker stops claiming and waits for in-flight runs.
  A run killed by that window is marked failed by the reaper once its heartbeat
  goes stale; its sandbox stays paused, and the 48-hour clock still decides when
  it is destroyed.
- **Scaling out is more instances.** Claiming uses `for update skip locked`, so
  two workers never take the same run. Set `RUN_WORKER_CONCURRENCY` down if the
  instance is small.
- **The reconciliation route is not scheduled by Vercel** (a Hobby plan allows
  one daily cron, already used by the sandbox sweep). The worker sweeps on start;
  point any scheduler at `GET /api/cron/run-sweep` with
  `Authorization: Bearer $CRON_SECRET` on the web app for a periodic sweep.
- **The image contains only the worker graph** (`worker/`, `lib/`, the
  lockfile, `tsconfig.json`). The Next app is not in it: agent work does not run
  beside the web server.

What has and has not been verified for this path: the entry point, the import
conditions and the file layout were checked by reproducing the image's contents
and running `worker/main.ts`; the Docker build itself was **not** run here
(the local Docker socket is not accessible to this workspace), so the first
Render build is the first real one.

## Security posture

- Every query is scoped by the authenticated user id; "not yours" and "not
  found" are the same 404.
- Same-origin required on `POST /api/runs` and the cancel route.
- No secret in the browser bundle or the sandbox; `redactSecrets` strips
  token-shaped strings from tool output before it is persisted or streamed.
- The worker logs run ids and statuses, never prompts.
- Provider keys live in the worker's environment only.

## Verification status

Checked here, without credentials: `bun run typecheck`, `bun run test`,
`bun run check:migrations` (043 applies and a second pass is a no-op), and the
run unit tests (quota, compaction, event frames, redaction, path safety, egress
guard).

Not verified here, and required before launch:

- a real run end-to-end against an E2B key (create → seed → install → edit →
  diff → pause), including a worker crash mid-run, the reaper, and the 48-hour
  sweep actually destroying the box;
- the worker's `/healthz` route and Render's health check on a real deploy;
- two accounts, to confirm one cannot read another's run through RLS on the new
  tables;
- the provider's actual `denyOut` behaviour from inside a sandbox
  (`curl 169.254.169.254`, `curl 10.0.0.1`, `curl localhost` must all fail);
- an S3/R2 PUT/GET with real credentials;
- a load test with N concurrent runs across accounts (queue starvation).

## Not built in this pass

- The eval harness (25 fixture tasks + `check.sh` runner) from Phase 5.
- Per-run preview URLs (`preview.ready` is reserved).
- A local Docker sandbox; E2B is the only provider behind `lib/execution/provider.ts`.
- Multi-agent, plan mode, collaborative editing, model marketplace — deliberately
  out of scope, per the plan.
