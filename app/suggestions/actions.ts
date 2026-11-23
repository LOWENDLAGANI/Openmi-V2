"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { checkRateLimit } from "@/lib/rate-limit";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

function field(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function fail(message: string): never {
  redirect(`/suggestions?error=${encodeURIComponent(message)}`);
}

export async function submitSuggestion(formData: FormData) {
  const session = await getSession();

  if (session.state === "unconfigured") redirect("/setup");
  if (session.state === "banned") redirect("/banned");
  if (session.state !== "signed-in") redirect("/login?next=%2Fsuggestions");

  const admin = supabaseAdmin();
  const limited = await checkRateLimit(admin, "feedback", session.user.id);
  if (!limited.allowed) {
    fail(
      `Too many submissions. Try again in ${limited.retryAfterSeconds} seconds.`
    );
  }

  const category = field(formData, "category") || "feature";
  const title = field(formData, "title");
  const description = field(formData, "description");

  if (title.length < 3 || title.length > 160) {
    fail("Enter a short title between 3 and 160 characters.");
  }

  if (description.length < 10 || description.length > 4000) {
    fail("Describe your suggestion in 10 to 4,000 characters.");
  }

  const { error } = await session.supabase.rpc("submit_user_feedback", {
    p_kind: "suggestion",
    p_category: category,
    p_title: title,
    p_description: description,
    p_page_url: null,
    p_image_path: null,
    p_image_name: null,
    p_image_type: null,
  });

  if (error) {
    fail(error.message.replace(/^feedback:\s*/, ""));
  }

  revalidatePath("/suggestions");
  revalidatePath("/admin");
  revalidatePath("/admin/feedback");
  redirect("/suggestions?submitted=1");
}
