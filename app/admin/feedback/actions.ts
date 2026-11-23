"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/admin/access";
import { supabaseServer } from "@/lib/supabase/server";

function field(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function fail(message: string): never {
  redirect(`/admin/feedback?error=${encodeURIComponent(message)}`);
}

async function actingClient() {
  await requireAdmin();

  const supabase = await supabaseServer();
  if (!supabase) redirect("/setup");

  return supabase;
}

export async function reviewFeedback(formData: FormData) {
  const supabase = await actingClient();

  const id = field(formData, "feedbackId");
  const status = field(formData, "status");
  const note = field(formData, "note");
  const filterKind = field(formData, "filterKind");
  const filterStatus = field(formData, "filterStatus");

  if (id.length === 0) {
    fail("Missing feedback submission id.");
  }

  if (
    status !== "open" &&
    status !== "in_progress" &&
    status !== "resolved" &&
    status !== "planned" &&
    status !== "closed"
  ) {
    fail("Choose a valid status.");
  }

  const { error } = await supabase.rpc("review_user_feedback", {
    p_id: id,
    p_status: status,
    p_note: note.length > 0 ? note : null,
  });

  if (error) {
    fail(error.message.replace(/^feedback:\s*/, ""));
  }

  revalidatePath("/admin");
  revalidatePath("/admin/feedback");
  revalidatePath("/report");
  revalidatePath("/suggestions");

  const search = new URLSearchParams();
  if (filterKind) search.set("kind", filterKind);
  if (filterStatus) search.set("status", filterStatus);
  search.set("done", "updated");

  redirect(`/admin/feedback?${search.toString()}`);
}
