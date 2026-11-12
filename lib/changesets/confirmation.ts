/**
 * When an AI change has to ask before it is applied.
 *
 * Applying is not always a quiet act. A suggestion computed against a commit
 * that has since moved, a suggestion that touches more files than a reader can
 * hold in their head, a suggestion that edits configuration, credentials handling
 * or the database schema, and a suggestion nobody has looked at yet all deserve
 * one question first.
 *
 * Pure on purpose: no database, no network, no `server-only`. The card and the
 * tests read the same rule, so the dialog cannot appear in one place and be
 * skipped in another.
 */

/** Files one change may touch before the reader is asked. */
export const CONFIRM_FILE_LIMIT = 5;

/**
 * Paths whose change is a decision, not a typo fix.
 *
 * The patterns are matched per path segment rather than against a glob library:
 * `config` in a directory name is as load-bearing as `config` in a file name,
 * and an `.env` file is protected at any depth because the sandbox already
 * refuses to keep one.
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  /^\.env(\..*)?$/, // .env, .env.local, .env.production
  /^package\.json$/, // dependencies and scripts
  /^[^/]*config[^/]*$/i, // next.config.mjs, config.ts, app-config.json
];

function sensitiveSegment(segment: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(segment));
}

/**
 * Whether this path is configuration, credentials handling or schema.
 *
 * `** /auth/**` is matched as any `auth` directory, and `supabase/migrations/**`
 * as the schema history it is: a change there runs with the deploy, not with the
 * code review.
 */
export function touchesSensitivePath(path: string): boolean {
  const clean = path.trim().replace(/^\.\//, "");
  if (clean.length === 0) return false;

  if (clean === "supabase/migrations" || clean.startsWith("supabase/migrations/")) {
    return true;
  }

  const segments = clean.split("/").filter((segment) => segment.length > 0);
  const directory = segments.slice(0, -1);

  if (directory.some((segment) => segment.toLowerCase() === "auth")) return true;

  return segments.some(sensitiveSegment);
}

export type ConfirmableChangeset = {
  base_sha: string;
  reviewed_at: string | null;
  files: ReadonlyArray<{ path: string }>;
};

/**
 * True when applying this change should ask first.
 *
 * `currentHead` is the default branch's head as the caller last observed it. Null
 * means it could not be read, which is a reason to ask rather than a reason to
 * assume nothing moved: the alternative is a dialog that silently disappears
 * when GitHub is briefly unavailable.
 */
export function needsConfirmation(
  changeset: ConfirmableChangeset,
  currentHead: string | null
): boolean {
  if (currentHead === null || currentHead !== changeset.base_sha) return true;
  if (changeset.files.length > CONFIRM_FILE_LIMIT) return true;
  if (changeset.files.some((file) => touchesSensitivePath(file.path))) return true;

  return changeset.reviewed_at === null;
}

/**
 * What a standing approval stands in for.
 *
 * "Apply and don't ask again for this branch" is the reader's earlier yes on
 * this branch, so it counts as the review and the automatic write does not have
 * to ask again. It does not stand in for the other reasons: a change against a
 * moved head, a large change, or one touching configuration, credentials or the
 * schema still asks, because those are facts the standing approval never saw.
 */
export const STANDING_APPROVAL_REVIEW = "standing-approval";

/**
 * The review an automatic write stands in for.
 *
 * `OPENMI_AUTO_WRITE` is on by default, and its whole point is that the click
 * was a second confirmation of a decision the write client already enforces.
 * Without this stamp every fresh suggestion read as "nobody has reviewed it" and
 * asked anyway, which made the automatic path never actually automatic. The
 * other questions still apply: a moved head, a large change, and one touching
 * configuration, credentials or the schema.
 */
export const AUTO_WRITE_REVIEW = "auto-write";

export function withAutoWriteReview(
  changeset: ConfirmableChangeset
): ConfirmableChangeset {
  if (changeset.reviewed_at !== null) return changeset;

  return { ...changeset, reviewed_at: AUTO_WRITE_REVIEW };
}

export function withStandingApproval(
  changeset: ConfirmableChangeset,
  remembered: boolean
): ConfirmableChangeset {
  if (!remembered || changeset.reviewed_at !== null) return changeset;

  return { ...changeset, reviewed_at: STANDING_APPROVAL_REVIEW };
}
