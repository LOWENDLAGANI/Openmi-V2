"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { wipeChatSandboxes } from "@/lib/execution/chat-env/destroy";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Self-serve account deletion.
 *
 * The database is already built for this: every table that holds a reader's
 * data references `auth.users(id) on delete cascade`, so removing the auth
 * identity removes the profile, chats, messages, repository connection,
 * changesets, runs and ledger in one statement. Two things live outside
 * Postgres and have to be handled here, before that cascade loses the handles:
 *
 *   1. Sandboxes belong to the provider. `wipeChatSandboxes` stops and destroys
 *      the containers the account's chats were warming.
 *   2. Receipts are objects in the private `receipts` bucket under `${uid}/`.
 *      Storage has no foreign key, so the objects are removed explicitly.
 *
 * The service role is required and is used only for these three operations.
 * Without it the action refuses rather than half-deleting an account, and the
 * page tells the reader to write to support instead.
 */

const CONFIRMATION = "DELETE";
const PAGE = "/account/delete";

function fail(message: string): never {
  redirect(`${PAGE}?error=${encodeURIComponent(message)}`);
}

/**
 * Supabase names its cookies `sb-<project-ref>-auth-token`, and a chunked
 * session adds `.0`, `.1`. Removing them after the identity is gone stops the
 * browser carrying a cookie that can never resolve again.
 */
async function clearSessionCookies(): Promise<void> {
  const jar = await cookies();
  for (const cookie of jar.getAll()) {
    if (cookie.name.startsWith("sb-") && cookie.name.includes("-auth-token")) {
      jar.delete(cookie.name);
    }
  }
}

export async function deleteAccount(formData: FormData) {
  const session = await getSession();

  if (session.state === "unconfigured") redirect("/setup");
  if (session.state !== "signed-in") {
    redirect(`/login?next=${encodeURIComponent(PAGE)}`);
  }

  const typed = formData.get("confirm");
  if (
    typeof typed !== "string" ||
    typed.trim().toUpperCase() !== CONFIRMATION
  ) {
    fail(`Type ${CONFIRMATION} in the box to confirm.`);
  }

  const admin = supabaseAdmin();
  if (!admin) {
    fail(
      "Self-serve deletion needs SUPABASE_SERVICE_ROLE_KEY on the server. Write to support and we will delete the account for you."
    );
  }

  const owner = session.user.id;

  // Stop the containers first: the rows cascade, the provider's sandboxes do
  // not, and the sweep would have nothing left to find them by.
  const { data: chats } = await admin
    .from("chats")
    .select("id")
    .eq("owner", owner);

  await wipeChatSandboxes((chats ?? []).map((row) => String(row.id)));

  // One page of 1,000 covers every receipt an account can hold: uploads are
  // rate-limited far below that, and each request keeps one object.
  const { data: objects } = await admin.storage
    .from("receipts")
    .list(owner, { limit: 1000 });

  const paths = (objects ?? [])
    .map((object) => (object.name ? `${owner}/${object.name}` : ""))
    .filter((path) => path.length > 0);

  if (paths.length > 0) {
    await admin.storage.from("receipts").remove(paths);
  }

  const { error } = await admin.auth.admin.deleteUser(owner);
  if (error) {
    fail(`The account could not be deleted: ${error.message}`);
  }

  // The identity is gone, so signing out is best effort; the cookies are
  // cleared here either way.
  await session.supabase.auth.signOut().catch(() => undefined);
  await clearSessionCookies();

  redirect("/login?deleted=1");
}
