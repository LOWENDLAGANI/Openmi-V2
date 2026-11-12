# Build plan — preview, checkpoints, scaffolding, publish

**Companion to** [OPENMI_APP_BUILDER_PLAN.md](OPENMI_APP_BUILDER_PLAN.md), which
records what Lovable and Freebuff do and why these four features close the gap.
This document is the executable half: decisions that need a signature, tasks
with files and acceptance tests, and the order they land in.

**Rules this plan inherits** (do not relax them):

- Every sentence on a card must be reachable from a real observation.
- One write path to GitHub: the changeset → branch → PR → merge code.
- Sandbox holds no token, no provider key, no push credential.
- A new limit is a named constant with a test that reads it.
- A new table gets RLS enabled in the migration that creates it.

---

## 0. Decisions that block code

| ID | Decision | Options | Recommendation | Blocks |
|---|---|---|---|---|
| **D1** | How is a preview exposed? | **A** E2B public host; **B** wildcard subdomain proxy; **C** path-prefix proxy | **B** for private previews, with **A** as an explicitly-labelled temporary link | T1.3, T1.4 |
| **D2** | What does a warm preview cost? | per started minute; included in the hour; free for N minutes | per started minute at `PREVIEW_DEW_PER_MINUTE = 0.05`, same as sandbox time, capped per chat per day | T1.5 |
| **D3** | Do templates create repositories? | yes; no, existing repos only | yes, but only after D1 ships — it is a product bet, not a technical one | P3 |
| **D4** | What does Publish deploy? | Vercel project deploy of the branch; static export to object storage | Vercel deploy of the merged branch, reported from the API response | P4 |
| **D5** | Does the workspace follow the branch? | poll every 30 s; webhook; manual pull | poll on open + manual pull, fast-forward only when the workspace is clean | P5 |

If D1 is not signed, do not start T1.3 — a preview URL is a security decision, not
a UI choice.

---

## 1. The exposure decision (D1), spelled out

E2B gives every sandbox a public host per port: `sandbox.getHost(3000)` returns
`https://3000-<sandbox-id>.e2b.app`. By default **anyone with that URL reaches the
service**, and the provider's own docs say to treat it as a credential.
`allowPublicTraffic: false` makes requests require an `e2b-traffic-access-token`
header, which a browser cannot attach inside an iframe.

| Option | How it works | Pros | Cons |
|---|---|---|---|
| **A. Public E2B host** | put the host in an iframe | one afternoon | anyone with the link runs code in the user's box; links leak through chat, logs, screenshots |
| **B. Wildcard subdomain proxy** | `p-<chat>.preview.<domain>` → middleware rewrites to `/api/preview/<chat>/…`, server adds the traffic token | private, no token in the browser, keeps cookies and `_next` absolute paths working | needs a wildcard DNS record and wildcard TLS (Vercel domain + `*.preview.example.com`) |
| **C. Path-prefix proxy** | `/api/preview/<chat>/…` with HTML rewriting | no DNS work | Next and Vite request `/_next/...` and `/@vite/...` from the origin root; rewriting is brittle and breaks HMR |

**Recommendation:** ship **A** behind a warning and a 30-minute lifetime, then
move to **B** before anyone treats a preview as private. A preview that is
silently public is the kind of claim this product exists not to make.

The proxy for **B** is the same code as **C**; only the URL construction differs,
so build the proxy once and switch how it is addressed.

---

## 2. Phase P13 — live preview

**Outcome:** a chat can start its app, show it beside the transcript, and stop it.
Nothing about editing changes.

### T1.1 Provider exposes a port

- **Files:** `lib/execution/provider.ts`
- Add `host(port: number): string` to `SandboxHandle`, backed by
  `sandbox.getHost(port)`.
- Capture `sandbox.trafficAccessToken` on the handle when the box was created
  with restricted traffic.
- Add `allowPublicTraffic?: boolean` to `ChatSandboxOptions` and pass it through
  `Sandbox.create`; default **false** for new chat boxes once D1=B, true while
  D1=A.
- **Acceptance:** a unit test with a stubbed `Sandbox` asserts `host(3000)`
  returns the SDK value and that `allowPublicTraffic` reaches `create`.
- **Est:** S.

### T1.2 Dev-server manager

- **Files:** `lib/agent/shell.ts` (commands), `lib/execution/dev-server.ts` (new)
- Detect the dev command from `package.json` scripts + lockfile, reusing the
  detection style in `lib/execution/commands.ts`:
  `next dev` → 3000, `vite` → 5173, `npm start` → 3000, fallback 3000.
- Named constants: `PREVIEW_DEFAULT_PORT`, `PREVIEW_READY_TIMEOUT_MS = 90_000`,
  `PREVIEW_POLL_MS = 1_000`, `PREVIEW_MAX_LOG_LINES = 200`.
- Start with the existing background-process pattern (`startProcessCommand`),
  log to `/tmp/openmi-chat` so it never appears in a diff, and poll the port
  with `curl -fsS -o /dev/null -w '%{http_code}'` until 2xx/3xx.
- **Acceptance:** a pure test covers command/port detection for Next, Vite and an
  unknown `package.json`; an integration test (skipped without a key) starts a
  server and reports ready.
- **Est:** M.

### T1.3 Preview routes

- **Files:** `app/api/preview/[chatId]/status/route.ts`,
  `app/api/preview/[chatId]/start/route.ts`,
  `app/api/preview/[chatId]/stop/route.ts`,
  `app/api/preview/[chatId]/[...path]/route.ts` (D1=B/C)
- Owner check first: `getSession()` → chat owner → row; a mismatched owner is
  `404`, not `403`, so the route does not confirm a chat exists.
- Status returns `{ state: "stopped" | "starting" | "ready" | "failed",
  port, url, startedAt, logTail }` and never returns the traffic token.
- Proxy: stream the upstream response through, forward method/headers/body,
  strip hop-by-hop headers, add the traffic token server-side.
- **Acceptance:** signed-out → 401; another account's chat → 404; a ready chat
  returns HTML with the iframe URL; the token string appears in no response
  (asserted by grepping the JSON).
- **Est:** M.

### T1.4 Preview panel

- **Files:** `components/PreviewPanel.tsx`, `app/chat/page.tsx`
- A tab beside the transcript, not a replacement: **Chat | Preview**.
- States: stopped (button + reason), starting (elapsed time), ready (iframe,
  reload, open externally, viewport presets), failed (log tail + the detected
  command so the reader can see what ran).
- Poll status every 2 s while starting, then stop polling.
- **Acceptance:** the panel never shows a "running" state that the status route
  did not return; a failed start shows the last 200 log lines.
- **Est:** M.

### T1.5 Pricing and idle stop

- **Files:** `lib/execution/dev-server.ts`, `lib/dew.ts` or a new
  `lib/execution/preview-cost.ts`, `supabase/migrations/033_chat_previews.sql`
- `chat_previews` (service-role only, one row per chat):
  `chat_id` (unique), `owner`, `sandbox_id`, `port`, `command`, `state`
  (`starting|ready|stopped|failed`), `started_at`, `last_hit_at`,
  `failure_detail`, timestamps.
- `PREVIEW_DEW_PER_MINUTE = 0.05` and `PREVIEW_MAX_MINUTES_PER_CHAT = 60`.
- Charge per started minute through the existing ledger; stop the server and
  release the lease at the cap with a visible reason.
- **Acceptance:** migration applies twice; the ledger sums to the balance after a
  preview session (the existing invariant test extended); a stopped preview
  stops billing in the next minute tick.
- **Est:** M.
- **Status:** the cap, the idle stop and the visible reason shipped without the
  charge (`035_preview_limits.sql`). Per-minute Dew waits for D2 to be signed,
  because it is a price, not an implementation detail.

### T1.6 Kill switch and rollback

- `OPENMI_PREVIEW` is on only where a sandbox provider is configured; an
  explicit `off` removes the surface (no panel, routes 404). Shipping it on is
  deliberate: a hidden preview cannot be reviewed. The kill switch is one
  variable, and turning execution off takes the preview with it.
- Rollback: set `off`; running previews are stopped by the existing sweep, which
  gains a "stop dev servers on idle" step.
- **Est:** S.

**Phase gate:** a chat starts `next dev`, the panel renders the app, a
signed-out request to the preview is refused, `/activity` shows the preview
minutes, and turning `OPENMI_PREVIEW=off` removes the surface without touching
the transcript.

---

## 3. Phase P14 — checkpoints

**Outcome:** each turn that changed files can be restored, and the transcript says
which version is live.

- **Migration 034:** `sandbox_checkpoints` (service-role only):
  `id`, `chat_id`, `owner`, `sandbox_id`, `commit_sha`, `label`, `turn_id`,
  `files_changed`, `created_at`, unique `(chat_id, commit_sha)`.
- **Write:** after a turn settles with edits, run `git add -A && git commit -qm
  "<label>"` inside the workspace on `openmi/work/<chat>` (the seed already
  creates that branch and a `base` commit, `lib/execution/chat-env/seed.ts:73`),
  then record the SHA. Nothing is pushed.
- **Restore:** `git reset --hard <sha>` plus `git clean -fd`, then re-read
  `git status` and report it. Refuse while a turn holds the lease.
- **UI:** a version list in the chat header; "Restore this version" on each
  checkpoint; the transcript shows the active checkpoint id.
- **Acceptance:** a test asserts restore moves the workspace back and that a
  restore during a live lease is refused; the checkpoint query is owner-scoped.
- **Est:** S–M.

---

## 4. Phase P15 — start from a template

Gate on D3 and on P13 being live, because a generated app with no preview is a
worse experience than an existing repo with one.

- **Templates:** a small catalogue, each entry: name, repo skeleton, dev command,
  expected port, install command. Keep it to 2–3 that this team maintains.
- **Create:** GitHub API "create repository from template" (or an initial commit
  of the skeleton), then seed the chat workspace at that first commit and pin the
  chat to it.
- **Constraint:** this must not become a second write path. The only change after
  creation is the existing changeset → PR path.
- **Migration 035:** `projects` (name, template, repo, owner, chat_id) if a
  project outlives a chat; otherwise reuse `chats` and skip the table.
- **Acceptance:** a new account goes template → repo → preview → first diff → PR
  with no manual step; the created repo's first commit is the template's.
- **Est:** M.
- **Status:** shipped. Two templates (`next-starter`, `vite-react`), creation via
  `POST /user/repos` plus one tree/commit/ref in `lib/github/write.ts`, a private
  repository by default, and a chat pinned to the commit creation returned. The
  test runs each template's own `package.json` through the preview detector, so a
  template the preview cannot serve fails at build time. A token without repo
  scope gets a sentence saying so, not a silent 403.

---

## 5. Phase P16 — publish

Gate on D4.

- **Route:** `app/api/publish/[chatId]/route.ts`, POST only, owner-checked, CSRF /
  same-origin checked with the existing helper.
- **Shape:** call the Vercel API to deploy the merged commit of the pinned branch
  (or the default branch after merge), store `deployment_id`, `url`, `state`,
  `created_at` in `deployments` (service-role).
- **Report:** the card shows the URL the API returned and the state it reported.
  "Live" only when the API says ready. A failed deploy shows the provider's
  message.
- **Snapshot semantics:** later changes require another publish. Say so on the
  button, not after the fact.
- **Acceptance:** a mocked provider test asserts no URL is rendered without a
  ready state; a failed deploy renders the provider message and no link.
- **Est:** M.

---

## 6. Phase P17 — follow the branch

Gate on D5.

- Poll the pinned branch on chat open and on an explicit "Pull" action.
- Fast-forward only when the workspace has no uncommitted changes and no live
  lease. Otherwise refuse with what is in the way.
- Re-seed at the new head when a fast-forward is impossible and the workspace is
  clean.
- **Acceptance:** a test covers three cases — clean fast-forward, dirty refusal,
  lease refusal — and each message is distinct.
- **Est:** M.

---

## 7. Sequenced delivery

```text
D1 sign-off
   │
   ├── T1.1 provider ─ T1.2 dev server ─ T1.3 routes ─ T1.4 panel ─ T1.5 cost ─ T1.6 flag
   │                                                                        │
   │                                                                        ▼
   │                                                                   P14 checkpoints
   │                                                                        │
   ▼                                                                        ▼
 A (public link, labelled)  ──►  B (subdomain proxy)  ──►  P15 templates ──► P16 publish ──► P17 sync
```

Ship **P13 + P14** as one window: preview without restore is a demo, restore
without preview is incomplete. Templates and publish each deserve their own
window and their own security review.

---

## 8. Test matrix to add

| Test | Proves |
|---|---|
| `tests/preview-detect.test.ts` | dev command and port selection from `package.json` |
| `tests/preview-auth.test.ts` | 401 signed-out, 404 other owner, owner 200 |
| `tests/preview-token.test.ts` | the traffic token never appears in a response body |
| `tests/checkpoints.test.ts` | restore semantics and lease refusal |
| `tests/preview-cost.test.ts` | minutes charged, cap enforced, ledger sums |
| `tests/publish.test.ts` | no URL without a ready state |
| migration harness | every new migration applies twice |

---

## 9. Risks that must be handled before launch

| Risk | Mitigation |
|---|---|
| Preview URL leaks | D1=B, token server-side, stop on idle, no URL in logs |
| Preview keeps billing | per-minute Dew, 60-minute chat cap, visible stop reason |
| Absolute asset paths break under a path proxy | D1=B subdomain; do not ship C as if it were finished |
| Restore destroys uncommitted work | refuse while a lease is live; commit before any reset |
| Publish claims more than it observed | render only the provider's state and URL |
| Templates become a second GitHub write path | creation only; every later change is a changeset |

---

## 10. Out of scope, deliberately

- Lovable-style backend provisioning (database, auth, storage as one unit).
- Visual inline text editing and annotation. Element selection becomes possible
  only after D1=B, and is its own phase.
- Parallel missions. Missions stay serial until the preview loop is stable.
- Custom domains for published apps. Start with the provider's default URL.
