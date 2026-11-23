"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  FEEDBACK_IMAGE_TYPES,
  FEEDBACK_MAX_IMAGE_BYTES,
  feedbackImageBytesMatchType,
} from "@/lib/feedback";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

function field(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function fail(message: string): never {
  redirect(`/report?error=${encodeURIComponent(message)}`);
}

/**
 * Ensures the `feedback` private bucket exists (if not yet created by migration)
 * or falls back cleanly.
 */
async function uploadScreenshot(
  userId: string,
  upload: File
): Promise<{ path: string; name: string; type: string }> {
  const admin = supabaseAdmin();
  if (!admin) {
    fail("Screenshot uploads require SUPABASE_SERVICE_ROLE_KEY on the server.");
  }

  const extension = FEEDBACK_IMAGE_TYPES[upload.type];
  if (!extension) {
    fail("Screenshots must be PNG, JPEG, or WebP images.");
  }

  if (upload.size > FEEDBACK_MAX_IMAGE_BYTES) {
    fail("That image is larger than 5 MB.");
  }

  const bytes = new Uint8Array(await upload.arrayBuffer());
  if (!feedbackImageBytesMatchType(bytes, upload.type)) {
    fail("That file does not match the image format it claims.");
  }

  const path = `${userId}/${randomUUID()}.${extension}`;

  // Ensure bucket exists on first upload in case storage migration ran before bucket init
  await admin.storage
    .createBucket("feedback", { public: false })
    .catch(() => null);

  const { error: uploadError } = await admin.storage
    .from("feedback")
    .upload(path, bytes, { contentType: upload.type, upsert: false });

  if (uploadError) {
    fail(`Could not store the screenshot: ${uploadError.message}`);
  }

  return {
    path,
    name: upload.name.slice(0, 200),
    type: upload.type,
  };
}

export async function submitBugReport(formData: FormData) {
  const session = await getSession();

  if (session.state === "unconfigured") redirect("/setup");
  if (session.state === "banned") redirect("/banned");
  if (session.state !== "signed-in") redirect("/login?next=%2Freport");

  const admin = supabaseAdmin();
  const limited = await checkRateLimit(admin, "feedback", session.user.id);
  if (!limited.allowed) {
    fail(
      `Too many submissions. Try again in ${limited.retryAfterSeconds} seconds.`
    );
  }

  const category = field(formData, "category") || "general";
  const title = field(formData, "title");
  const description = field(formData, "description");
  const pageUrl = field(formData, "pageUrl");

  if (title.length < 3 || title.length > 160) {
    fail("Enter a short summary between 3 and 160 characters.");
  }

  if (description.length < 10 || description.length > 4000) {
    fail("Describe the problem in 10 to 4,000 characters.");
  }

  let storedImage: { path: string; name: string; type: string } | null = null;
  const upload = formData.get("screenshot");

  if (upload instanceof File && upload.size > 0) {
    storedImage = await uploadScreenshot(session.user.id, upload);
  }

  const { error } = await session.supabase.rpc("submit_user_feedback", {
    p_kind: "bug",
    p_category: category,
    p_title: title,
    p_description: description,
    p_page_url: pageUrl.length > 0 ? pageUrl : null,
    p_image_path: storedImage?.path ?? null,
    p_image_name: storedImage?.name ?? null,
    p_image_type: storedImage?.type ?? null,
  });

  if (error) {
    if (storedImage && admin) {
      await admin.storage.from("feedback").remove([storedImage.path]);
    }
    fail(error.message.replace(/^feedback:\s*/, ""));
  }

  revalidatePath("/report");
  revalidatePath("/admin");
  revalidatePath("/admin/feedback");
  redirect("/report?submitted=1");
}
