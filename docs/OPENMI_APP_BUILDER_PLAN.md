# Replicating the Lovable / Freebuff loop in Openmi

**Question this answers:** can Openmi feel like Lovable or Freebuff — describe a
change, watch it happen, see it running, ship it — without becoming a different
product?

**Short answer:** yes for the part that matters, and most of the hard trust work
is already built. What is missing is not intelligence, it is **a live preview, a
checkpoint, a starting point and a publish button**. Those are four features, not
a rewrite.

The executable version — decisions, task IDs, files, migrations and acceptance
tests — is in [APP_BUILDER_BUILD_PLAN.md](APP_BUILDER_BUILD_PLAN.md). Why Bolt's
in-browser runtime cannot simply be ported, and what is worth taking from it, is
in [BOLT_STACK_ASSESSMENT.md](BOLT_STACK_ASSESSMENT.md).

Sources for the competitor behaviour are listed at the end. Everything about
Openmi is cited to a file in this repository.

---

## 1. What Lovable actually does

The loop, from its own documentation:

1. **Project chat** builds a whole application. "Build mode" writes code, runs
   tools, applies changes across files and verifies; Plan mode never touches
   code; Chat mode is conversational. Read-only subagents research in parallel.
2. **Preview** runs in a temporary cloud environment that Lovable starts for the
   project, pauses on idle and resumes. The preview toolbar turns the page into
   an editing surface: select elements, edit text inline, draw annotations,
   comment.
3. **Version history**: a version per change, revert restores code only (data is
   untouched), plus bookmarks and per-message undo.
4. **Git sync** is two-way on one synced branch: Lovable commits and pushes;
   commits pushed to that branch appear in the project. Conflicts go to a
   `lovable-sync` branch rather than clobbering.
5. **Publish** deploys a *snapshot* to a URL. The live site does not move until
   you republish, and a quick security scan runs first (findings do not block by
   default).
6. **Backend**: Lovable Cloud provisions database, auth and storage as one unit
   (Supabase-based), generates RLS policies, and keeps secrets server-side.

## 2. What Freebuff does

- Agents, not one model: a file-finding pass maps the repo, a browser-use agent
  drives a real browser to test the change it just made, a reviewer, a thinker,
  and `spawn_agents` for delegation.
- Parallel isolation: one agent per tab, each in its own workspace/worktree.
- Cloud: connect any GitHub repo, boot a sandbox, configure a live preview,
  share the URL; "eject to GitHub" when you want the code back.
- App builder: templates, sign-in/database/publishing wired by default, one-click
  deploy to production with custom domains.

## 3. Where Openmi already stands

| Capability | Lovable | Freebuff | Openmi today |
|---|---|---|---|
| Agent edits code | yes | yes | yes — `propose_edits`, whole-file or exact replacement |
| Sees the result | preview + browser | browser agent | **screenshot only**, `lib/agent/browser.ts` |
| Reviewable diff | yes | yes | yes — signed changesets, per-file accept |
| Writes to GitHub | two-way sync | eject | one branch + PR, squash-merged, `lib/changesets/commit.ts` |
| Undo | version history | git | revert commit per changeset, `lib/changesets/undo.ts` |
| Runs commands | sandbox | sandbox | E2B sandbox, **off until configured** (`docs/E2B_SANDBOX_READINESS.md`) |
| Long autonomous work | agent mode | missions | missions: 200 commands, 30 min max |
| Live preview URL | yes | yes | **no** |
| Start from nothing | yes | yes | **no** — needs an existing repository |
| Publish | snapshot deploy | one-click | **no** — a merged PR is the end |
| Visual editing | select/edit/annotate | no | **no** |
| Two-way sync | yes | eject | **no** — pinned commit, no pull-back |
| Per-message checkpoint | yes | git | **only changeset-level revert** |
| Billing | credits | ad-funded | Dew per hour + per sandbox minute |

The pattern is clear: Openmi has the **rigour** layer that neither competitor
advertises (signed artefacts, refusal of the default branch, exit codes as the
only evidence) and is missing the **theatre** layer that makes the loop feel
alive (preview, checkpoints, publish).

## 4. The four missing features, and how to build each

### 4.1 Live preview (the one that changes how it feels)

**Enabler, verified in the installed SDK:** `e2b@2.63.0` exposes
`sandbox.getHost(port)` (`node_modules/e2b/dist/index.d.ts:11704`), which returns
a host like `https://3000-<sandbox-id>.e2b.app`. E2B also accepts
`allowPublicTraffic: false`, after which requests need an
`e2b-traffic-access-token` header.

**The trap:** E2B public URLs are public to anyone who knows them by default, and
the docs say to treat them like a credential. Pasting one into a chat is
therefore a leak, not a feature.

**Design that fits Openmi:**

1. Extend `SandboxHandle` in `lib/execution/provider.ts` with
   `host(port: number): string` and remember `trafficAccessToken` on creation.
2. Give a chat workspace a **dev-server record**: port, command, started-at,
   status. Reuse the existing `start_process` machinery in
   `lib/agent/sandbox.ts`; add auto-detection of the framework's dev port
   (`next dev` → 3000, Vite → 5173) from `package.json` scripts in
   `lib/execution/commands.ts`.
3. Add `app/api/preview/[chatId]/route.ts`: authenticate the owner, read the
   sandbox host, and **proxy** the response with the traffic token attached.
   The iframe points at your origin, so the token never reaches the browser and
   the URL is not guessable.
4. Add a Preview panel beside the transcript (`components/PreviewPanel.tsx`)
   with reload, external-open (signed, short-lived), and viewport presets.
5. Keep the sandbox on `onTimeout: "pause", autoResume: true` — already how
   `createChatSandbox` works — so opening the preview after a night of silence
   wakes the box instead of failing.

**Cost consequence, must be priced before shipping:** a preview keeps the box
warm, and E2B bills running compute. Either the preview is Dew-per-minute
(`MISSION_DEW_PER_MINUTE = 0.05` is the existing rate) or it stops after a short
idle window with a visible "preview stopped" state. Do not ship an always-on
preview on an hourly chat price.

**The hard part is WebSocket/HMR.** A Next route handler cannot hold an upgrade.
Three honest options:

- polling reload (simplest, acceptable for a first release);
- a dedicated Node proxy process, which Vercel cannot host — a separate service;
- point the iframe at the E2B host directly with restricted traffic and a
  short-lived cookie, accepting that HMR is the browser's problem, not yours.

Recommendation: ship (1) polling first, and keep the proxy shape so (2) can be
added without changing the UI.

### 4.2 Checkpoints (cheap, high value)

The workspace is already a git checkout seeded at the pinned commit
(`lib/execution/chat-env/seed.ts`). After each turn that changed files:

- commit inside the sandbox on `openmi/work/<chat>`;
- store `commit_sha`, the turn id and a label on a `sandbox_checkpoints` row;
- "Restore this version" = `git reset --hard <sha>` in the workspace, then
  confirm with `git status` and show what changed back.

This gives Lovable's version history without a new storage system, and it is the
natural companion to the step record added in migration 032.

### 4.3 Start from nothing

Openmi's identity is "a repository the user chose". Breaking that turns it into a
different product, so the smallest version that fits:

- a template catalogue (Next.js + Supabase, Vite + static, plain Node);
- one flow: pick a template → create the repository through the GitHub API under
  the connected account → seed the sandbox → open the chat pinned to the first
  commit;
- the same changeset/PR machinery from that point on. No second write path.

Template choice is a product decision; keep the list short and each entry
something this team actually maintains.

### 4.4 Publish

Two candidate shapes, and they are not equal:

| Approach | What it is | Fit |
|---|---|---|
| **Vercel deploy of the branch** | call the Vercel API with the repo + ref, return the deployment URL, poll until ready | natural: Openmi already deploys on Vercel; the card can report the real state |
| **Static export to object storage** | build in the sandbox, upload `out/` to R2/S3 with a CDN | only for static templates; no SSR, no env vars |

Recommendation: Vercel deploy, behind an explicit "Publish" action, reported
with the same rule as everything else — the card says what the deployment API
returned, not "it works". A published app is a *snapshot*: later changes need
another publish, exactly like Lovable.

### 4.5 The rest, in order of value for effort

| Feature | Why | Effort |
|---|---|---|
| Element picker in the preview | the "click the thing you want changed" moment | M — only possible with the same-origin proxy |
| Two-way sync | works with the team's real branch, not a pinned snapshot | M — poll the branch, fast-forward when the workspace is clean, refuse otherwise |
| Parallel missions | Lovable's subagents / Freebuff's tabs | L — needs per-mission budgets and a queue |
| Security scan before publish | Lovable runs one; Openmi should not *claim* one | M — dependency audit is the honest first version |

## 5. Phased plan

Each phase is shippable alone and leaves the product honest if the next one never
lands.

| Phase | Work | Acceptance | Effort |
|---|---|---|---|
| **P13** | `getHost` on the handle; dev-server record; preview panel; same-origin proxy with the traffic token; idle stop + explicit "preview stopped" | A chat starts `next dev`, the panel renders the app, the URL works for the owner and 404s for anyone else | M |
| **P14** | Checkpoint on every applied turn; restore action; history list in the chat | Restoring a checkpoint puts the workspace back and the transcript says which version is live | S |
| **P15** | Template catalogue + create-repository flow | A new account can go template → repo → first change → PR without a manual step | M |
| **P16** | Publish via Vercel deploy; deployment state on the card; republish semantics | The card shows the URL the API returned and never says "live" without it | M |
| **P17** | Two-way sync with the pinned branch | A commit pushed to the branch appears in the workspace, or the app explains why it cannot fast-forward | M |
| **P18** | Parallel missions with per-mission caps | Two missions run without sharing a workspace or a budget | L |

**Recommended first move: P13 + P14.** Preview plus restore is roughly 80% of
why Lovable and Freebuff feel alive, and both reuse the E2B sandbox and the chat
workspace that already exist. P15 (start from nothing) is a product bet, not a
technical one — take it only if Openmi should compete for the no-repo user.

## 6. What not to copy

- **The no-code backend provisioning.** Lovable Cloud creates a database, auth
  and storage as one unit. Openmi's users already have a repository and usually a
  backend; inventing a second one would duplicate their infrastructure and make
  the diff lie.
- **"Verified" marketing.** Lovable's self-repair is explicitly probabilistic and
  its publish scan does not block. Openmi's one durable advantage is that a card
  says only what exited 0 — do not spend it on a badge.
- **Credit pricing theatre.** Dew is already hourly plus sandbox minutes; a
  preview must be priced explicitly, not hidden in "credits".

## 7. Risks

| Risk | Consequence | Mitigation |
|---|---|---|
| Public E2B URL leaks | anyone runs code in the user's box while it lives | same-origin proxy, `allowPublicTraffic: false`, token server-side |
| Preview keeps billing | an idle tab costs Dew | idle stop, visible state, per-minute pricing |
| WebSocket/HMR cannot be proxied by a route handler | preview without hot reload | polling reload first; dedicated proxy later |
| A published app is mistaken for the repo state | false claim | "published snapshot" wording, republish required |
| Scaffolding drifts into a second write path | two ways to change GitHub | scaffold creates a repo, then the existing changeset path only |

## 8. Sources

- Lovable preview environment and toolbar: https://docs.lovable.dev/features/projects/preview
- Lovable modes (Build/Plan/Chat, subagents): https://docs.lovable.dev/features/modes
- Lovable publish, snapshot semantics, security scan: https://docs.lovable.dev/features/publish
- Lovable version history and revert: https://docs.lovable.dev/features/projects/history
- Lovable Git sync (one branch, two-way, conflicts): https://docs.lovable.dev/integrations/git-sync-overview
- Lovable built-in backend: https://docs.lovable.dev/integrations/cloud
- Freebuff agent surfaces and parallel isolation: https://github.com/CodebuffAI/freebuff , https://freebuff.com/cloud
- E2B public URL and `getHost(port)`: https://docs.e2b.dev/network/public-url
- E2B auto-resume on preview traffic: https://docs.e2b.dev/sandbox/auto-resume
- E2B traffic token / `allowPublicTraffic`: https://github.com/e2b-dev/E2B/blob/main/packages/js-sdk/src/sandbox/sandboxApi.ts
- v0 sandbox port/domain model (the same microVM + published-port pattern): https://vercel.com/docs/sandbox/sdk-reference
