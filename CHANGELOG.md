# Changelog

All notable and small changes to Openmi are documented in this file and mirrored in `lib/version.ts` (and `package.json`).

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
