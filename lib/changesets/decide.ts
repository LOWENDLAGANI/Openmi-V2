import type { supabaseServer } from "@/lib/supabase/server";

/**
 * The two decisions that never touch GitHub.
 *
 * "Review first" records that the reader looked the suggestion over and leaves
 * it ready, so the next Apply is a one-click act instead of a dialog. "Cancel"
 * records that the suggestion was discarded. Both are owner-scoped updates on
 * one row: no token is opened, no request is made, and the card's copy says
 * exactly that.
 */

type Client = NonNullable<Awaited<ReturnType<typeof supabaseServer>>>;

/** Statuses a suggestion may be discarded from. */
export const REJECTABLE_STATUSES = ["draft", "ready", "approved", "failed"] as const;

export type DecisionResult = { ok: true } | { ok: false; error: string };

export type ReviewedResult =
  | { ok: true; reviewedAt: string }
  | { ok: false; error: string };

/**
 * Sets `reviewed_at` and leaves the status at `ready`.
 *
 * The status predicate is part of the update rather than a read followed by a
 * write: a suggestion that was applied, discarded or expired between the render
 * and the click is a no-op instead of resurrecting a dead row.
 */
export async function markChangesetReviewed(
  supabase: Client,
  input: { changesetId: string; owner: string; now?: string }
): Promise<ReviewedResult> {
  const reviewedAt = input.now ?? new Date().toISOString();

  const { data, error } = await supabase
    .from("changesets")
    .update({ reviewed_at: reviewedAt })
    .eq("id", input.changesetId)
    .eq("owner", input.owner)
    .eq("status", "ready")
    .select("reviewed_at")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) {
    return { ok: false, error: "That suggestion is no longer waiting to be applied." };
  }

  const row = data as { reviewed_at?: string | null };

  return { ok: true, reviewedAt: row.reviewed_at ?? reviewedAt };
}

/** Marks one suggestion discarded. The AI may propose again; this row stays. */
export async function rejectChangeset(
  supabase: Client,
  input: { changesetId: string; owner: string }
): Promise<DecisionResult> {
  const { data, error } = await supabase
    .from("changesets")
    .update({ status: "rejected" })
    .eq("id", input.changesetId)
    .eq("owner", input.owner)
    .in("status", [...REJECTABLE_STATUSES])
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "That suggestion can no longer be discarded." };

  return { ok: true };
}
