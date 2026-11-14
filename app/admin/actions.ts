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

/**
 * Stops an account.
 *
 * The RPC checks the role again, refuses a self-ban, cancels live runs and
 * records who did it. The reason is not optional: it is the sentence the
 * account reads on /banned, and a ban nobody can explain is one nobody can
 * review.
 */
export async function banUser(formData: FormData) {
  const supabase = await actingClient();

  const userId = field(formData, "userId");
  const reason = field(formData, "reason");
  const hours = field(formData, "hours");

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    fail("That account does not exist.");
  }

  if (reason.length < 3) fail("Write a reason — the account is shown it.");

  const duration = hours === "" ? null : Number(hours);

  if (duration !== null && (!Number.isFinite(duration) || duration < 1)) {
    fail("Choose how long the stop lasts.");
  }

  const { error } = await supabase.rpc("admin_ban_user", {
    p_user: userId,
    p_reason: reason,
    p_hours: duration === null ? null : Math.round(duration),
  });

  if (error) fail(error.message);

  revalidatePath("/admin");
  redirect("/admin?done=Account+stopped");
}

export async function unbanUser(formData: FormData) {
  const supabase = await actingClient();
  const userId = field(formData, "userId");

  if (userId.length === 0) fail("That account does not exist.");

  const { error } = await supabase.rpc("admin_unban_user", { p_user: userId });
  if (error) fail(error.message);

  revalidatePath("/admin");
  redirect("/admin?done=Ban+lifted");
}

export async function resolveRisk(formData: FormData) {
  const supabase = await actingClient();
  const riskId = field(formData, "riskId");

  if (riskId.length === 0) fail("That signal does not exist.");

  const { error } = await supabase.rpc("admin_resolve_risk", {
    p_id: riskId,
    p_note: field(formData, "note") || null,
  });

  if (error) fail(error.message);

  revalidatePath("/admin");
  redirect("/admin?done=Signal+closed");
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

/**
 * Giveaways: a batch of codes an operator can hand out.
 *
 * The codes are minted by the database and redeemed one at a time. A giveaway
 * is kind `operator`, so it adds Dew without switching an account to the paid
 * allowance — a gift is not a plan.
 */
export async function createGiveawayCodes(formData: FormData) {
  const supabase = await actingClient();

  const amount = Number(field(formData, "amount"));
  const count = Number(field(formData, "count") || "1");

  if (!Number.isFinite(amount) || amount <= 0) {
    fail("Enter a positive Dew amount.");
  }
  if (!Number.isFinite(count) || count < 1 || count > 50) {
    fail("Issue between 1 and 50 codes.");
  }

  const { error } = await supabase.rpc("admin_create_dew_codes", {
    p_amount: Math.round(amount * 1000) / 1000,
    p_count: Math.round(count),
    p_note: field(formData, "note") || null,
  });

  if (error) fail(error.message.replace(/^giveaway:\s*/, ""));

  revalidatePath("/admin");
  redirect("/admin?done=giveaway");
}

export async function setAdmin(formData: FormData) {
  const supabase = await actingClient();

  const email = field(formData, "email");
  const userId = field(formData, "userId");
  const enabled = field(formData, "enabled") === "1";

  if (email.length === 0 && userId.length === 0) {
    fail("Enter the account's email.");
  }

  // A revoke comes from the admin list, which knows the id even when the
  // profile has no email; a grant comes from a field that only has an address.
  const { error } =
    userId.length > 0
      ? await supabase.rpc("admin_set_admin_id", {
          p_user_id: userId,
          p_enabled: enabled,
        })
      : await supabase.rpc("admin_set_admin", {
          p_email: email,
          p_enabled: enabled,
          p_note: enabled ? "granted from the admin panel" : null,
        });

  if (error) fail(error.message.replace(/^admin:\s*/, ""));

  revalidatePath("/admin");
  redirect(`/admin?done=${enabled ? "granted" : "revoked"}`);
}

/**
 * A paid pass, granted or revoked by hand.
 *
 * The days field is the instruction and "revoke" sends zero: a grant extends
 * the window from the later of now and its current end, so comping a month to a
 * running pass adds to it. No Dew moves, so there is no ledger row — the
 * entitlement is `paid_until`, and `admin_set_pass` re-checks the role.
 */
export async function setPass(formData: FormData) {
  const supabase = await actingClient();

  const email = field(formData, "email");
  const revoke = field(formData, "action") === "revoke";
  const days = revoke ? 0 : Number(field(formData, "days") || "0");

  if (email.length === 0) fail("That account has no email to pass on.");
  if (!Number.isFinite(days) || days < 0 || days > 3660) {
    fail("Enter between 1 and 3660 days.");
  }

  const { error } = await supabase.rpc("admin_set_pass", {
    p_email: email,
    p_days: Math.round(days),
  });

  if (error) fail(error.message.replace(/^pass:\s*/, ""));

  revalidatePath("/admin");
  revalidatePath("/activity");
  redirect(`/admin?done=${revoke ? "pass-off" : "pass"}`);
}
