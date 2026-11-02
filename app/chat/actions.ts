"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  approveChangeset,
  reviewChangesetFile,
} from "@/lib/changesets/store";
import { serverEnv } from "@/lib/env";
import { getSession } from "@/lib/session";

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

export async function createChat() {
  const { supabase, user } = await acting();

  const { data, error } = await supabase
    .from("chats")
    .insert({ owner: user.id, title: "New chat" })
    .select("id")
    .single();

  if (error || !data) fail(error?.message ?? "Could not create a chat.");

  revalidatePath("/chat");
  redirect(`/chat?chat=${data.id}`);
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

  const { error } = await supabase
    .from("chats")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", chatId)
    .eq("owner", user.id);

  if (error) fail(error.message);

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
  // in the trash. An active chat cannot be destroyed by guessing its id.
  const { error } = await supabase
    .from("chats")
    .delete()
    .eq("id", chatId)
    .eq("owner", user.id)
    .not("deleted_at", "is", null);

  if (error) fail(error.message);

  revalidatePath("/chat");
  redirect("/chat?trash=1");
}

export async function emptyTrash() {
  const { supabase, user } = await acting();

  const { error } = await supabase
    .from("chats")
    .delete()
    .eq("owner", user.id)
    .not("deleted_at", "is", null);

  if (error) fail(error.message);

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
  const { supabase } = await acting();
  const changesetId = field(formData, "changesetId");
  const chatId = field(formData, "chatId");

  if (!changesetId) fail("That changeset no longer exists.");

  const result = await approveChangeset(supabase, {
    changesetId,
    sealKey: serverEnv().githubTokenKey,
  });

  revalidatePath("/chat");

  if (!result.ok) {
    redirect(`${chatHref(chatId)}${chatId ? "&" : "?"}error=${encodeURIComponent(result.error)}`);
  }

  redirect(chatHref(chatId));
}
