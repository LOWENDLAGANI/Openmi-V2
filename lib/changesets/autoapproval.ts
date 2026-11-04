import "server-only";

import type { supabaseServer } from "@/lib/supabase/server";

/**
 * "Approve and never ask again" for one branch.
 *
 * A preference is scoped to the account, the repository and the base branch the
 * chat is pinned to — not to a repository alone, and never to an agent branch.
 * The row is written only after an approval succeeded, and read by the chat
 * route before it decides to write without asking.
 */

type Client = NonNullable<Awaited<ReturnType<typeof supabaseServer>>>;

export type AutoApprovalKey = {
  owner: string;
  repo: string;
  branch: string;
};

export async function rememberAutoApproval(
  supabase: Client,
  key: AutoApprovalKey
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from("branch_autoapprovals").upsert(
    {
      owner: key.owner,
      repo_full_name: key.repo,
      branch: key.branch,
    },
    { onConflict: "owner,repo_full_name,branch" }
  );

  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function forgetAutoApproval(
  supabase: Client,
  key: AutoApprovalKey
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase
    .from("branch_autoapprovals")
    .delete()
    .eq("owner", key.owner)
    .eq("repo_full_name", key.repo)
    .eq("branch", key.branch);

  return error ? { ok: false, error: error.message } : { ok: true };
}

/** True when a ready diff on this branch should be written without asking. */
export async function readAutoApproval(
  supabase: Client,
  key: AutoApprovalKey
): Promise<boolean> {
  const { data, error } = await supabase
    .from("branch_autoapprovals")
    .select("branch")
    .eq("owner", key.owner)
    .eq("repo_full_name", key.repo)
    .eq("branch", key.branch)
    .maybeSingle();

  return !error && Boolean(data);
}
