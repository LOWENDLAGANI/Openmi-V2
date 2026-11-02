"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { normalizeTimezone } from "@/lib/dew";
import { redeemDewCode } from "@/lib/dew/store";
import { getSession } from "@/lib/session";

async function acting() {
  const session = await getSession();
  if (session.state === "unconfigured") redirect("/setup");
  if (session.state !== "signed-in") redirect("/login?next=%2Factivity");
  return session;
}

function field(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function fail(message: string): never {
  redirect(`/activity?error=${encodeURIComponent(message)}`);
}

export async function saveTimezone(formData: FormData) {
  const { supabase, user } = await acting();
  const timezone = normalizeTimezone(field(formData, "timezone"));

  if (!timezone) fail("Choose a supported timezone.");

  const { error } = await supabase
    .from("profiles")
    .update({ timezone })
    .eq("id", user.id);

  if (error) fail(error.message);

  revalidatePath("/activity");
  redirect("/activity?saved=timezone");
}

export async function redeemCode(formData: FormData) {
  const { supabase } = await acting();
  const code = field(formData, "code");

  if (code.length === 0) fail("Enter a code first.");
  if (code.length > 64) fail("That code is too long.");

  const result = await redeemDewCode(supabase, code);

  if (!result.ok) fail(result.error);

  revalidatePath("/activity");
  redirect(
    `/activity?saved=${encodeURIComponent(
      `Redeemed ${result.amount} Dew. New balance: ${result.balance}.`
    )}`
  );
}
