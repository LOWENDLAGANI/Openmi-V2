# E2B sandbox — readiness and activation

**Status: implemented, switched off by configuration.** Nothing was deleted from
the E2B path: the provider client, the three callers, the chat workspace
lifecycle, the setup probe and their tests are all in the tree. A deployment
gets the sandbox back by setting two environment variables and, for this
repository, pointing `EXECUTION_TEMPLATE` at an image that has bun.

This document is the checklist. It records what is wired, what each switch does,
the one template problem this repo has, and how to verify a run without claiming
more than was observed.

---

## 1. The two switches

| Variable | Read by | Default | Effect |
|---|---|---|---|
| `E2B_API_KEY` | `executionConfigured()` | unset | No key, no sandbox anywhere. The review card and the setup probe say execution is not configured. |
| `EXECUTION_ENABLED` | `executionConfigured()` | on | Set to `off`/`false`/`0` to stop every sandbox without removing the key. |
| `OPENMI_SANDBOX_TURNS` | `sandboxTurnsEnabled()` | **off** | On gives an eligible chat turn the Linux shell, the shell tools and the browser tool. Off is GitHub-only. |

The chat turn's shell exists only when **all** of these hold
(`app/api/chat/route.ts`):

```text
sandboxTurnsEnabled() && executionConfigured()
  && repository pinned && commit sha present && GitHub token present
```

Verification runs and missions do **not** read `OPENMI_SANDBOX_TURNS`. They need
`executionConfigured()` only, which is why they can work while chat is
GitHub-only.

There is no third gate and no per-user allowlist. A user with a repository
pinned and an hour of Dew gets the shell the moment both switches are on.

## 2. What is wired

| Piece | File | Reachable from |
|---|---|---|
| Provider client (create, attach, pause, kill, exec, files) | `lib/execution/provider.ts` | the three callers below |
| Verification run (seed → apply → install → build) | `lib/execution/run.ts`, `app/api/execution/runs/*` | review card, `ExecutionPanel` |
| Missions (goal → commands → diff) | `lib/execution/mission/*`, `app/api/missions/*` | mission routes |
| Chat workspace (one per chat, paused when idle) | `lib/agent/sandbox.ts`, `lib/execution/chat-env/*` | chat turn tool calls |
| Sweep (idle stop, 48 h wipe, orphan cleanup) | `app/api/cron/sandbox-sweep` | `vercel.json` cron, bearer `CRON_SECRET` |
| Setup probe (key present, no sandbox created) | `lib/setup/probes.ts` | admin → Configuration & probes |

The sandbox holds no GitHub token, no provider key and no push credential. It
has no git remote. Work leaves it as a diff the user reviews.

## 3. The template problem in this repository

`detectCommands()` reads the lockfile and this repository has `bun.lock`, so the
install step is:

```text
bun install --frozen-lockfile
```

`DEFAULT_TEMPLATE` is E2B's `base`, which carries **node, npm and git but not
bun**. A verification run or a chat `run_command` that installs will therefore
fail on this repository with `bun: not found` until one of these is true:

1. **Custom template (recommended).** Build an E2B template from a Dockerfile
   that installs bun, then set `EXECUTION_TEMPLATE` to its name. Shape:

   ```dockerfile
   FROM e2bdev/base
   USER root
   RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash
   USER user
   ENV PATH="/usr/local/bin:${PATH}"
   ```

   Build it with the E2B CLI (`e2b template build --name openmi-bun`), then set
   `EXECUTION_TEMPLATE=openmi-bun`. The image must keep the `user` account and
   `/home/user` as the writable home, because the file API writes there.

2. **Install bun per command.** Leave the template at `base` and have the model
   run `curl -fsSL https://bun.sh/install | bash` before installing. This works
   because egress is `restricted` (any host by name), but it spends a command and
   a minute of sandbox time on every fresh box, and a paused chat workspace keeps
   the install only until the 48-hour wipe.

Do not switch `EXEC_NETWORK_MODE=off` and expect either to work: with no network
no install can run at all.

## 4. Runtime ceilings

| Ceiling | Value | Constant / source |
|---|---|---|
| One command (verification step) | 180 s | `EXEC_STEP_TIMEOUT_MS` |
| One command (mission, foreground) | 120 s | `MISSION_FOREGROUND_MS` |
| Background process (mission) | 300 s | `MISSION_BACKGROUND_MS` |
| Sandbox lifetime, free-tier key | 3,600 s | `EXEC_FREE_TIER_TIMEOUT_SECONDS` |
| Sandbox lifetime, paid key | 86,400 s | `EXEC_MAX_TIMEOUT_SECONDS` |
| Chat idle before pause | 5 min (1–60) | `CHAT_SANDBOX_IDLE_MINUTES` |
| Chat wiped after inactivity | 48 h (1–168) | `CHAT_SANDBOX_TTL_HOURS` |
| Live chat boxes per account | 3 (1–10) | `CHAT_SANDBOX_MAX_PER_OWNER` |
| Mission length | 20 min default, 1–30 | `EXEC_MISSION_MINUTES` |

A free-tier key accepts one hour, so `createChatSandbox` retries once at the
free ceiling instead of leaving chat workspaces unusable.

## 5. Cost

- Verification run: **0.5 Dew reserved** before the box starts, settled at
  **0.05 Dew per started minute**, unused reservation refunded through the ledger.
- Mission: **0.05 Dew per started minute**, reserve = minutes × 0.05, refused
  before start when the balance cannot cover it.
- Chat turns: the hourly chat price, not sandbox time.

A run that cannot start is refused before it costs anything.

## 6. Activate

In Vercel → Project → Settings → Environment Variables, for **Preview** and
**Production** separately:

```text
E2B_API_KEY=<team key from the E2B dashboard, scoped to sandboxes>
OPENMI_SANDBOX_TURNS=on          # chat turns get the shell
EXECUTION_TEMPLATE=openmi-bun    # required for this repo's bun install
EXECUTION_ENABLED=on             # or omit; "off" is the kill switch
CRON_SECRET=<long random value>  # the 48-hour sweep refuses without it
```

Then redeploy. Environment changes are read at request time for the gates, but a
deployment is still the cleanest way to be sure every instance sees them.

Local check without a browser:

```bash
bun run typecheck
bun test tests/sandbox-activation.test.ts tests/execution.test.ts tests/agent-shell.test.ts
```

## 7. Verify on a live deployment

1. Admin → **Configuration & probes** → `Sandbox verification` must be green. It
   reads key presence and does not create a sandbox, so green means "configured",
   not "working".
2. Open a chat with a repository pinned, ask it to run `bun --version` with
   `OPENMI_SANDBOX_TURNS=on`. Expect an exit code and Bun's version in the step
   row. That is the first real proof the box booted.
3. Ask for `bun install --frozen-lockfile`. On the default `base` template this
   is where `bun: not found` appears; with `openmi-bun` it should exit 0.
4. Check `/activity`: the hour is the chat charge; sandbox minutes appear only
   for verification runs and missions.
5. For a mission, confirm the card reports the commands that actually ran, and
   that `finish` refuses a check whose record is missing.

## 8. Rollback, in order of blast radius

| Switch | Stops | Keeps |
|---|---|---|
| `EXECUTION_ENABLED=off` | every sandbox (runs, missions, chat) | the key, all rows |
| `OPENMI_SANDBOX_TURNS=off` | chat turns only | verification runs and missions |
| `CHAT_SANDBOX_ENABLED=off` | chat workspaces; each message gets a fresh box | everything else |
| Remove `E2B_API_KEY` | everything, including the setup probe's green row | nothing to clean up |

Deleting a chat stops its workspace and queues the disk for deletion; a restore
reseeds at the pinned commit. The sweep at `/api/cron/sandbox-sweep` is
reconciliation, not the primary clock — the provider's own timers still end a box
between runs.

## 9. Failure modes the code already names

| Failure | Meaning | Where it surfaces |
|---|---|---|
| `not_configured` | key missing or rejected (401/403) | "Execution is not configured on this deployment." |
| `quota` | 429/503, plan or concurrency limit | card says the sandbox could not start |
| `missing` | 404/410 while attaching: the box is gone | chat reseeds at the pinned commit |
| `refused` | anything else from the provider | the provider's own message |
| timed out | command hit its ceiling | exit 124 and `(timed out)` |

## 10. What this document did not verify

- No sandbox was created: there is no `E2B_API_KEY` in this workspace, and none
  was requested. Every claim above is read from the code, not from a live run.
- The `openmi-bun` template is described, not built. Building it needs an E2B
  account and CLI.
- `base`'s contents are as documented in `lib/execution/commands.ts`; the
  `bun: not found` consequence is derived from this repository's `bun.lock`.
