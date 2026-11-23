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

export const APP_VERSION = "2.0.1";
export const APP_VERSION_TAG = `v${APP_VERSION}`;

export const CHANGELOG: readonly ChangelogEntry[] = [
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
