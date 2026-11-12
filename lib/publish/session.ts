import "server-only";

import { serverEnv } from "@/lib/env";
import { getRepoId, resolveBranchSha } from "@/lib/github/read";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";

import {
  isLivePublishState,
  isPublishableBranch,
  mapProviderState,
  projectNameFor,
  publishEnabled,
} from "./plan";
import {
  readLatestDeployment,
  updateDeployment,
  upsertDeployment,
  type DeploymentRow,
} from "./store";
import { PublishError, createDeployment, readDeployment } from "./vercel";

/**
 * Publishing a chat's app.
 *
 * The branch head is resolved with the reader's GitHub token, and the provider
 * builds that commit. The row stores exactly what came back: the deployment id,
 * the provider's hostname, its state and its error. Nothing here decides that a
 * deployment is "live" — `deploymentUrl` does that, and only for `READY`.
 *
 * Publishing is a snapshot. Later commits are not deployed until Publish is
 * pressed again, and the panel says so rather than implying a live link.
 */

type Admin = NonNullable<ReturnType<typeof supabaseAdmin>>;
type SessionClient = NonNullable<Awaited<ReturnType<typeof supabaseServer>>>;

export type PublishResult =
  | { ok: true; deployment: DeploymentRow }
  | { ok: false; code: "not_configured" | "no_repository" | "provider"; message: string };

type ChatPin = {
  repo_full_name: string | null;
  repo_branch: string | null;
};

async function readPin(
  supabase: SessionClient,
  chatId: string
): Promise<ChatPin | null> {
  const { data } = await supabase
    .from("chats")
    .select("repo_full_name, repo_branch")
    .eq("id", chatId)
    .maybeSingle();

  return (data as ChatPin | null) ?? null;
}

export async function publishChat(input: {
  admin: Admin;
  supabase: SessionClient;
  chatId: string;
  owner: string;
  githubToken: string;
}): Promise<PublishResult> {
  if (!publishEnabled()) {
    return {
      ok: false,
      code: "not_configured",
      message:
        "Publishing is not configured on this deployment: VERCEL_TOKEN is not set.",
    };
  }

  const pin = await readPin(input.supabase, input.chatId);

  if (!pin?.repo_full_name || !isPublishableBranch(pin.repo_branch)) {
    return {
      ok: false,
      code: "no_repository",
      message: "This chat has no repository and branch to publish.",
    };
  }

  let head: string;
  let repoId: number;
  try {
    head = await resolveBranchSha(input.githubToken, pin.repo_full_name, pin.repo_branch);
    repoId = await getRepoId(input.githubToken, pin.repo_full_name);
  } catch (caught) {
    return {
      ok: false,
      code: "no_repository",
      message:
        caught instanceof Error && caught.message.length > 0
          ? caught.message
          : "GitHub could not read that repository.",
    };
  }

  const env = serverEnv();

  let created: { id: string; url: string | null; state: string; error: string | null };
  try {
    created = await createDeployment({
      token: (process.env.VERCEL_TOKEN ?? "").trim(),
      teamId: env.vercelTeamId,
      name: projectNameFor(pin.repo_full_name),
      repoId,
      ref: pin.repo_branch,
      sha: head,
    });
  } catch (caught) {
    return {
      ok: false,
      code: "provider",
      message:
        caught instanceof PublishError
          ? caught.message
          : "The hosting provider refused the deployment.",
    };
  }

  const row = await upsertDeployment(input.admin, {
    chatId: input.chatId,
    owner: input.owner,
    deploymentId: created.id,
    repoFullName: pin.repo_full_name,
    branch: pin.repo_branch,
    commitSha: head,
    state: mapProviderState(created.state),
    url: created.url,
    errorMessage: created.error,
  });

  if (!row) {
    return {
      ok: false,
      code: "provider",
      message:
        "The deployment was created, but it could not be recorded. Its state will not be visible here.",
    };
  }

  return { ok: true, deployment: row };
}

/**
 * Refreshes a deployment that is still building.
 *
 * Only a live state is polled. A finished deployment is returned as stored, so
 * looking at a published app does not cost a provider request every time.
 */
export async function refreshDeployment(input: {
  admin: Admin;
  chatId: string;
}): Promise<DeploymentRow | null> {
  const row = await readLatestDeployment(input.admin, input.chatId);
  if (!row || !isLivePublishState(row.state)) return row;

  const token = (process.env.VERCEL_TOKEN ?? "").trim();
  if (!publishEnabled()) return row;

  try {
    const remote = await readDeployment({
      token,
      teamId: serverEnv().vercelTeamId,
      id: row.deploymentId,
    });

    const state = mapProviderState(remote.state);

    if (
      state !== row.state ||
      remote.url !== row.url ||
      remote.error !== row.errorMessage
    ) {
      await updateDeployment(input.admin, row.deploymentId, {
        state,
        url: remote.url,
        errorMessage: remote.error,
      });

      return {
        ...row,
        state,
        url: remote.url,
        errorMessage: remote.error,
      };
    }
  } catch {
    // A provider that cannot be reached is not a failed deployment. The stored
    // state stands, and the next look tries again.
  }

  return row;
}
