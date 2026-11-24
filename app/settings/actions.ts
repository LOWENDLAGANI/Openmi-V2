"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { normalizeTimezone } from "@/lib/credits";
import { GithubError, describeGithubError } from "@/lib/github/read";
import { readToken, saveConnection } from "@/lib/github/token";
import { revokeGrant } from "@/lib/oauth/github";
import { getSession } from "@/lib/session";

const PAGE = "/settings";

async function acting() {
  const session = await getSession();
  if (session.state === "unconfigured") redirect("/setup");
  if (session.state === "banned") redirect("/banned");
  if (session.state !== "signed-in") {
    redirect(`/login?next=${encodeURIComponent(PAGE)}`);
  }
  return session;
}

function field(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function fail(message: string): never {
  redirect(`${PAGE}?error=${encodeURIComponent(message)}`);
}

export async function saveSettingsTimezone(formData: FormData) {
  const { supabase, user } = await acting();
  const timezone = normalizeTimezone(field(formData, "timezone"));

  if (!timezone) fail("Choose a supported timezone.");

  const { error } = await supabase
    .from("profiles")
    .update({ timezone })
    .eq("id", user.id);

  if (error) fail(error.message);

  revalidatePath(PAGE);
  revalidatePath("/activity");
  redirect(`${PAGE}?saved=timezone`);
}

export async function bindGithubToken(formData: FormData) {
  const { supabase, user } = await acting();
  const token = field(formData, "token");

  if (token.length === 0) fail("Paste a GitHub personal access token first.");

  let login = "";
  try {
    const connection = await saveConnection(supabase, user.id, token, "token");
    login = connection.login;
  } catch (error) {
    fail(
      error instanceof GithubError ? error.message : describeGithubError(error)
    );
  }

  revalidatePath(PAGE);
  revalidatePath("/chat");
  redirect(`${PAGE}?connected=${encodeURIComponent(login)}`);
}

export async function unbindGithub() {
  const { supabase, user } = await acting();

  let revokeFailed = false;
  let github: Awaited<ReturnType<typeof readToken>> = null;
  try {
    github = await readToken(supabase, user.id);
  } catch {
    github = null;
  }

  if (github?.connection.via === "oauth") {
    try {
      await revokeGrant(github.token);
    } catch {
      revokeFailed = true;
    }
  }

  const { error } = await supabase
    .from("github_connections")
    .delete()
    .eq("owner", user.id);

  if (error) fail(error.message);

  revalidatePath(PAGE);
  revalidatePath("/chat");

  if (revokeFailed) {
    fail(
      "GitHub was unbound here, but the OAuth grant could not be revoked on GitHub. Remove Openmi at github.com/settings/applications."
    );
  }

  redirect(`${PAGE}?saved=github-unbound`);
}
