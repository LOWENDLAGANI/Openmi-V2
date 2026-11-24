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

export const APP_VERSION = "2.0.4";
export const APP_VERSION_TAG = `v${APP_VERSION}`;

export const CHANGELOG: readonly ChangelogEntry[] = [
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
