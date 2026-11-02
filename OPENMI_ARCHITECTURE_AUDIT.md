# Openmi — Consolidated Full-Stack Architecture & UI/UX Audit

**Repository audited:** `github.com/LOWENDLAGANI/Openmi`, branch **`test`**, commit `08a049d` ("Stop the chat from replacing the error it was handed").
**Method:** every tracked file enumerated (285 files, 50,736 lines of TypeScript/TSX, 32 SQL migrations, 32 test suites); configuration, styles, routes, migrations and core modules read directly; colour contrast computed from the shipped token values with the WCAG relative-luminance formula.
**Status:** this document supersedes `OPENMI_ARCHITECTURAL_UI_UX_AUDIT.md`, which describes an earlier, different product (blue light theme, per-message Dew pricing, 8-step agent). It is accurate for `main` as of this audit only in the parts that still coincide.

Companion artifact: `agent-push-requirements.md` (agent execution rules).

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Product model](#2-product-model)
3. [Visual & UI blueprint](#3-visual--ui-blueprint)
4. [Functional & interactive mechanics](#4-functional--interactive-mechanics)
5. [Core codebase architecture](#5-core-codebase-architecture)
6. [Data layer, schema and RLS](#6-data-layer-schema-and-rls)
7. [Security model](#7-security-model)
8. [Configuration, testing and delivery](#8-configuration-testing-and-delivery)
9. [Findings register](#9-findings-register)
10. [Recommended build sequence](#10-recommended-build-sequence)
11. [Appendix: measured contrast](#11-appendix-measured-contrast)

---

## 1. Executive summary

Openmi is a Next.js 15.5.28 / React 19.3.1 App Router application: a local-first, account-gated chat client with a GitHub repository agent. The agent reads a repository through five tools, proposes edits as whole-file writes or exact string replacements, and commits **only** after a signed human approval, always to an `agent/*` branch, always through one route.

**Verdict.** The security and data design is materially stronger than the previous specification claimed: one `SECURITY DEFINER` charge path with no price parameter, a primary-key-enforced single hour session, change sets signed over a content hash *and* a base commit, and a service-role key confined to one module. The two weakest areas are (a) **theming**, where a token system is bolted onto a components layer that still hardcodes colours, patched with ~400 lines of `!important` attribute selectors, and (b) **documentation drift**, where the README describes prices, agent budgets and a completion phase that the code no longer implements.

The single most concrete defect is measurable: **accent-filled controls carry white text on a sage or lavender fill at 2.14:1 and 2.59:1 contrast** in the dark and ink themes — below even the 3:1 large-text floor. The light theme already solves this correctly with dark ink on the accent, which shows the intended pattern.

| Dimension | Grade | Note |
|---|---|---|
| Security architecture | Strong | Signed approvals, RLS everywhere, narrow service-role use |
| Money correctness | Strong | Single charge function, PK-enforced session, refunds |
| Data model | Good | Normalised, but message ordering is client-clock based |
| Frontend theming | Fragile | Token layer real; components still literal; CSS overrides |
| Accessibility | Mixed | Two real contrast failures; good focus/reduced-motion work |
| Documentation accuracy | Poor (drift) | README contradicts code on price, budget and phase |
| Test strategy | Good | 32 suites + PGlite migration replay; no browser layer |

---

## 2. Product model

**Name:** Openmi. **Tagline:** "Your repository, with a reviewer built in."

Three model modes, chosen by cost appetite rather than vendor name:

| Mode id | Picker label | Display name | Provider binding | Attachments |
|---|---|---|---|---|
| `auto` | Efficient | Openmi Auto | OpenRouter → Gemini (V3→V2→V1) → Groq | images + documents |
| `code` | Balanced | GPT-OSS 120B | Groq only (no cross-vendor fallback) | documents |
| `flash` | Advanced | DeepSeek V4.1 Flash | DeepSeek only | documents |

`lib/models.ts` is deliberately provider-free because it is compiled into the browser; wire ids and provider names live in server-only `lib/modelEngines.ts` and `lib/providers.ts`. A regex whitelist (`PRODUCT_NAME`) filters stored model labels before rendering, so a message written by an older build or restored from a backup can never leak a provider id into the UI.

**Dew** is the currency. It is not per message. **3 Dew buys one hour** of usage, covering every answer in every chat on the model the hour was bought for — and, when started in a repository workspace, on that repository only. Accounts receive **10 free Dew per day** (15 with a paid pass), refilled at local midnight in the account's stored IANA timezone, spent before paid credit. Free Dew is a bucket, not a stipend: leftovers are discarded. Trial (5), redeemed and topped-up Dew never expire.

Paid plans are manual-transfer passes activated by the operator: RM 18 / 15 days and RM 35 / 30 days. Payment is an external link (`sociabuzz.com`), never an in-app checkout; the buyer returns and uploads a receipt.

---

## 3. Visual & UI blueprint

### 3.1 Design system: how it is actually built

Three layers:

1. **CSS custom properties** in `app/globals.css` — `:root` (dark), `html.light` ("Paper"), `html.ink` ("Focus home").
2. **Tailwind colour aliases** in `tailwind.config.ts`, mapped to those variables (`canvas → var(--bg)`, `text-body → var(--text)`, `line`, `chip`, `dock`, `hover`, `raised`, `card`, `accent`), so a component written with semantic classes follows the appearance.
3. **A large `!important` override block** for components that use literals (`text-white/60`, `bg-[#111a16]`, `bg-white/5`). This is the load-bearing part of the light and ink themes (see §3.4).

Typography is **Instrument Sans** (sans) and **Space Mono** (mono), loaded at the root via `next/font/google` and exposed as `--font-lp-sans` / `--font-lp-mono`. The chat shell keeps a system stack for the body but reuses the landing faces through Tailwind's `font-sans` / `font-mono`, so marketing and product share one type system.

Motion is a named, deliberately small vocabulary: `--motion-ease-smooth` `cubic-bezier(.22,1,.36,1)`, `--motion-ease-expo`, `--motion-ease-ink` (a slight overshoot), and 140/260/420ms durations. Keyframes: `fade-in-up`, `pulse-dot`, `shimmer`, `mark-bounce`, `logo-reveal`, `enter`, `view-in/out`, `stream-block`, `caret`, `halo`, `sheen`. Every animation is restricted to `transform`/`opacity` — the file states this as a performance contract, and the spinner/enter classes honour it. A global `prefers-reduced-motion` block collapses durations to 0.01ms and disables entry animations, with a still-arc fallback so a spinner still reads as "in progress".

### 3.2 The three palettes (as shipped)

**Dark (`:root`)** — deep green-black, sage accent:

| Token | Value | Role |
|---|---|---|
| `--bg` | `#0b1310` | canvas |
| `--bg-raised` | `#111a16` | raised surface |
| `--bg-hover` | `#17221c` | hover wash |
| `--bg-elevated` | `#1a2520` | elevated sheet |
| `--card` | `#111a16` | AI answer card |
| `--line` / `--line-strong` | `rgba(233,245,236,.08)` / `.14` | hairlines |
| `--text-hi` / `--text` / `--text-mid` / `--text-low` | `#eef5f0` / `#cddfd4` / `#8ba396` / `#5d7167` | text ramp |
| `--accent` | `#6ec294` | sage |
| `--on-accent` | `#ffffff` | ink inside accent fills |
| `--bubble-user` / `--bubble-user-text` | `#2f6b48` / `#ffffff` | user message |
| `--azure` / `--code` | `#5b9bd5` / `#e08e6b` | per-model identity |
| `--dock`, `--chip`, `--chip-border` | `#0e1613`, `#111a16`, `rgba(233,245,236,.1)` | composer, chips |

**Paper (`html.light`)** — warm cream, single orange:

| Token | Value | Role |
|---|---|---|
| `--bg` | `#f3f1e9` | paper canvas (landing page palette) |
| `--bg-raised` / `--bg-elevated` | `#fbf9f2` / `#fffdf7` | sheets |
| `--bg-hover` | `#eae6db` | hover |
| `--text-hi` / `--text` / `--text-mid` / `--text-low` | `#15130f` / `#2b2722` / `#6b6154` / `#8a8172` | text ramp |
| `--accent` | `#f55036` | orange |
| `--on-accent` / `--bubble-user-text` | `#15130f` | dark ink on orange |
| `--bubble-user` | `#f55036` | user message |
| `--azure` / `--code` | `#a8562f` / `#8a4b2a` | identity, warmed |
| shadow | `0 1px 2px rgba(21,19,15,.04), 0 10px 28px -22px rgba(21,19,15,.4)` | card lift |

**Ink (`html.ink`)** — near-black indigo, lavender:

| Token | Value | Role |
|---|---|---|
| `--bg` | `#1b1826` | canvas |
| `--bg-raised` / `--card` | `#211e2f` | sheets |
| `--bg-hover` / `--bg-elevated` | `#282436` / `#262233` | hover, elevated |
| `--text-hi` / `--text` / `--text-mid` / `--text-low` | `#f2f0f6` / `#dcd9e6` / `#a6a1b6` / `#837e96` | text ramp |
| `--accent` | `#a09ad8` | lavender |
| `--on-accent` | `#ffffff` | ink inside accent |
| `--bubble-user` | `#4a4670` | user message |

**Landing-only palette (`.lp`)** — intentionally scoped so the marketing page never inherits a chat theme: cream `#f3f1e9`, ink `#15130f`, dim `#bdb7aa`, orange `#f55036`, hairline `rgba(21,19,15,.13)`. Type does the design work: a tight grotesque at `clamp(40px, 7.2vw, 86px)` with `-0.045em` tracking, and a mono label style at 11–12px with `0.17em` tracking and uppercase.

### 3.3 Layouts and views

| Surface | Route | Structure |
|---|---|---|
| Marketing | `/` | Sticky 64px header + `.lp-shell` (max 1240px, 22/44px gutters); hero, scrolling mono ticker, scroll-inked statement block, steps, rules |
| Product shell | `/chat` | Full-height (`100dvh`) app: fixed/drawer sidebar (folders, chat list, Dew chip, footer links) + thread column + composer dock + optional repo panel |
| Focus home | `/chat` with `homeLayout: "focus"` | Centred mark, repository chip, "New chat" bar, composer at the foot; forces the ink palette |
| Settings / admin | overlay within `/chat` | Tabbed sheets (`SettingsPanel`, `AdminPanel` 1,375 lines) |
| Activity | `/activity` | Dew spend by day and model |
| Landing/legal | `/plus`, `/privacy`, `/about`, `/share/[id]`, `/auth/reset-password` | Static-ish marketing and share surfaces |
| Feedback | `app/loading.tsx`, `error.tsx`, `not-found.tsx`, `SplashScreen` | Boot, failure and 404 states |

Layout primitives that carry meaning: `h-[100dvh]` for mobile chrome, `env(safe-area-inset-*)` (`safe-top` / `safe-bottom`), `overscroll-behavior: none`, and `.no-scrollbar` for the quick-action row.

### 3.4 The theming mechanism, and why it is the biggest UI debt

The light and ink themes are **not** driven by the token layer alone. They are completed by a block of attribute selectors that rewrite literal Tailwind utilities, e.g.:

```css
html.light [class*=" text-white/6"], html.light [class^="text-white/6"] { color: #4a443a !important; }
html.light [class*=" bg-[#0b1310]"], html.light [class^="bg-[#0b1310]"] { background-color: #fbf9f2 !important; }
html.ink  [class~="bg-[#2f6b48]"] { background-color: #625d97 !important; }
```

The file is candid about an earlier bug this caused (`[class*="bg-white/"]` matched `hover:bg-white/[0.06]`, painting every control permanently). The corrected rule matches whole tokens for `bg-`/`border-`, but the **text ramp still uses prefix matching** (`text-white/1`, `/2`, `/3` …), which also matches `text-white/10`, `text-white/15` and so on.

Consequences:

- A component added with a **new literal colour** is invisible to the theme layer unless someone adds a matching selector. Semantic tokens work; literals silently don't.
- The selector block is ~400 lines of specificity war, twice (`.light` and `.ink`), and must be kept in sync with two palettes.
- `html.ink` also patches the same literals with lavender, duplicating the logic.

`lib/settings.ts` decides the class set in one place:

```ts
root.classList.toggle("ink",   homeLayout === "focus");
root.classList.toggle("light", !ink && appearance === "light");
root.classList.toggle("dark",  !ink && appearance === "dark");
```

So **ink is not a third appearance choice** — it is bound to the Focus home layout, and choosing "Focus" forces it. That is a defensible design decision (the file explains it), but it means "three themes" is really "two appearances + one layout-locked palette", which any theming work must not assume otherwise. Default appearance is **light**, deliberately.

### 3.5 Component inventory (48 components)

Shell and navigation: `Sidebar` (903), `ChatThread` (956), `ChatInput` (820), `FocusHome`, `SplashScreen`, `LandingRedirect`, `OpenmiLanding` (363), `OpenmiMark`, `AboutLogo`, `SearchOverlay`, `QuickActions`, `TrashOverlay`.

Conversation: `Markdown` (241), `ContextRing`, `ModelSelector`, `Spinner`, `ArtifactFrame`, `ChangeReview` (339), `RepoPanel` (1,353).

Settings and account: `SettingsPanel`, `AccountSection` (661), `AuthScreen`, `EmailAuthForm` (270), `PasswordRecoveryScreen`, `AuthDiagnostics`, `ApiKeysSection`, `ProfileAvatar`, `DataControls`, `ModelHealth`, `SetupStatus`.

Money: `DewPayDialog`, `PricingDialog`, `PassPayDialog`, `RedeemCodeBox`, `ReceiptUpload` (385), `PaymentsSetupNotice`.

Admin: `AdminPanel` (1,375), `AdminGate` (306), `AdminControls` (472), `AdminReceipts` (364), `MaintenanceGate`, `MaintenanceScreen`, `useAdminTaps` (a tap-sequence unlock).

Ads: `AdBanner`, `AdPopunder`, `ads.ts`. Infrastructure: `ServiceWorker`.

### 3.6 Accessibility findings (measured, not asserted)

| Theme | Pair | Ratio | Verdict |
|---|---|---|---|
| dark | `--text-low #5d7167` on `#0b1310` | **3.61:1** | fails AA 4.5:1 (used for 11–12px hints, `.thread-tool`, placeholders) |
| light | `--text-low #8a8172` on `#f3f1e9` | **3.40:1** | fails AA at small sizes |
| ink | `--text-low #837e96` on `#1b1826` | **4.47:1** | just under AA |
| dark | `--on-accent #ffffff` on `--accent #6ec294` | **2.14:1** | **fails even 3:1** |
| ink | `--on-accent #ffffff` on `--accent #a09ad8` | **2.59:1** | **fails even 3:1** |
| light | `--accent #f55036` on `#f3f1e9` | 3.05:1 | large text / UI only, not body |

Body text passes comfortably everywhere (dark 13.55:1, light 13.11:1, ink 12.54:1), and user bubbles pass (6.33 / 5.37 / 8.75:1). The failures are concentrated where the design uses low-contrast greys for chrome and white-on-accent for filled controls.

The light theme demonstrates the fix already: `--on-accent: #15130f` on `#f55036` = 5.37:1. The dark and ink themes should do the same (near-black ink on sage/lavender) rather than white.

Strengths worth preserving: `aria-label` coverage is broad and specific (e.g. `"Dew balance is running low — top up"`), `role="group"` on the folder strip, `:focus-visible` outlines on the landing page, real `<button>` elements throughout the thread, and reduced-motion handling that leaves meaningful still states.

---

## 4. Functional & interactive mechanics

### 4.1 Boot, routing and the account gate

1. `app/layout.tsx` loads the two fonts, sets metadata/OpenGraph, mounts `ServiceWorker`, imports `globals.css`. It also carries an inline boot script that applies the stored appearance/home layout before first paint, so a reload does not flash the wrong theme.
2. `/` is a **server-rendered** marketing page (`app/page.tsx` → `LandingRedirect`). A browser already holding a session is replaced with `/chat`; a cold visitor and a crawler get the real landing markup in the first response.
3. `/chat` has its own layout that sets `robots: noindex`. There is **no `middleware.ts`**: the product page is publicly served and the gate is client-side (`AuthScreen` renders instead of the shell until a session exists). Data is protected independently by RLS and per-route bearer verification, so this is a UX/SEO choice rather than a data leak — but it does mean unauthenticated requests reach the page and route handlers.
4. `app/chat/page.tsx` (2,321 lines) is the single orchestration component. It holds ~25 pieces of state: `activeChatId`, `selectedMode`, `available`, `streamingId`, `sidebarOpen`, `settingsOpen`, `repoOpen`, `project`, `account`, `deviceAccount`, `modelNotice`, `agentActivity`, `thinking`, `searchMode`, `responseLength`, `reasoningEffort`, `appearance`, `homeLayout`, `rateLimitUntil`, `contextBudget`, `appConfig`, `draftId`, `hourSession`, `pricingPrompt`/`pricingBusy`/`pricingNotice`, plus ~20 effects for account watch, sync, config subscription, theme application, session refresh and keyboard handling.

### 4.2 Authentication

Four doors, all Supabase Auth: Google, GitHub, Microsoft (`azure`), email + password. States handled by `AuthScreen` / `EmailAuthForm`:

- OAuth is a full-page round trip; no popups.
- Email registration sends a confirmation mail but **nothing is gated on it** — an unconfirmed user keeps access.
- Disposable email domains are refused at sign-up via `reject_disposable_signup()` and the `blocked_email_domains` table, so a throwaway address cannot become the only key to someone's history.
- Password reset returns to `/auth/reset-password`, which demands a new password immediately; a signed-in email account can change it from Settings.
- `AccountSection` supports identity **linking** (`linkIdentity`) so a Google user can attach GitHub and end up with one account. Unlinking the last method is not offered — Supabase refuses to leave an account with no way in. When manual linking is off, the server's `manual_linking_disabled` is surfaced with the exact dashboard toggle to flip.
- `AuthDiagnostics` maps provider errors to a plain-English inventory (`provider_disabled`, `invalid_api_key`, `relation "…" does not exist`), which is the single most useful support surface in the app.

**Device handover.** IndexedDB is per browser, not per account. `lib/chatSync.ts` defines `planHandover` and `lib/cloudHistory.ts` clears chats, messages, folders, trash and pending trash decisions *before* pulling the new account's history; cloud push refuses to upload local rows until the handover has run. The same account signing back in keeps its cache and pulls only what is new.

### 4.3 Chat lifecycle

```
composer submit
  → local user message written to Dexie (id, monotonic createdAt via nextMessageTime)
  → POST /api/chat { model, messages, searchMode, responseLength, reasoningEffort, serverBudget }
      ├─ runtime "nodejs", dynamic "force-dynamic", maxDuration 120
      ├─ verifyCaller(bearer) → identityGate → checkRateLimit
      ├─ hour-session gate: readHourSession + hourModelRefusal
      │    (refuses a different model or repository than the live hour was bought for)
      ├─ personal provider key preferred over the deployment key (readUserKeys)
      ├─ optional Tavily web search → formatSearchContext
      ├─ provider chain by mode; Auto falls back across vendors,
      │    Code (Groq) and Flash (DeepSeek) never cross vendors
      ├─ SSE: token deltas, step events, done{usage}, error
      └─ on abort/failure: refundHourSession (auto_refund_idle_hour covers the watchdog case)
  → assistant message persisted with usage, sources, steps, variants, truncated flag
  → sync to Supabase (cloudHistory)
```

SSE framing is a hand-rolled `encodeEvent()` with `text/event-stream`, `maxDuration = 120`, and `continuationMessages()` to resume a completion that hit the model's output limit. Errors are normalised by `explainProviderError` into readable text rather than upstream JSON, and `errorStream()` emits them as an event so the thread can render an alert instead of dying. `GET /api/chat` answers mode availability.

### 4.4 Composer and message interactions

`ChatInput` (820 lines) is a capsule (`composer-capsule`, pill radius, focus ring swap to card surface) with:

- **Attachments:** up to 4 images and 3 documents; `MAX_DOCUMENT_SIZE = 100_000`; a `DOCUMENT_TYPES` allowlist; `accept` filters for `.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.py,.html,.css,.sql`. Capability-gated per mode (`MODE_CAPABILITIES`): Code and Flash refuse images rather than letting the provider ignore them.
- **Capture:** camera and gallery inputs, plus voice input (Web Speech), each with its own `aria-label`.
- **Tools menu:** response length (`short | balanced | detailed`), reasoning effort (`low | medium | high`), search mode (`auto | on | off`), model picker.
- **Stop generating** button replaces Send while `streamingId` is set.
- Rate-limit handling: `rateLimitUntil` drives a counted-down disabled state instead of a hard failure; `Retry-After` is honoured.
- `ContextRing` above the composer shows the last request's real prompt count plus an estimate for the draft against the server-enforced per-request budget (`CONTEXT_BUDGET`), with a breakdown and a "fresh chat" offer past 90%.

`ChatThread` (956 lines) renders each answer as a card (`.msg-ai-card`, 20px radius, hairline border, soft shadow) and each question as a bubble (`.msg-user-bubble`). Interactions:

- **Edit** a user message inline → "Edit & send" forks the conversation.
- **Retry / regenerate** a response; **variant navigation** (`VariantNav`, `variants` + `variant_index`) lets a user flip between generations instead of losing them.
- **Copy** message, **copy conversation**, **sources** list with per-link copy.
- **Share** creates a signed, expiring snapshot (`ShareAnswerButton` → `/api/share`), not a live query.
- **Propose** turns a conversation into a repo change set (gated by `canPropose`, and only with a project attached).
- Streaming affordances: `.stream-cursor` caret, per-block `stream-block` settle animation, `TypingDots` with a rotating set of `EMPTY_STATE_HEADLINES`, "jump to latest" when scrolled up.
- Errors render through `.alert-danger` / `.alert-warn` with `overflow-wrap: anywhere` so a provider URL or JSON blob cannot push the card sideways.

### 4.5 Repository workspace

`RepoPanel` (1,353 lines) is the project surface: repo picker over every repository the connection can read, a filtered file tree pinned to a commit (`project.baseSha` recorded at attach time), and a read-only viewer. Connection states are explicit — checking, missing key (names the exact env var), failed (with retry), connected. `?github=connected` reopens the panel after the OAuth round trip.

### 4.6 The agent loop

```
POST /api/agent/step  { turnToken, messages, project, prompt }
  → verifyCaller → identityGate → rate limit
  → readTurn(token): verify HMAC (turnKey), TTL, steps ≤ MAX_STEPS
  → runAgentStep(): provider call with the five tool schemas
       list_files · read_file · search_code · read_issue · propose_edits
  → staged edits → buildChangeSet() → signed change set (id, hash, baseSha, branch, sig)
  → advanceTurn() → re-signed token returned
```

Hard limits in `lib/agent/turns.ts`: `MAX_STEPS = 40`, `MAX_TURN_TOKENS = 200_000`, `TURN_TTL_MS = 30 min`. `MAX_EDITS_PER_CALL` is enforced in `lib/agent/edits.ts`; `MAX_CHANGESET_FILES = 12`; `MAX_COMMIT_MESSAGE = 160`.

Reads are bounded by `MAX_FILE_BYTES` and `isSafeRelativePath` (`lib/github/tree.ts`), and `rankPaths` keeps a large tree from flooding the model. `read_issue` extends the agent to issue/PR context.

**Two execution models coexist.** Foreground turns carry budget in a **client-held HMAC-signed token** (`turns.ts`: "The client can read it and send it back"). Background runs use `agent_runs` rows, the service-role client (`lib/supabaseAdmin.ts`), a self-addressed tick chain (`/api/agent/tick`), a cancel route, and a watchdog sweep (`/api/agent/runs/sweep`, `AGENT_SWEEP_SECRET`, pg_cron + pg_net) that recovers a run whose chain died. `lib/agentRuns.ts` (607) is the state machine for that path, and `lib/db.ts` mirrors a resumable run locally for the foreground.

### 4.7 Review and commit

`ChangeReview` renders diff cards with per-file collapse and add/remove counts. The flow is deliberately two-step:

1. **Approve** (`/api/changesets/[id]/approve`) writes an HMAC approval bound to user, repository, base SHA, change-set hash and expiry. No network write.
2. **Commit** (`/api/changesets/[id]/commit`) is the only route in the product that writes to GitHub: blobs → tree (`base_tree = baseSha`) → commit → `agent/<slug>-<id6>` branch → pull request.

Refusals are explicit: a moved default branch returns a re-diff; a double submit returns the first commit; another account's change set cannot be read or committed (`normalizeChangeSet` re-checks ownership, then signature, then recomputes the hash from the files). `branchFor()` refuses anything not starting with `agent/`, so committing to the default branch is not merely discouraged — it is unreachable in code.

### 4.8 Secondary mechanics

- **Sidebar:** folders (create/rename/remove, chats survive removal), chat list with hold-for-options, palette search, 30-day trash with restore and permanent delete, Dew chip, links to `/activity`, `/about`, `/plus`.
- **Trash:** decisions are recorded *before* delivery (`markTrashDecision` → `flushTrashDecisions`), so an offline decision is not undone by the next sign-in.
- **Sharing:** a published answer is a copy of question + answer, no account or chat attached, 30-day expiry, revocable from Settings → Your data; the public view has no owner column.
- **Admin:** gated by `app_admin` (a database grant, not a code path) plus a tap sequence; `cloudAdmin.ts` (1,074) covers visitors, wipes, grants, config, model health, receipts, maintenance mode, and an audit trail (`admin_audit`).
- **Ads:** AdSense banner with reserved height (no layout shift) and an optional Adsterra popunder whose origin is parsed from one `.js` URL at build time; both obey the operator's Ads switch and the CSP.
- **PWA / push:** service worker registration component, `webmanifest`, VAPID push subscriptions persisted per account.

---

## 5. Core codebase architecture

### 5.1 Structure

```
app/                      routes: / (landing) /chat (product) /about /activity /plus
  api/                    31 route files (see §5.2)
  auth/reset-password/    recovery landing
  share/[id]/             public snapshot view
components/               48 TSX components
lib/                      ~90 modules
  agent/                  tools · edits · run · turns · review · model · transcript
  github/                 client · commit · connections · crypto · oauth · pat · store
                          tree · search · cache
supabase/migrations/      32 ordered SQL files (the authority surface)
supabase/README.md        dashboard setup, admin grant, pg_cron sweep
scripts/                  check-migrations.mjs (PGlite, applies twice)
tests/                    32 suites
docs/                     OVERHAUL_SPEC, AGENT_CAPABILITIES, AGENT_TOOLS_AND_RESUME,
                          ROADMAP, DOMAIN_MIGRATION, MIGRATE_TO_SUPABASE, legacy/
```

Total: 20,394 lines in `lib/`, 7,300 in `components/`, plus routes and tests.

### 5.2 API surface (31 files, 41 handlers)

| Group | Routes |
|---|---|
| Chat | `POST/GET /api/chat` |
| Agent | `POST /api/agent/step`, `POST /api/agent/tick`, `POST /api/agent/runs`, `GET /api/agent/runs/[id]`, `POST /api/agent/runs/[id]/cancel`, `POST /api/agent/runs/sweep` |
| Change sets | `GET /api/changesets/[id]`, `POST …/approve`, `POST …/commit` |
| GitHub | `GET/POST /api/github/connections`, `PATCH/DELETE /api/github/connections/[id]`, `POST /api/github/link`, `POST /api/github/unlink`, `POST /api/github/oauth/start`, `GET /api/github/oauth/callback`, `GET /api/github/repos`, `GET /api/github/status` |
| Projects | `GET/POST /api/projects`, `DELETE /api/projects/[id]`, `GET …/tree`, `GET …/file` |
| Money | `GET/POST /api/dew`, `GET /api/dew/activity`, `GET/POST /api/session`, `POST /api/redeem` |
| Account | `GET/POST/DELETE /api/keys`, `GET /api/setup` |
| Admin | `GET/PUT /api/admin/config`, `GET/POST /api/admin/models` |
| Share | `POST/GET /api/share`, `DELETE /api/share/[id]` |
| Static | `app/ads.txt/route.ts`, `robots.ts`, `sitemap.ts` |

Every authenticated handler follows the same preamble: extract bearer token → `verifyCaller` → `identityGate` (ban/maintenance) → `checkRateLimit` → act with a client built from **the caller's** token. The single exception is the `agent/runs` family, which uses the service-role client because a run outlives the tab.

### 5.3 Module map (the ones that matter)

| Module | Lines | Responsibility |
|---|---|---|
| `app/chat/page.tsx` | 2,321 | orchestration: state, effects, streaming, pricing prompts |
| `lib/cloudAdmin.ts` | 1,074 | admin console data layer |
| `lib/cloudHistory.ts` | 925 | bidirectional sync for chats, folders, trash, memories, visitors |
| `lib/changesets.ts` | 844 | change-set identity, hashing, signing, branch naming, commit gate |
| `lib/serverControl.ts` | 660 | identity, bans, rate limits, config, setup checks |
| `lib/db.ts` | 635 | Dexie schema + typed operations, backup/import |
| `lib/agentRuns.ts` | 607 | durable run state machine |
| `lib/account.ts` | 532 | session watch, linking, email flows |
| `lib/agent/review.ts` | 523 | advisory diff review + repair round |
| `lib/agent/edits.ts` | 508 | staging, exact-match replacement, unified diff |
| `lib/agent/tools.ts` | 507 | five tool schemas and executors |
| `lib/serverDew.ts` | 472 | ledger reads/writes, transactions, charge lines |
| `lib/agent/run.ts` | 468 | one step: provider → tools → change set |
| `lib/github/connections.ts` | 402 | token collection, default, rotation |
| `lib/agent/model.ts` | 403 | model choice and provider binding for a step |
| `lib/pricing.ts` | 355 | plans, benefits, locale currency display |
| `lib/github/client.ts` | 342 | GitHub REST, read-only by construction |
| `lib/github/commit.ts` | 247 | the only write path |

A consistent documentation style is a genuine asset here: nearly every module opens with a comment explaining *why* the design is what it is (ambiguous plpgsql variables, client-held budget, the earlier `bg-white/` selector bug). That is unusual and should be preserved through refactors.

### 5.4 Local-first layer

`lib/db.ts` uses Dexie with tables for chats, messages, folders, trash, preferences, memories and agent runs. Messages carry `variants` + `variantIndex` (branching), `steps` (agent trace), `changesetId`, `truncated`, `usage`, `sources` and `error`. Ordering uses `nextMessageTime()`: a monotonic non-decreasing timestamp so two messages created in the same millisecond cannot invert. IDs are text (UUID-ish), generated client-side, which is what lets a chat exist before any account call completes.

`lib/chatSync.ts` holds the pure merge logic (`planHandover`, `planChatMerge`, `parseRemoteChat`) so the sync policy is testable without a network; `cloudHistory.ts` performs the effect.

---

## 6. Data layer, schema and RLS

**37 tables** across 32 migrations: `profiles`, `user_preferences`, `chats`, `chat_messages`, `memories`, `folders`, `trash`, `github_connections`, `github_default`, `github_links`, `projects`, `changesets`, `approvals`, `commits`, `dew_wallets`, `dew_credits`, `dew_transactions`, `hour_sessions`, `paid_passes`, `payment_receipts`, `redeem_codes`, `redeems`, `referral_codes`, `referrals`, `shared_chats`, `push_subscriptions`, `provider_keys`, `app_admin`, `app_config`, `admin_audit`, `blocked_email_domains`, `usage_daily`, `visitor_registry`, `agent_runs`, `schema_expected`, plus migration-internal helper names.

**25 functions**, all `SECURITY DEFINER` where they move money or identity: `start_hour_session`, `end_hour_session`, `mark_hour_session_activity`, `refund_hour_session`, `auto_refund_idle_hour`, `admin_deduct_dew`, `admin_grant_plan`, `admin_user_stats`, `bump_usage`, `claim_referral`, `ensure_referral_code`, `has_paid_pass`, `is_admin`, `lookup_redeem_code`, `redeem_code_is_live`, `redeem_code_value`, `register_visitor`, `forget_visitor`, `reject_disposable_signup`, `email_domain_is_blocked`, `set_profile_timezone`, `openmi_schema_health`.

**Money design, as built.** `hour_sessions` is `owner uuid primary key` — a second live session is structurally impossible, and the migration comment explains that an advisory lock serialises two simultaneous starts. The stored `price numeric(18,3)` is what was charged. `start_hour_session()` deliberately takes **no price argument** — the constant lives inside the function, because a signed-in account can call the RPC directly and a price parameter would let it buy an hour for a thousandth of a Dew. Free daily Dew is spent first (`10`, or `15` with a pass), then paid credit. Refunds come in three flavours: explicit, idle-auto, and admin.

`chat_messages.owner` is denormalised on purpose so RLS never has to join back to `chats` on insert, which is what stops a forged `chat_id` from reading another account's thread.

`schema_expected` + `openmi_schema_health()` back the About page's migration audit, so a missing table is named instead of surfacing as `PGRST202`.

---

## 7. Security model

**Layers, strongest first.**

1. **Postgres RLS** on every table, keyed on `auth.uid()`. The browser and every route use the caller's JWT; there is no admin bypass in application code.
2. **Service role**, confined to `lib/supabaseAdmin.ts` and imported only by `/api/agent/runs*`. Owner identity is taken from the verified session, never the request body.
3. **Signed artefacts.** Change sets are SHA-256 digests of the file set (not an HMAC envelope, so the payload stays the row's columns); approvals are HMACs over `{user, repo, baseSha, hash, expiry}`. Status is deliberately **excluded** from the signature so the lifecycle label can move without invalidating the change set — the comment states that authority comes from the signature plus the branch head, never from `status` alone.
4. **Read-only GitHub client.** `lib/github/client.ts` contains GETs; every write lives in `lib/github/commit.ts`.
5. **Token sealing.** `GITHUB_TOKEN_KEY` (32-byte hex) encrypts GitHub tokens **and** users' own provider keys with AES-256-GCM, with an OAuth state signature. Reads return `••••` + last four.
6. **Transport headers** from one place in `next.config.mjs`: HSTS, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, COOP `same-origin`, a narrow `Permissions-Policy` (camera/mic self only), and a CSP whose script sources are `'self'` + `'unsafe-inline'` (+ `'unsafe-eval'` in dev only) + named ad hosts.
7. **Untrusted repository content.** The system prompt and tools treat repo text as data; `propose_edits` has no network, no token and no client; an exact-match replacement that hits zero or multiple sites is refused rather than guessed.
8. **Pre-flight review** before a proposal is shown: static checks on the exact bytes (empty file, conflict markers, JSON parse, unbalanced brackets, unresolvable relative/`@/` imports) plus one advisory model read, then a single repair round. It is explicitly *not* a build and says so.

**Honest limitations, stated by the code itself:** CSP `unsafe-inline` is required by Next's hydration bootstrap and inline styles, and the artifact preview is an `<iframe srcdoc>` that would break under `strict-dynamic`; `NEXT_PUBLIC_*` values are inlined at build time, so a key added after a build never reaches the site; rate limiting without Upstash is per-instance and resets on cold start (the `.env.example` says exactly this).

---

## 8. Configuration, testing and delivery

**Env (all optional to boot):** Supabase URL/anon key, `SUPABASE_SERVICE_ROLE_KEY`, four model keys, AdSense client/slot, Adsterra tag, Tavily, `OPENMI_ADMIN_EMAIL`, VAPID trio, `NEXT_PUBLIC_SITE_URL`, Upstash pair, Sentry quartet, `GITHUB_CLIENT_ID/SECRET`, `GITHUB_TOKEN_KEY`, `AGENT_TURN_SECRET`, `AGENT_SWEEP_SECRET`.

**Scripts:** `dev` (`next dev -H 0.0.0.0 -p ${PORT:-3000}`), `build`, `start`, `lint`, `typecheck`, `test` (32 suites run serially via `bunx tsx`), `check:migrations`.

**CI** (`.github/workflows/ci.yml`) runs three things on every push/PR: typecheck, the full test list, a production build **with no secrets** (`NEXT_PUBLIC_SITE_URL: https://ci.invalid`) to prove the app builds unconfigured, plus a separate `migrations` job that applies all 32 files **twice** to PGlite and asserts the objects the routes need. The build-with-nothing rule and the apply-twice rule are the two best ideas in the delivery setup: they catch the two failure modes that otherwise appear only in production.

**Test strategy:** 32 suites, heavily source-contract (regex over source) in places — `tests/repo-agent.test.ts` alone is 2,121 lines. That gives fast, dependency-free coverage of invariants like "the client contains no write method" and "the price table has one entry", but it cannot catch behavioural regressions in streaming, sync or the agent loop. SQL is exercised properly through PGlite.

---

## 9. Findings register

Severity: **P0** security/money break; **P1** user-visible incorrectness or a real accessibility failure; **P2** debt that makes future work slower or riskier.

| ID | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| **F-01** | P1 | Accent-filled controls are illegible in dark and ink: white on sage = **2.14:1**, white on lavender = **2.59:1** | `globals.css` `--on-accent: #ffffff` in `:root` and `html.ink`; `.on-accent{color:#fff!important}`; measured | Make `--on-accent` a near-black ink in both dark themes, as light already does (`#15130f` on orange = 5.37:1). Re-measure every filled button, chip and badge. |
| **F-02** | P1 | `--text-low` fails AA in all three themes: **3.61 / 3.40 / 4.47:1** — and it is used for 11–12px hints, `.thread-tool`, placeholders | measured §11 | Raise to ≥4.5:1 on its own canvas. Light `#4a5a52` (6.93:1 on cream) and dark `#728a7d` (5.07:1) are drop-in candidates; the ink ramp needs one step lighter. |
| **F-03** | P1 | Light/ink themes depend on ~400 lines of `!important` attribute selectors that rewrite literal utility classes; text rules use prefix matching (`text-white/1` also matches `/10`) | `globals.css` lines 209–330 | Migrate literals to semantic tokens per component, delete the override block in slices, then add a lint rule banning hex/`white/` utilities in components plus a visual regression check per theme. |
| **F-04** | P2 | "Three themes" is really two appearances + one layout-locked palette: ink is only reachable via `homeLayout: "focus"` | `lib/settings.ts` `applyDocumentTheme` | Either document it as one design (as the code comment already argues) or decouple: store `appearance: dark\|light\|ink` and treat `focus` as layout only. |
| **F-05** | P1 | README contradicts the code: "up to eight steps and 60k tokens per turn" vs `MAX_STEPS = 40`, `MAX_TURN_TOKENS = 200_000`; "one flat Code charge per turn" vs hour-based billing with no per-message charge; "Phase 2 complete, Phase 3 deferred" while `agent_runs`, tick, cancel and sweep all ship | README vs `lib/agent/turns.ts:17,19`, `supabase/migrations/20261028000200_charge_dew.sql` | Regenerate the README feature and pricing sections from the code, and add a test that asserts the documented limits equal the constants. |
| **F-06** | P2 | Foreground agent budget is client-held signed state, so replaying an older token resets `steps`/`tokens`; there is no server-side monotonic counter on that path (background runs do have `agent_runs` rows) | `lib/agent/turns.ts` comment + `advanceTurn`; `lib/agent/run.ts` | Mirror `step_n` in a server row keyed by turn id with a conditional update, or accept the exposure explicitly and document it as bounded by the prepaid hour. |
| **F-07** | P2 | No `middleware.ts`: `/chat` is served publicly and gated client-side; only data is protected | absent from tree; `app/chat/page.tsx` gate; per-route `verifyCaller` | Optional edge middleware to redirect signed-out `/chat` traffic and save the shell paint, plus a `noindex` already present. Not a data leak — RLS is the authority. |
| **F-08** | P2 | Rate limiting degrades to per-instance counters when Upstash is unset, so a serverless deployment can exceed the stated policy | `.env.example` says so; `lib/serverControl.ts` | Make production refuse to boot without a shared limiter, or move to a Postgres token bucket. |
| **F-09** | P2 | Public share reads have no rate-limited endpoint: `/api/share/[id]` exposes only `DELETE`; the view reads the table directly under RLS | route inventory | Add a capped public read route (or an RPC) so enumeration and scraping are bounded. |
| **F-10** | P2 | Message ordering is client-clock based (`nextMessageTime` monotonic per client), not a server sequence; two devices can interleave and tie | `lib/db.ts:404` | Add a server-assigned `seq` per chat (RPC on insert) and order by it, keeping `createdAt` for display. |
| **F-11** | P2 | Test suite is dominantly source-contract; no browser or E2E layer, so streaming, sync conflicts and the composer are untested at runtime | `tests/*` (32 files, 2,121-line agent test) | Add a thin Playwright set for sign-in, send/stream/stop, approve/commit refusal, and theme contrast snapshot. |
| **F-12** | P3 | CSP allows `'unsafe-inline'` scripts; the artifact preview is the stated reason | `next.config.mjs` | Serve the preview from a separate origin and move to nonces/`strict-dynamic`. |

**What is genuinely good and should not be "improved" away:** the single charge function with no price parameter; `owner` as the `hour_sessions` primary key; signed change sets over `baseSha` + content hash with status excluded; the read-only GitHub client separated from one write module; service-role confinement; CI building with zero secrets and replaying migrations twice; and the explanatory comment style across `lib/`.

---

## 10. Recommended build sequence

Ordered by risk removed per unit of work, not by feature appeal.

| Phase | Work | Exit gate |
|---|---|---|
| **0 — Truth** | Fix F-05 (docs to code), add the limit-consistency test, publish this audit as the reference | README limits, prices and phase claims match constants asserted by a test |
| **1 — Theme integrity** | F-01, F-02, then F-03 in component slices; add contrast + missing-token test; ban literals in components | Every text pair ≥4.5:1; every accent fill ≥4.5:1; no `!important` theme block remains |
| **2 — Money and budget hardening** | F-06 server-side turn counter, F-08 durable limiter, F-10 server `seq` | Replayed step is rejected; limiter survives restart; two-device sync test passes |
| **3 — Edge and abuse surface** | F-07 optional middleware, F-09 share read cap, F-12 preview origin | Signed-out `/chat` redirects; share reads are rate limited |
| **4 — Runtime confidence** | F-11 Playwright slice on critical paths | Streaming, stop, approve, commit-refusal covered in CI |
| **5 — Phase 3 product** | Real execution sandbox (clone, install, typecheck, test, preview) behind the existing approval gate | The review card can say "tests passed" truthfully, and says nothing when it cannot |

Phase 5 is the deferred "execution" work the spec describes; everything before it is hardening of what already ships.

---

## 11. Appendix: measured contrast

Computed with WCAG 2.1 relative luminance over the exact hex values in `app/globals.css`. `AA` = ≥4.5:1, `AA-large` = ≥3:1, `FAIL` = below 3:1.

| Theme | Pair | Ratio | Verdict |
|---|---|---|---|
| dark | `--text-hi` on `--bg` | 17.00 | AA |
| dark | `--text` on `--bg` | 13.55 | AA |
| dark | `--text-mid` on `--bg` | 6.98 | AA |
| dark | `--text-low` on `--bg` | 3.61 | AA-large only |
| dark | `--accent` on `--bg` | 8.80 | AA |
| dark | `--on-accent` on `--accent` | **2.14** | **FAIL** |
| dark | bubble text on `--bubble-user` | 6.33 | AA |
| light | `--text-hi` on `--bg` | 16.41 | AA |
| light | `--text` on `--bg` | 13.11 | AA |
| light | `--text-mid` on `--bg` | 5.36 | AA |
| light | `--text-low` on `--bg` | 3.40 | AA-large only |
| light | `--accent` on `--bg` | 3.05 | AA-large only |
| light | `--on-accent` on `--accent` | 5.37 | AA |
| light | bubble text on `--bubble-user` | 5.37 | AA |
| ink | `--text-hi` on `--bg` | 15.41 | AA |
| ink | `--text` on `--bg` | 12.54 | AA |
| ink | `--text-mid` on `--bg` | 6.97 | AA |
| ink | `--text-low` on `--bg` | 4.47 | AA-large only |
| ink | `--accent` on `--bg` | 6.73 | AA |
| ink | `--on-accent` on `--accent` | **2.59** | **FAIL** |
| ink | bubble text on `--bubble-user` | 8.75 | AA |

---

*Audited branch `test` @ `08a049d`. Every claim above is traceable to a file in that tree; measured values are reproducible with the WCAG luminance formula over the tokens in `app/globals.css`.*
