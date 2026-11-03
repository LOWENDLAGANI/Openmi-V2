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
import { getSession } from "@/lib/session";

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

  // The sealed token goes with the row; nothing else references it.
  const { error } = await supabase
    .from("github_connections")
    .delete()
    .eq("owner", user.id);

  if (error) fail(error.message);

  revalidatePath("/chat");
  redirect("/chat");
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
    const { error } = await supabase
      .from("chats")
      .update({
        repo_full_name: fullName,
        repo_branch: branch,
        repo_base_sha: sha,
        updated_at: new Date().toISOString(),
      })
      .eq("id", chatId)
      .eq("owner", user.id);

    if (error) fail(error.message);

    revalidatePath("/chat");
    redirect(`${target}&chat=${chatId}`);
  }

  revalidatePath("/chat");
  redirect(target);
}
