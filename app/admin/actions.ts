"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/admin/access";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Every action starts at `requireAdmin()`, which calls Supabase's `getUser()`
 * and then either the email allowlist or `is_admin()`. The form is never the
 * authority: it carries a request id, a decision and an amount, nothing more.
 *
 * The RPCs below re-check `is_admin()` inside Postgres as well. Two independent
 * checks, so a future page that forgets one of them still cannot mutate a
 * balance.
 */

function field(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function fail(message: string): never {
  redirect(`/admin?error=${encodeURIComponent(message)}`);
}

async function actingClient() {
  await requireAdmin();

  const supabase = await supabaseServer();
  if (!supabase) redirect("/setup");

  return supabase;
}

export async function reviewReceipt(formData: FormData) {
  const supabase = await actingClient();

  const id = field(formData, "requestId");
  const decision = field(formData, "decision");

  if (id.length === 0) fail("That request is missing its id.");
  if (decision !== "approved" && decision !== "rejected") {
    fail("Choose approve or reject.");
  }

  const rawDew = Number(field(formData, "dew") || "0");
  if (!Number.isFinite(rawDew)) fail("Enter the Dew to grant.");

  const dew =
    decision === "approved"
      ? Math.max(0, Math.min(100000, Math.round(rawDew)))
      : 0;

  const { error } = await supabase.rpc("review_payment_request", {
    p_id: id,
    p_decision: decision,
    p_note: field(formData, "note") || null,
    p_dew: dew,
  });

  if (error) fail(error.message.replace(/^review:\s*/, ""));

  revalidatePath("/admin");
  revalidatePath("/pay");
  redirect(`/admin?done=${decision}`);
}

export async function grantDew(formData: FormData) {
  const supabase = await actingClient();

  const email = field(formData, "email");
  const amount = Number(field(formData, "amount"));

  if (email.length === 0) fail("Enter the member's email.");
  if (!Number.isFinite(amount) || amount === 0) {
    fail("Enter a non-zero Dew amount.");
  }
  if (Math.abs(amount) > 100000) fail("That amount is too large.");

  const { error } = await supabase.rpc("admin_grant_dew", {
    p_email: email,
    p_amount: amount,
    p_reason: field(formData, "reason") || "operator top-up",
  });

  if (error) fail(error.message.replace(/^admin:\s*/, ""));

  revalidatePath("/admin");
  revalidatePath("/activity");
  redirect("/admin?done=topup");
}

export async function setAdmin(formData: FormData) {
  const supabase = await actingClient();

  const email = field(formData, "email");
  const enabled = field(formData, "enabled") === "1";

  if (email.length === 0) fail("Enter the account's email.");

  const { error } = await supabase.rpc("admin_set_admin", {
    p_email: email,
    p_enabled: enabled,
    p_note: enabled ? "granted from the admin panel" : null,
  });

  if (error) fail(error.message.replace(/^admin:\s*/, ""));

  revalidatePath("/admin");
  redirect(`/admin?done=${enabled ? "granted" : "revoked"}`);
}
