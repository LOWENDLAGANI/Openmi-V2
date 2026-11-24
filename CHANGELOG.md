# Changelog

All notable and small changes to Openmi are documented in this file and mirrored in `lib/version.ts` (and `package.json`).

## [2.0.5] - 2026-11-24 — Fresh branch HEAD resolution & automatic clean workspace sync

- Always resolve the remote branch's live `HEAD` on GitHub when creating a new chat in `POST /api/chat` instead of trusting a stale client-supplied SHA inherited from an older conversation.
- Stopped copying the previous chat's `repo_base_sha` into draft chats in `app/chat/page.tsx` so new conversations start unpinned until resolved on send.
- Auto-pull existing chats via `pullChatBranch` before queuing a run in `POST /api/chat` and `POST /api/runs` when the remote branch has moved ahead and the sandbox has no uncommitted changes, triggering a fresh workspace reseed while preserving dirty workspaces.

## [2.0.4] - 2026-11-24 — Worker keepalive, graceful shutdown & failed-turn recovery on reload

- Added a 4-minute self-keepalive ping to `/healthz` while runs are active in the worker so free web-service hosts (Render) do not spin down and `SIGKILL` in-flight runs after 15 minutes without inbound HTTP traffic.
- Wired worker `SIGTERM`/`SIGINT` `stopSignal` into `executeRun` so a restarting worker aborts cleanly and persists partial text and steps before shutdown.
- Kept nudging `wakeWorker()` from the chat SSE stream and `/api/chat/turn` while a run is still queued, recovering from cold-start wake misses.
- Surfaced the latest failed or stalled run's error (and Retry action) in `app/chat/page.tsx` and preserved live progress on poll errors in `ChatPanel` so reaped turns no longer vanish silently on reload.

## [2.0.3] - 2026-11-24 — Seamless stream handover & paginated background run polling

- Lowered chat SSE stream handover window from 240s to 50s (with 24 continuation windows) so runs seamlessly reconnect before 60s serverless/proxy timeouts.
- Stopped freezing partial output as a "stopped" message when an active stream drops; live text and steps now stay active and hand off smoothly to background polling.
- Paginated `/api/chat/turn` progress reads across multiple batches of `RUN_PROGRESS_EVENTS` (and included live reasoning) so long runs never freeze after 600 events.

## [2.0.2] - 2026-11-24 — Inline tool & terminal flow and always-visible running status

- Interleaved tool calls and terminal runs inline alongside assistant text in chronological order instead of stacking all steps at the top of the message.
- Kept the live thinking/running indicator visible at the bottom of the active turn even after partial assistant text has arrived or while continuing in the background.
- Replaced the static ellipsis on in-progress steps with a live spinner and forwarded shell commands on tool start events.
- Enabled the Composer Stop button and disabled new sends while a run is active in the background as well as during live streaming.

## [2.0.1] - 2026-11-24 — Problem reporting with screenshots, suggestions & admin review

- Added Report a problem page (`/report`) allowing users to report bugs, attach PNG/JPEG/WebP screenshots (verified by file signature), and view status updates.
- Added Suggestions page (`/suggestions`) allowing users to submit feature requests and track team responses.
- Added dedicated Admin Feedback panel (`/admin/feedback`) to inspect bug reports, preview uploaded screenshots, filter by kind/status, and post responses.
- Added database migration `059_user_feedback.sql` with RLS policies, security-definer submission/review RPCs, and private `feedback` storage bucket.
- Linked Report problem and Suggestions in the workspace sidebar and public footers.

## [2.0.0] - 2026-11-24 — Version tracking & structured changelog

- Added explicit version number (`v2.0.0`) across the workspace sidebar, landing footer, and About page.
- Added interactive in-app Changelog modal and `CHANGELOG.md` so every small change is documented.
- Trimmed redundant explanatory copy across landing, pricing, login, about, activity, and billing pages.
- Removed Auto model selector and updated invite rewards to trigger on the invitee's first paid pass.
- Added public `/pricing` page, OpenGraph card generation, updated interactive workbench preview, and `?ref` invite flow.
- Overhauled interface to the Openmi V2 Precision Developer Platform design system.
