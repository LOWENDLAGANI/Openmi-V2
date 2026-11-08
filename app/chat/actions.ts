"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { approveChangesetAndOpenPullRequest } from "@/lib/changesets/commit";
import {
  forgetAutoApproval as forgetBranchAutoApproval,
  rememberAutoApproval,
} from "@/lib/changesets/autoapproval";
import { reviewChangesetFile } from "@/lib/changesets/store";
import { undoAppliedChangeset } from "@/lib/changesets/undo";
import {
  trashChatSandbox,
  wipeChatSandbox,
  wipeChatSandboxes,
} from "@/lib/execution/chat-env/destroy";
import { serverEnv } from "@/lib/env";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Every mutation below relies on RLS for authorization and additionally keys
// its writes on the session owner. The second part is not redundant: it makes
// the intent readable, and it turns a policy regression into a no-op rather
// than a cross-account write.

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

export async function createFolder(formData: FormData) {
  const { supabase, user } = await acting();
  const name = field(formData, "name");

  if (!name) fail("A folder needs a name.");
  if (name.length > 60) fail("Folder names are limited to 60 characters.");

  const { error } = await supabase
    .from("folders")
    .insert({ owner: user.id, name });

  if (error) fail(error.message);

  revalidatePath("/chat");
  redirect("/chat");
}

export async function renameFolder(formData: FormData) {
  const { supabase, user } = await acting();
  const folderId = field(formData, "folderId");
  const name = field(formData, "name");

  if (!folderId) fail("That folder no longer exists.");
  if (!name) fail("A folder needs a name.");
  if (name.length > 60) fail("Folder names are limited to 60 characters.");

  const { error } = await supabase
    .from("folders")
    .update({ name })
    .eq("id", folderId)
    .eq("owner", user.id);

  if (error) fail(error.message);

  revalidatePath("/chat");
  redirect("/chat");
}

export async function deleteFolder(formData: FormData) {
  const { supabase, user } = await acting();
  const folderId = field(formData, "folderId");
  if (!folderId) fail("That folder no longer exists.");

  // Chats are kept: the foreign key nulls their folder rather than deleting
  // them, because losing a chat because a folder was tidied up would be a
  // hostile surprise.
  const { error } = await supabase
    .from("folders")
    .delete()
    .eq("id", folderId)
    .eq("owner", user.id);

  if (error) fail(error.message);

  revalidatePath("/chat");
  redirect("/chat");
}

export async function moveChatToFolder(formData: FormData) {
  const { supabase, user } = await acting();
  const chatId = field(formData, "chatId");
  const folderId = field(formData, "folderId");
  if (!chatId) fail("That chat no longer exists.");

  // RLS rejects a folder the caller does not own, so a guessed uuid is a
  // refusal rather than a silent cross-account attachment.
  const { error } = await supabase
    .from("chats")
    .update({ folder_id: folderId || null })
    .eq("id", chatId)
    .eq("owner", user.id);

  if (error) fail(error.message);

  revalidatePath("/chat");
  redirect("/chat");
}

export async function trashChat(formData: FormData) {
  const { supabase, user } = await acting();
  const chatId = field(formData, "chatId");
  if (!chatId) fail("That chat no longer exists.");

  const { data: trashed, error } = await supabase
    .from("chats")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", chatId)
    .eq("owner", user.id)
    .select("id")
    .maybeSingle();

  if (error) fail(error.message);
  if (!trashed) fail("That chat no longer exists.");

  // The container is not part of the database cascade. Trash releases its
  // compute and marks it wipe-due; restore starts from a fresh seed. Only an
  // owned row reaches this point, so a guessed id cannot stop another box.
  await trashChatSandbox(chatId);

  revalidatePath("/chat");
  redirect("/chat");
}

export async function restoreChat(formData: FormData) {
  const { supabase, user } = await acting();
  const chatId = field(formData, "chatId");
  if (!chatId) fail("That chat no longer exists.");

  const { error } = await supabase
    .from("chats")
    .update({ deleted_at: null })
    .eq("id", chatId)
    .eq("owner", user.id);

  if (error) fail(error.message);

  revalidatePath("/chat");
  redirect("/chat");
}

export async function purgeChat(formData: FormData) {
  const { supabase, user } = await acting();
  const chatId = field(formData, "chatId");
  if (!chatId) fail("That chat no longer exists.");

  // Purge is the only path that removes rows, and it only touches rows already
  // in the trash. Prove ownership before the service-role teardown: an update
  // or delete that matches no row is not an error, so the sandbox call must not
  // be the first place the id is checked.
  const { data: trashed, error: readError } = await supabase
    .from("chats")
    .select("id")
    .eq("id", chatId)
    .eq("owner", user.id)
    .not("deleted_at", "is", null)
    .maybeSingle();

  if (readError) fail(readError.message);
  if (!trashed) fail("That chat is not in the trash.");

  // The environment row is marked wiping before the chat delete, because the
  // foreign key nulls `chat_id` and only that ordering leaves the sweep a row
  // to finish from. This also destroys the container inline.
  await wipeChatSandbox(chatId);

  const { data: deleted, error } = await supabase
    .from("chats")
    .delete()
    .eq("id", chatId)
    .eq("owner", user.id)
    .not("deleted_at", "is", null)
    .select("id")
    .maybeSingle();

  if (error) fail(error.message);
  if (!deleted) fail("That chat is no longer in the trash.");

  revalidatePath("/chat");
  redirect("/chat?trash=1");
}

export async function emptyTrash() {
  const { supabase, user } = await acting();

  // Ids first: after the delete there is nothing to look the environments up
  // by. Each one is marked and wiped before the rows are removed.
  const { data: trashed } = await supabase
    .from("chats")
    .select("id")
    .eq("owner", user.id)
    .not("deleted_at", "is", null)
    .limit(50);

  const ids = ((trashed ?? []) as Array<{ id: string }>).map((row) => String(row.id));

  if (ids.length > 0) {
    await wipeChatSandboxes(ids);

    // Delete exactly the rows whose boxes were wiped in this pass. Deleting
    // every trashed row here would leave sandboxes for the rows beyond the
    // 50-row scan with no chat to find them by.
    const { error } = await supabase
      .from("chats")
      .delete()
      .eq("owner", user.id)
      .in("id", ids)
      .not("deleted_at", "is", null);

    if (error) fail(error.message);
  }

  revalidatePath("/chat");
  redirect("/chat?trash=1");
}

// ── Changeset review ─────────────────────────────────────────────────────────
//
// Accepting or rejecting a file re-signs the accepted set, because the
// signature covers the content of exactly those files. Approving re-derives
// that hash and checks the signature before the status moves, and then stops:
// phase 5 has no branch, commit or pull request, and the card says so.

function chatHref(chatId: string): string {
  return chatId ? `/chat?chat=${encodeURIComponent(chatId)}` : "/chat";
}

async function decideFile(formData: FormData, accepted: boolean) {
  const { supabase, user } = await acting();
  const changesetId = field(formData, "changesetId");
  const chatId = field(formData, "chatId");
  const fileId = field(formData, "fileId");

  if (!changesetId || !fileId) fail("That file is no longer part of a changeset.");

  const result = await reviewChangesetFile(supabase, {
    owner: user.id,
    changesetId,
    fileId,
    accepted,
    sealKey: serverEnv().githubTokenKey,
  });

  revalidatePath("/chat");

  if (!result.ok) {
    redirect(`${chatHref(chatId)}${chatId ? "&" : "?"}error=${encodeURIComponent(result.error)}`);
  }

  redirect(chatHref(chatId));
}

export async function acceptChange(formData: FormData) {
  await decideFile(formData, true);
}

export async function rejectChange(formData: FormData) {
  await decideFile(formData, false);
}

export async function approveProposal(formData: FormData) {
  const { supabase, user } = await acting();
  const changesetId = field(formData, "changesetId");
  const chatId = field(formData, "chatId");
  const target = field(formData, "target") === "branch" ? "branch" : "pull-request";
  const branch = field(formData, "branch");

  if (!changesetId) fail("That changeset no longer exists.");

  if (target === "branch" && branch.length === 0) {
    fail("Name the branch to commit to.");
  }

  // Approvals are writes to GitHub, so they are limited even when the chat
  // counter is free. The refusal happens before the changeset is read.
  const limited = await checkRateLimit(supabaseAdmin(), "approval", user.id);
  if (!limited.allowed) {
    fail(`Too many approvals. Try again in ${limited.retryAfterSeconds} seconds.`);
  }

  const result = await approveChangesetAndOpenPullRequest(supabase, {
    changesetId,
    owner: user.id,
    sealKey: serverEnv().githubTokenKey,
    // Naming the branch on the card is the reader asking for it, so this
    // includes the default branch without the operator opt-in.
    target: target === "branch" ? { branch, explicit: true } : undefined,
  });

  revalidatePath("/chat");

  if (!result.ok) {
    redirect(`${chatHref(chatId)}${chatId ? "&" : "?"}error=${encodeURIComponent(result.error)}`);
  }

  // "Never ask again" is remembered only after a write succeeded, and the
  // branch comes from the chat row rather than from the form.
  if (field(formData, "remember") === "1") {
    const { data } = await supabase
      .from("changesets")
      .select("chat_id, repo_full_name")
      .eq("id", changesetId)
      .maybeSingle();

    const record = data as { chat_id?: string; repo_full_name?: string } | null;

    if (record?.chat_id && record.repo_full_name) {
      const { data: chatRow } = await supabase
        .from("chats")
        .select("repo_branch")
        .eq("id", record.chat_id)
        .maybeSingle();

      const rememberedBranch =
        (chatRow as { repo_branch?: string | null } | null)?.repo_branch ?? "main";

      await rememberAutoApproval(supabase, {
        owner: user.id,
        repo: record.repo_full_name,
        branch: rememberedBranch,
      });
    }
  }

  redirect(chatHref(chatId));
}

/**
 * Undo: restore every changed file to its content at the changeset's base.
 *
 * Ownership, the applied merge commit and the not-already-undone check live in
 * `lib/changesets/undo.ts`; the Write itself stays in `lib/github/write.ts`.
 */
export async function undoChangeset(formData: FormData) {
  const { supabase, user } = await acting();
  const changesetId = field(formData, "changesetId");
  const chatId = field(formData, "chatId");

  if (!changesetId) fail("That change no longer exists.");

  const result = await undoAppliedChangeset(supabase, {
    changesetId,
    owner: user.id,
  });

  revalidatePath("/chat");

  if (!result.ok) {
    redirect(`${chatHref(chatId)}${chatId ? "&" : "?"}error=${encodeURIComponent(result.error)}`);
  }

  redirect(chatHref(chatId));
}

/** Turns the standing approval off again, for one branch of this chat. */
export async function forgetAutoApproval(formData: FormData) {
  const { supabase, user } = await acting();
  const chatId = field(formData, "chatId");
  const branch = field(formData, "branch");

  if (!chatId) fail("That chat no longer exists.");
  if (!branch) fail("That branch is not named.");

  const { data } = await supabase
    .from("chats")
    .select("repo_full_name")
    .eq("id", chatId)
    .eq("owner", user.id)
    .maybeSingle();

  const repo = (data as { repo_full_name?: string | null } | null)?.repo_full_name;
  if (!repo) fail("That chat has no repository to clear.");

  await forgetBranchAutoApproval(supabase, { owner: user.id, repo, branch });

  revalidatePath("/chat");
  redirect(chatHref(chatId));
}
