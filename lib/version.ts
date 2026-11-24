/**
 * Single source of truth for the application version and structured changelog.
 *
 * Every change — no matter how small — must bump `APP_VERSION` (matching
 * `package.json` and `CHANGELOG.md`) and prepend a new entry to `CHANGELOG`.
 */

export type ChangelogEntry = {
  version: string;
  date: string;
  title: string;
  changes: string[];
};

export const APP_VERSION = "2.0.8";
export const APP_VERSION_TAG = `v${APP_VERSION}`;

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: "2.0.8",
    date: "2026-11-24",
    title: "Real-time active users & last visitor monitor in Admin panel",
    changes: [
      "Added migration 060_user_presence.sql with service-role-only RLS table public.user_presence to track live member and guest heartbeats.",
      "Added POST /api/presence and a global PresenceBeacon in app/layout.tsx sending lightweight same-origin heartbeats every 30s while a tab is visible.",
      "Added GET /api/admin/presence, lib/admin/presence.ts (with graceful fallback to recent chat/run activity before migration push), and PresencePanel in /admin polling every 10s to show currently online members/guests, the last user on the website, and recent visitors.",
    ],
  },
  {
    version: "2.0.7",
    date: "2026-11-24",
    title: "30-minute run limit & 3-attempt stuck-test handoff",
    changes: [
      "Increased the default run wall-clock limit and run sandbox idle timeout from 15 minutes to 30 minutes (with RUN_MAX_MINUTES configurable up to 60 minutes) and raised the ChatPanel SSE stream continuation window cap from 24 to 75 to cover full long runs.",
      "Added RUN_STUCK_TEST_CLAUSE to the agent system prompt so if a test, build, or verification command stays stuck or failing after 3 fix attempts, the agent stops looping, hands the current code back to the user with the error details, and asks for next instructions.",
    ],
  },
  {
    version: "2.0.6",
    date: "2026-11-24",
    title: "True task kill on Stop & stuck-run recovery",
    changes: [
      "Added live cancellation polling (RUN_CANCEL_POLL_MS) and a per-run AbortController in executeRun so clicking Stop immediately aborts in-flight LLM streams without falling back across providers and preserves streamed partial text.",
      "Made SandboxHandle.exec abortable using background execution and handle.kill() (SIGKILL) so active sandbox commands terminate right away on Stop while keeping the chat workspace disk intact.",
      "Added forceCancelRun and killRun in lib/runs/store.ts and wired them into POST /api/chat/stop and POST /api/runs/[id]/cancel so hung or unresponsive runs are force-settled to cancelled, clear chat_sandboxes leases, emit run.finished, and refund empty turns.",
      "Guarded chat_sandboxes lease renewal/release and worker finalization against zombie-worker races after force-cancellation.",
      "Fixed the Composer Stop button in ChatPanel to keep its stopping state until termination confirms, support stopping draft/any active runs, and offer a one-click 'Stop running task & retry' recovery action on concurrency conflicts.",
    ],
  },
  {
    version: "2.0.5",
    date: "2026-11-24",
    title: "Fresh branch HEAD resolution & automatic clean workspace sync",
    changes: [
      "Always resolve the remote branch's live HEAD on GitHub when creating a new chat in POST /api/chat instead of trusting a stale client-supplied SHA inherited from an older conversation.",
      "Stopped copying the previous chat's repo_base_sha into draft chats in app/chat/page.tsx so new conversations start unpinned until resolved on send.",
      "Auto-pull existing chats via pullChatBranch before queuing a run in POST /api/chat and POST /api/runs when the remote branch has moved ahead and the sandbox has no uncommitted changes, triggering a fresh workspace reseed while preserving dirty workspaces.",
    ],
  },
  {
    version: "2.0.4",
    date: "2026-11-24",
    title: "Worker keepalive, graceful shutdown & failed-turn recovery on reload",
    changes: [
      "Added a 4-minute self-keepalive ping to /healthz while runs are active in the worker so free web-service hosts (Render) do not spin down and SIGKILL in-flight runs after 15 minutes without inbound HTTP traffic.",
      "Wired worker SIGTERM/SIGINT stopSignal into executeRun so a restarting worker aborts cleanly and persists partial text and steps before shutdown.",
      "Kept nudging wakeWorker() from the chat SSE stream and /api/chat/turn while a run is still queued, recovering from cold-start wake misses.",
      "Surfaced the latest failed or stalled run's error (and Retry action) in app/chat/page.tsx and preserved live progress on poll errors in ChatPanel so reaped turns no longer vanish silently on reload.",
    ],
  },
  {
    version: "2.0.3",
    date: "2026-11-24",
    title: "Seamless stream handover & paginated background run polling",
    changes: [
      "Lowered chat SSE stream handover window from 240s to 50s (with 24 continuation windows) so runs seamlessly reconnect before 60s serverless/proxy timeouts.",
      "Stopped freezing partial output as a 'stopped' message when an active stream drops; live text and steps now stay active and hand off smoothly to background polling.",
      "Paginated /api/chat/turn progress reads across multiple batches of RUN_PROGRESS_EVENTS (and included live reasoning) so long runs never freeze after 600 events.",
    ],
  },
  {
    version: "2.0.2",
    date: "2026-11-24",
    title: "Inline tool & terminal flow and always-visible running status",
    changes: [
      "Interleaved tool calls and terminal runs inline alongside assistant text in chronological order instead of stacking all steps at the top of the message.",
      "Kept the live thinking/running indicator visible at the bottom of the active turn even after partial assistant text has arrived or while continuing in the background.",
      "Replaced the static ellipsis on in-progress steps with a live spinner and forwarded shell commands on tool start events.",
      "Enabled the Composer Stop button and disabled new sends while a run is active in the background as well as during live streaming.",
    ],
  },
  {
    version: "2.0.1",
    date: "2026-11-24",
    title: "Problem reporting with screenshots, suggestions & admin review",
    changes: [
      "Added Report a problem page (/report) allowing users to report bugs, attach PNG/JPEG/WebP screenshots (verified by file signature), and view status updates.",
      "Added Suggestions page (/suggestions) allowing users to submit feature requests and track team responses.",
      "Added dedicated Admin Feedback panel (/admin/feedback) to inspect bug reports, preview uploaded screenshots, filter by kind/status, and post responses.",
      "Added database migration 059_user_feedback.sql with RLS policies, security-definer submission/review RPCs, and private feedback storage bucket.",
      "Linked Report problem and Suggestions in the workspace sidebar and public footers.",
    ],
  },
  {
    version: "2.0.0",
    date: "2026-11-24",
    title: "Version tracking & structured changelog",
    changes: [
      "Added explicit version number (v2.0.0) across the workspace sidebar, landing footer, and About page.",
      "Added interactive in-app Changelog modal and CHANGELOG.md so every small change is documented.",
      "Trimmed redundant explanatory copy across landing, pricing, login, about, activity, and billing pages.",
      "Removed Auto model selector and updated invite rewards to trigger on the invitee's first paid pass.",
      "Added public /pricing page, OpenGraph card generation, updated interactive workbench preview, and ?ref invite flow.",
      "Overhauled interface to the Openmi V2 Precision Developer Platform design system.",
    ],
  },
];
