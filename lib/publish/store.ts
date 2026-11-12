import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

import type { PublishState } from "./plan";

/**
 * Reads and writes for deployments.
 *
 * Service role only, after a route resolved the chat through the caller's
 * session. A row is a report of what the provider said; nothing here invents a
 * state or a URL.
 */

type Admin = NonNullable<ReturnType<typeof supabaseAdmin>>;

export type DeploymentRow = {
  id: string;
  chatId: string;
  owner: string;
  deploymentId: string;
  repoFullName: string;
  branch: string;
  commitSha: string;
  state: PublishState;
  url: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

const COLUMNS =
  "id, chat_id, owner, deployment_id, repo_full_name, branch, commit_sha, state, url, error_message, created_at, updated_at";

function toRow(raw: Record<string, unknown>): DeploymentRow {
  return {
    id: String(raw.id),
    chatId: String(raw.chat_id),
    owner: String(raw.owner),
    deploymentId: String(raw.deployment_id),
    repoFullName: String(raw.repo_full_name),
    branch: String(raw.branch),
    commitSha: String(raw.commit_sha),
    state: raw.state as PublishState,
    url: raw.url ? String(raw.url) : null,
    errorMessage: raw.error_message ? String(raw.error_message) : null,
    createdAt: String(raw.created_at),
    updatedAt: String(raw.updated_at),
  };
}

export async function readLatestDeployment(
  admin: Admin,
  chatId: string
): Promise<DeploymentRow | null> {
  const { data } = await admin
    .from("deployments")
    .select(COLUMNS)
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data ? toRow(data as Record<string, unknown>) : null;
}

export async function upsertDeployment(
  admin: Admin,
  input: {
    chatId: string;
    owner: string;
    deploymentId: string;
    repoFullName: string;
    branch: string;
    commitSha: string;
    state: PublishState;
    url: string | null;
    errorMessage: string | null;
  }
): Promise<DeploymentRow | null> {
  const { data, error } = await admin
    .from("deployments")
    .upsert(
      {
        chat_id: input.chatId,
        owner: input.owner,
        deployment_id: input.deploymentId,
        repo_full_name: input.repoFullName,
        branch: input.branch,
        commit_sha: input.commitSha,
        state: input.state,
        url: input.url,
        error_message: input.errorMessage,
      },
      { onConflict: "deployment_id" }
    )
    .select(COLUMNS)
    .maybeSingle();

  if (error || !data) return null;
  return toRow(data as Record<string, unknown>);
}

export async function updateDeployment(
  admin: Admin,
  deploymentId: string,
  patch: { state: PublishState; url: string | null; errorMessage: string | null }
): Promise<void> {
  await admin
    .from("deployments")
    .update({
      state: patch.state,
      url: patch.url,
      error_message: patch.errorMessage,
    })
    .eq("deployment_id", deploymentId);
}
