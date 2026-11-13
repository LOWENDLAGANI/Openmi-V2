# Openmi — feature audit against the full spec

**Date:** 3 November 2026
**Scope:** the `main` branch of this repository (`7d07d16` at the time of writing).
**Method:** every row below was checked against the source, not against the README or the
build-phase notes. Evidence is a file path. Where a thing exists in a different shape than
the spec describes, it is marked **Partial** and the difference is spelled out.

**Legend:** ✅ implemented · 🟡 partially implemented / different shape · ❌ not implemented

**Totals:** 126 audited items — **31 ✅**, **26 🟡**, **69 ❌**.

The single most important line in this document is the first one under
[Divergences](#divergences-from-the-spec): the spec describes a **local-first, IndexedDB**
app, and this repository is a **server-first, Supabase/Postgres** app. Several "missing"
items are missing because that whole layer is different, not because a button was forgotten.

---

## 1. Core chat

| # | Feature | Status | Where / why |
|---|---|---|---|
| 1 | Streamed chat with live "watch it think" rendering | ✅ | `app/api/chat/route.ts` (SSE), `components/ChatPanel.tsx`, `components/AiThinking.tsx` |
| 2 | Multi-turn history inside a chat | ✅ | `lib/messages.ts`, migrations `011_chat_runtime`, `012_chat_history` |
| 3 | Three modes: Openmi Auto / Code / Flash | ❌ | `lib/models.ts` is a flat model catalogue (`auto`, GPT OSS, GLM, Qwen3 Coder, Kimi, DeepSeek, Llama). There is no mode layer and no `flash` model. |
| 4 | Per-chat mode isolation, Code pinned to Groq | ❌ | Only the chosen model id is stored per chat; no mode pinning. |
| 5 | Stop a stream at any moment | ✅ | `app/api/chat/stop/route.ts` sets the server flag; `ChatPanel.stop()` aborts the view. |
| 6 | Context ring in composer with breakdown popover, red when full, "start a new chat" | 🟡 | `components/ContextCircle.tsx` does all of that — but the breakdown is **characters**, not tokens per part. |

## 2. Message quality controls

| # | Feature | Status | Where / why |
|---|---|---|---|
| 7 | Response length: Short / Balanced / Detailed | ❌ | No setting, no prompt wiring. |
| 8 | Reasoning effort: Low / Medium / High | ❌ | `reasoning` exists only as a model *category*, not a control. |
| 9 | Retry a message, keeping the old answer as a branch point | 🟡 | `ChatPanel.retry()` re-sends the last prompt; the new answer is appended, but there is no branch/variant model or UI. |
| 10 | Edit a user message and re-run | 🟡 | The "edit" button copies the text into the composer; the user must send again. No automatic re-run against the new wording. |
| 11 | Switch between answer variants | ❌ | No variant storage. |
| 12 | Copy the whole conversation | ❌ | Only per-message copy (`ChatPanel.copy`). |

## 3. Attachments

| # | Feature | Status | Where / why |
|---|---|---|---|
| 13 | Paste images, drag-and-drop | ❌ | Composer has no attachment path. |
| 14 | Up to 4 images, auto-compressed | ❌ | — |
| 15 | Camera capture | ❌ | — |
| 16 | Gallery picker | ❌ | — |
| 17 | Files up to 100 KB, 3 per message, 13 extensions | ❌ | — |
| 18 | Document content injected into the prompt | ❌ | `lib/context.ts` assembles repo context only. |
| 19 | Size labels on attachment previews | ❌ | — |
| 20 | Remove an attachment or document | ❌ | — |

## 4. Voice input

| # | Feature | Status | Where / why |
|---|---|---|---|
| 21 | Dictation button in the composer | ❌ | No `SpeechRecognition` anywhere. |
| 22 | Fallback message when unsupported | ❌ | — |
| 23 | Transcript appended to existing text | ❌ | — |

## 5. Suggestion chips

| # | Feature | Status | Where / why |
|---|---|---|---|
| 24 | Six chips that write (never send) into the composer | ✅ | `components/QuickActions.tsx`: Explain this repo, Find a bug, Review changes, Write a test, Plan a feature, Summarise a file. |

## 6. Conversation management

| # | Feature | Status | Where / why |
|---|---|---|---|
| 25 | Create new chats | ✅ | `/chat?new=1`, `app/chat/page.tsx`. |
| 26 | Temporary chat that is never saved | ❌ | Every chat is a database row; no ephemeral mode. |
| 27 | Recent list sorted by updated time, pinned chats float | 🟡 | Sorted by `updated_at` in `app/chat/page.tsx`; no pinning. |
| 28 | Hold-to-open menu: Pin / Move / Rename / Delete | 🟡 | A `details` menu offers **Move to folder** and **Move to trash**; no pin, no rename, no long-press/swipe. |
| 29 | In-place rename of a chat title | ❌ | `renameFolder` exists in `app/chat/actions.ts`; there is no `renameChat`. |
| 30 | Titles auto-generated from the first message | ❌ | The only title write is the literal `"New chat"` at `app/api/chat/route.ts:116`. |
| 31 | Delete moves to Trash first | ✅ | `trashChat` sets `deleted_at`; `restoreChat`, `purgeChat`, `emptyTrash` alongside. |

## 7. Folders

| # | Feature | Status | Where / why |
|---|---|---|---|
| 32 | Create folders from the sidebar | ✅ | `createFolder` + form in `components/Sidebar.tsx`. |
| 33 | Filter the recent list by folder | 🟡 | Folders are collapsible **groups**, not filter chips with an "All" state. |
| 34 | Create a folder from a chat's move menu in one step | ❌ | The move form only lists existing folders. |
| 35 | Remove a folder, chats kept | ✅ | `deleteFolder`; the FK nulls `folder_id` rather than cascading. |
| 36 | Folder state belongs to the account | ✅ | `folders` table with RLS (`002_chats.sql`). |

## 8. Trash

| # | Feature | Status | Where / why |
|---|---|---|---|
| 37 | Restore from any device | ✅ | `restoreChat` + `/chat?trash=1`. |
| 38 | Trash **overlay** with restore | 🟡 | It is a dedicated view, not an overlay. |
| 39 | Auto-purge after 30 days | ❌ | Nothing expires trash on load; rows persist until purged. |
| 40 | Trash count badge on the sidebar icon | 🟡 | The count is printed next to the "Trash" row; there is no icon badge. |

## 9. Cloud sync / account

| # | Feature | Status | Where / why |
|---|---|---|---|
| 41 | Sign-in required; Google, GitHub, Microsoft, email+password | 🟡 | Email+password (`components/AuthForm.tsx`) and Google OAuth through Supabase (used by the admin gate). GitHub/Microsoft buttons do not exist. |
| 42 | Chats, folders, trash sync to the account | ✅ | Supabase tables with RLS, migrations `001`–`013`. |
| 43 | Preferences sync to the account | ❌ | The only preference (theme) is `localStorage`. |
| 44 | Device handover clears the previous account's local rows | ❌ | There is no local row store to clear (server-first). |
| 45 | Display name from the account with a fallback | ❌ | The email is shown (`Sidebar`), no display-name read. |
| 46 | Avatar in profile/preferences | ❌ | `profiles` has no avatar column. |
| 47 | Specific signed-out / unconfigured / unreachable states | ✅ | `lib/session.ts` states, `/login`, `/setup`, per-page guards. |

## 10. Preferences (Settings panel)

| # | Feature | Status | Where / why |
|---|---|---|---|
| 48 | Appearance: Dark / Light (spec) | 🟡 | Three themes (paper default, carbon, ink) with a switcher in every header — but no settings panel and no account sync. |
| 49 | Home layout: Classic / Focus · ink | ❌ | No layout mode; "ink" exists only as a theme. |
| 50 | Web search: Auto / On / Off with key status | ❌ | No web search at all. |

## 11. API keys

| # | Feature | Status | Where / why |
|---|---|---|---|
| 51 | Per-mode keys entered in the app | 🟡 | Provider keys come from server env (`lib/env.ts`, `lib/providers.ts`); there is no in-app key entry. Keys are never returned to the browser. |
| 52 | `openmi:keys-changed` event refreshes availability | ❌ | No such event; availability is computed per request (`modelCatalogue()`). |

## 12. Your data controls

| # | Feature | Status | Where / why |
|---|---|---|---|
| 53 | Export full backup as JSON | ❌ | — |
| 54 | Import a backup with counts | ❌ | — |
| 55 | Clear all data with a 4-second confirm | ❌ | `ConfirmSubmit` exists for destructive server actions, but there is no "clear everything" path. |
| 56 | `openmi:data-wiped` event resets the thread | ❌ | — |

## 13. Repository agent

| # | Feature | Status | Where / why |
|---|---|---|---|
| 57 | Connect GitHub via OAuth round-trip **or** a pasted token | ✅ | OAuth App round-trip in `app/auth/github/route.ts` and `app/auth/github/callback/route.ts`, with a state cookie and a form-encoded code exchange (`lib/oauth/`). The pasted token remains the fallback (`app/github/actions.ts`, `lib/github/token.ts`); both write the same sealed AES-256-GCM row. |
| 58 | Read-only tree, file viewer, sizes, capped list | ✅ | `components/Workspace.tsx`, `lib/github/read.ts` (caps: 5,000 entries, 200 KB view, 2,000 lines). The tree is the repo as GitHub returns it; there is no dependency/build-output filter list. |
| 59 | Agent loop with live steps, streaming prose, Stop | ✅ | `lib/agent/run.ts`, `lib/agent/tools.ts`, `app/api/chat/route.ts` step events. |
| 60 | Turn a read-only answer into a proposed diff | ✅ | `propose` tool → `lib/changesets.ts` → `components/ReviewPanel.tsx`. |
| 61 | Never commits; approval opens one branch + PR | ✅ | `lib/changesets/commit.ts` + `lib/github/write.ts` (default branch refused, asserted in tests). |
| 62 | Repo chip with green dot, "Leave repo" | 🟡 | The chip exists in `ChatPanel` with a state dot; there is no detach action (disconnect lives on the workspace page). |
| 63 | Focus home shows the repo chip above the composer | ❌ | No Focus layout. |

## 14. Pricing / billing (Dew)

| # | Feature | Status | Where / why |
|---|---|---|---|
| 64 | Currency is Dew | ✅ | `lib/dew.ts`, `lib/billing/plans.ts`. |
| 65 | Balance shown in the **sidebar** | 🟡 | The Dew pill is in the workspace header (`app/chat/page.tsx` actions), not the sidebar. |
| 66 | Amber when low | ✅ | `isLowBalance`, `LOW_BALANCE_DEW`. |
| 67 | "Top up" route to `/plus` | 🟡 | The route is `/pay`. |
| 68 | Per-request billing | ❌ | Billing is **per hour session** (`start_hour_session`, `DEW_PER_HOUR`). |
| 69 | Hour session for Flash, banner while active, End button | 🟡 | Hour sessions exist for any model and the server owns the start (`lib/dew/store.ts`), but the running-hour banner lives on `/activity` and there is no End button. |
| 70 | Pricing dialog on the first Flash message (this message vs 1 hour) | ❌ | No dialog; the hour is charged by the server. |
| 71 | Hour-conflict options (continue there / end / just this one) | ❌ | — |
| 72 | Refused message shows a live countdown | 🟡 | `lib/rate-limit.ts` returns `retryAfterSeconds` and the message includes the number; nothing ticks down. |
| 73 | Daily free Dew + paid wallet + paid pass | ✅ | `014_six_dew_daily.sql`, `dew_transactions`, `profiles.has_paid`. |

## 15. Search / command palette

| # | Feature | Status | Where / why |
|---|---|---|---|
| 74 | Ctrl/Cmd+K opens search from anywhere | ❌ | No palette, no `keydown` handler. |
| 75 | Search chat titles and message text | ❌ | The workspace search (`lib/github/read.ts searchCode`) searches **GitHub code**, not chats. |
| 76 | Local-only search | ❌ | — |
| 77 | Opens the matched chat on pick | ❌ | — |

## 16. Install / PWA

| # | Feature | Status | Where / why |
|---|---|---|---|
| 78 | Service worker in production with `clients.claim()` | ❌ | No `sw.js`, no registration. |
| 79 | `beforeinstallprompt` capture + install button | ❌ | — |
| 80 | Mobile install prompt once after the first message | ❌ | — |
| 81 | iOS "Add to Home Screen" instructions | ❌ | — |
| 82 | Already-installed detection | ❌ | — |

## 17. Splash screen

| # | Feature | Status | Where / why |
|---|---|---|---|
| 83 | Full-screen artwork, landscape/portrait variants | ❌ | No splash component and no `openmi-splash*.jpg` assets. |
| 84 | Hold ~1.6 s, blur+fade ~1.1 s | ❌ | — |
| 85 | Skipped on return visits, reloads, `/about` | ❌ | — |

## 18. Onboarding tutorial

| # | Feature | Status | Where / why |
|---|---|---|---|
| 86 | 7-step overlay highlighting real elements | ❌ | No tutorial component. |
| 87 | Progress dots, Skip/Next/Start, Escape/ArrowRight | ❌ | — |
| 88 | Per-step highlight colours | ❌ | — |
| 89 | Remembers "done" per browser | ❌ | — |

## 19. Branding / assets

| # | Feature | Status | Where / why |
|---|---|---|---|
| 90 | SVG sparkle mark as the primary, logo PNG fallback | 🟡 | Inverted from the spec, on your instruction: the uploaded PNG is primary and the sparkle SVG is the fallback (`components/OpenmiMark.tsx`). |
| 91 | FocusMark (two interlocking F-shapes) | ❌ | — |
| 92 | OG image (`/openmi-splash.jpg`) | ❌ | No `opengraph-image`, no asset. |
| 93 | Favicon, `apple-touch-icon`, 192/512/maskable, manifest | ✅ | `app/icon.png`, `app/apple-icon.png`, `public/icon-*.png`, `public/manifest.webmanifest`, wired in `app/layout.tsx`. |
| 94 | Mark used everywhere | ✅ | `Brand`, sidebar, about gate, spinner, empty states. |

## 20. Three visual themes

| # | Feature | Status | Where / why |
|---|---|---|---|
| 95 | Dark, Light, Ink with the spec palettes | ✅ | `app/globals.css` (`:root`, `html.light`, `html.ink`), gated by `scripts/check-contrast.mjs`. Muted greys were lifted to clear 4.5:1. |
| 96 | Ink has its own mark | ❌ | Ink reuses the same mark. |
| 97 | Theme choice persists and is applied before paint | ✅ | Bootstrap script in `app/layout.tsx`, `ThemeSwitcher` writes `localStorage`. |

## 21. Admin console and features

| # | Feature | Status | Where / why |
|---|---|---|---|
| 98 | 10 taps on the About logo opens the gate | ✅ | `components/AboutLogoGate.tsx` + `lib/admin/gesture.ts` (fixed this week: it was an unreachable quadrant sequence). |
| 99 | Admin panel is lazy-loaded, off the main bundle | ❌ | `/admin` is a normal server-rendered route. |
| 100 | Maintenance-mode gate for the whole app | ❌ | No maintenance flag or screen. |
| 101 | Admin controls: receipts, Dew grants, role grants | ✅ | `app/admin/page.tsx`, `app/admin/actions.ts`, `013_admin_payments.sql`. |

## 22. Service worker UI

| # | Feature | Status | Where / why |
|---|---|---|---|
| 102 | `sw.js` in `/public`, registered in production only | ❌ | — |
| 103 | `ServiceWorker.tsx` mounts registration | ❌ | — |

## 23. Ads

| # | Feature | Status | Where / why |
|---|---|---|---|
| 104 | Optional unit above the composer, height reserved | 🟡 | `components/AdSlot.tsx` + `lib/ads.ts` reserve real boxes, but slots sit on the landing, about, activity and pay pages — not above the chat composer. |
| 105 | Killed when `adsEnabled` is off or ids are missing | ✅ | `lib/ads.ts` `buildAdConfig`, `parseAdKey`. |
| 106 | Never on sign-in, temporary chats, Focus home | 🟡 | No ad on `/login` or in `/chat`; temporary chats and Focus home do not exist. |

## 24. Announcements

| # | Feature | Status | Where / why |
|---|---|---|---|
| 107 | Admin announcements banner read live | ❌ | — |
| 108 | Model notices as a pill | 🟡 | The turn pipeline emits `notice` strings and `ChatPanel` renders them as a list; there is no model/web-search notice. |
| 109 | "LG FAILED" cloud-logging alert | ❌ | — |

## 25. Accessibility

| # | Feature | Status | Where / why |
|---|---|---|---|
| 110 | Every icon button has `aria-label` and `title` | 🟡 | Most do (`Sidebar`, `ChatPanel`, `ContextCircle`, `ThemeSwitcher`); not audited exhaustively and not test-enforced. |
| 111 | Tutorial/search/settings/repo/pricing/install are real dialogs with Escape | 🟡 | Only one `role="dialog"` exists (the admin gate); the mobile drawer closes on Escape. Several spec'd dialogs do not exist. |
| 112 | Context ring label carries used/budget numbers | ✅ | `ContextCircle` `aria-label`. |
| 113 | Reduced-motion fallback on all animations | ✅ | Global block in `app/globals.css`. |
| 114 | Focus-visible styles throughout | ✅ | Base `:focus-visible` rule, enforced by the contrast gate. |

## 26. Animations

| # | Feature | Status | Where / why |
|---|---|---|---|
| 115 | Staggered entrance on the chat list | 🟡 | `.animate-enter` is on page shells; chat rows are not staggered. |
| 116 | Sidebar / settings / repo panel slide + fade | 🟡 | The mobile drawer slides; there are no settings or repo panels to slide. |
| 117 | Dropdowns pop in | ✅ | `.animate-pop` on the chat menu and the admin card. |
| 118 | Ring, streaming blocks, typing glow, caret, halo, sheen, blink | 🟡 | The ring transition and `.stream-cursor` exist; `animate-halo`, `animate-sheen`, `animate-blink` are defined but **unused**, and there is no typing glow. |
| 119 | Install prompt rises in | ❌ | No install prompt. |
| 120 | Splash holds then blurs out | ❌ | No splash. |
| 121 | Motion is transform + opacity only | ✅ | Keyframes use transform/opacity; check before adding new ones. |

## 27. Offline / local-first

| # | Feature | Status | Where / why |
|---|---|---|---|
| 122 | Dexie (IndexedDB) stores chats, messages, folders, trash | ❌ | Not a dependency; all reads are Supabase queries. |
| 123 | Preferences load locally first, then sync | ❌ | Theme only, local only. |
| 124 | Temporary chat fully in memory | ❌ | — |
| 125 | `useLiveQuery` reactivity | ❌ | Server components + `router.refresh()`. |
| 126 | Rate-limit countdown ticks locally | ❌ | — |

---

## Divergences from the spec

These are not bugs; they are places where the spec describes a different product than the
one in this repository. Each one changes how a "missing" feature should be built.

1. **Data architecture.** The spec is local-first: Dexie, IndexedDB, live queries, device
   handover, local-only search. This repo is server-first: Postgres + RLS, server components,
   server actions, `router.refresh()`. Items 44, 53–56, 122–126 are all consequences of that.
   Adopting local-first is an architecture decision, not a task.
2. **Billing model.** Spec: per-request billing with a pricing dialog and per-mode costs.
   Repo: one hour session charged once before the provider call (`DEW_PER_HOUR`), with
   refunds and daily allowance. Items 68–71 follow from that model.
3. **Model modes.** Spec: three modes (Auto/Code/Flash) with provider pinning and
   availability warnings. Repo: a model catalogue with a per-chat model id and provider keys
   read from env. Item 3–4 is a product-layer change over a working picker.
4. **Brand.** Spec: the SVG sparkle is primary and the PNG is a fallback. Repo (per your
   instruction): the uploaded PNG is primary, sparkle is the fallback, with an inverted copy
   for dark surfaces.
5. **Themes.** Spec: dark/light + an "ink" Focus *layout*. Repo: paper/carbon/ink as three
   colour themes, with the Focus layout not built. Some spec'd ink details (its own mark,
   focus composer, focus marks) belong to that layout.

## Suggested order (small, shippable steps)

Grouped so each step is useful on its own and does not require the architecture change:

1. **Chat table stakes** — pin + rename a chat (migration, `renameChat`/`pinChat` actions,
   menu items, pin icon in rows), auto-title from the first message. Small, DB-shaped.
2. **Settings + preferences** — a settings panel (dialog) for theme, response length and
   reasoning effort; store on `profiles` so it syncs, with the theme still applied pre-paint.
3. **Data controls** — export/import JSON of chats, messages and folders; a scoped "clear my
   chats" with the existing confirm pattern.
4. **Message quality** — retry-as-branch with variant switching, edit-and-rerun, copy whole
   conversation. Needs a small `message_variants` model.
5. **Search palette** — Cmd/Ctrl+K over titles and message bodies, server-side under RLS
   (a local-only search is incompatible with this data layer).
6. **Attachments and voice** — client-side only until the API accepts document text and
   images; needs a size/compression policy and a provider that accepts images.
7. **PWA finish** — `sw.js` + registration + install prompt; icons and manifest are already
   in place, so this is the smallest remaining chunk of the spec.
8. **Announcements and maintenance** — one table, one banner, one gate in the middleware.
9. **Splash and tutorial** — both need artwork/assets (splash) and a decision about which
   real UI targets the tour should point at.
10. **Local-first layer** — only if you actually want offline Dexie; treat it as its own
    project with a migration path, not as a feature ticket.
