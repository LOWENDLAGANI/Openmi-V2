"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  GithubError,
  describeGithubError,
  getRepo,
  isRepoFullName,
  resolveBranchSha,
} from "@/lib/github/read";
import { readToken, saveConnection } from "@/lib/github/token";
import { revokeGrant } from "@/lib/oauth/github";
import {
  GithubWriteError,
  createRepositoryWithFiles,
  describeWriteError,
} from "@/lib/github/write";
import { getSession } from "@/lib/session";
import { templateById } from "@/lib/templates/catalogue";
import {
  isTemplateId,
  isTemplateRepoName,
  templateFilesValid,
} from "@/lib/templates/plan";

function field(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function acting() {
  const session = await getSession();
  if (session.state !== "signed-in") redirect("/login?next=/chat");
  return session;
}

function fail(message: string): never {
  redirect(`/chat?error=${encodeURIComponent(message)}`);
}

function describe(error: unknown): string {
  if (error instanceof GithubError) return error.message;
  if (error instanceof GithubWriteError) return describeWriteError(error);
  return describeGithubError(error);
}

export async function connectGithub(formData: FormData) {
  const { supabase, user } = await acting();
  const token = field(formData, "token");

  if (token.length === 0) fail("Paste a GitHub token first.");

  let login = "";
  try {
    const connection = await saveConnection(supabase, user.id, token);
    login = connection.login;
  } catch (error) {
    fail(describe(error));
  }

  revalidatePath("/chat");
  redirect(`/chat?connected=${encodeURIComponent(login)}`);
}

export async function disconnectGithub() {
  const { supabase, user } = await acting();

  // Deleting the row forgets the token here. A connection made through the
  // OAuth App is also a grant on the reader's GitHub account, so it is revoked
  // there too — otherwise Openmi stays listed under Authorized OAuth Apps with
  // nothing here left that could revoke it. A pasted personal access token is
  // the reader's own credential and has no grant this app can delete.
  let revokeFailed = false;
  let github: Awaited<ReturnType<typeof readToken>> = null;
  try {
    github = await readToken(supabase, user.id);
  } catch {
    // An unopenable row is still a row to delete; it just cannot be revoked.
    github = null;
  }

  if (github?.connection.via === "oauth") {
    try {
      await revokeGrant(github.token);
    } catch {
      revokeFailed = true;
    }
  }

  // The sealed token goes with the row; nothing else references it.
  const { error } = await supabase
    .from("github_connections")
    .delete()
    .eq("owner", user.id);

  if (error) fail(error.message);

  revalidatePath("/chat");

  if (revokeFailed) {
    fail(
      "GitHub is disconnected here, but the authorisation could not be revoked on GitHub's side. Remove Openmi at github.com/settings/applications."
    );
  }

  redirect("/chat");
}

/**
 * Starts a chat from a template: one private repository, one commit, one pin.
 *
 * The repository is created by the server with the caller's own token, and the
 * chat is pinned to the commit that creation returned. Nothing here writes to an
 * existing repository: after this click the chat behaves exactly like one
 * attached to any other repo, and changes still need approval.
 */
export async function startFromTemplate(formData: FormData) {
  const { supabase, user } = await acting();
  const templateId = field(formData, "templateId");
  const name = field(formData, "name");

  if (!isTemplateId(templateId)) fail("Pick a template first.");

  const template = templateById(templateId);
  if (!template) fail("That template is not available on this deployment.");

  if (!isTemplateRepoName(name)) {
    fail(
      "Repository names use letters, numbers, dots, dashes and underscores, and start with a letter or number."
    );
  }

  if (!templateFilesValid(template.files)) {
    fail("That template is not valid on this deployment, so nothing was created.");
  }

  const github = await readToken(supabase, user.id);
  if (!github) fail("Connect GitHub before starting from a template.");

  let created: { fullName: string; branch: string; commitSha: string };
  try {
    created = await createRepositoryWithFiles({
      token: github.token,
      name,
      description: template.description,
      files: template.files,
    });
  } catch (error) {
    fail(describe(error));
  }

  const { data, error } = await supabase
    .from("chats")
    .insert({
      owner: user.id,
      title: template.name,
      charge_mode: "hour",
      repo_full_name: created.fullName,
      repo_branch: created.branch,
      repo_base_sha: created.commitSha,
    })
    .select("id")
    .single();

  if (error || !data) {
    fail(
      error?.message ??
        "The repository was created, but the chat could not be recorded. Pick it from your repositories."
    );
  }

  revalidatePath("/chat");
  redirect(`/chat?chat=${(data as { id: string }).id}`);
}

/**
 * Anchors a repository, and the commit its default branch points at, to a chat.
 *
 * The pin is resolved here rather than in the browser so the sha in the
 * database is one GitHub reported, not one a form supplied.
 */
export async function attachRepo(formData: FormData) {
  const { supabase, user } = await acting();
  const fullName = field(formData, "repo");
  const chatId = field(formData, "chat");

  if (!isRepoFullName(fullName)) fail("Repository names look like owner/name.");

  const github = await readToken(supabase, user.id);
  if (!github) fail("Connect GitHub before picking a repository.");

  // A draft chat stores nothing, and the workspace resolves the default branch
  // itself. Resolving the pin here as well meant two extra GitHub round trips
  // on the click that already felt slow, for a sha nobody read.
  if (!chatId) {
    revalidatePath("/chat");
    redirect(`/chat?repo=${encodeURIComponent(fullName)}`);
  }

  let branch = "";
  let sha = "";
  try {
    const repo = await getRepo(github.token, fullName);
    branch = repo.defaultBranch;
    sha = await resolveBranchSha(github.token, fullName, branch);
  } catch (error) {
    fail(describe(error));
  }

  const target = `/chat?repo=${encodeURIComponent(fullName)}&branch=${encodeURIComponent(branch)}&sha=${sha}`;

  if (chatId) {
    const { data: updated, error } = await supabase
      .from("chats")
      .update({
        repo_full_name: fullName,
        repo_branch: branch,
        repo_base_sha: sha,
        updated_at: new Date().toISOString(),
      })
      .eq("id", chatId)
      .eq("owner", user.id)
      .select("id")
      .maybeSingle();

    if (error) fail(error.message);
    if (!updated) fail("That chat no longer exists.");

    revalidatePath("/chat");
    redirect(`${target}&chat=${chatId}`);
  }

  revalidatePath("/chat");
  redirect(target);
}
