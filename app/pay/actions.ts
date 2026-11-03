"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { planById } from "@/lib/billing/plans";
import { redeemDewCode } from "@/lib/dew/store";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Receipt submission.
 *
 * The file is validated here (type, size), stored in the private `receipts`
 * bucket under the caller's own uid, and only then turned into a request with
 * `submit_payment_request`. That function refuses a path outside `${uid}/`, so a
 * caller cannot attach somebody else's receipt to their own request.
 *
 * If the database insert fails, the uploaded object is removed: an orphan in the
 * bucket would be invisible to both sides.
 */

const MAX_BYTES = 5 * 1024 * 1024;

const RECEIPT_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

function field(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function fail(message: string): never {
  redirect(`/pay?error=${encodeURIComponent(message)}`);
}

export async function submitReceipt(formData: FormData) {
  const session = await getSession();

  if (session.state === "unconfigured") redirect("/setup");
  if (session.state !== "signed-in") redirect("/login?next=%2Fpay");

  const plan = planById(field(formData, "plan"));
  if (!plan) fail("Choose a plan first.");

  const reference = field(formData, "reference");
  if (reference.length === 0) fail("Add the transaction reference from the payment page.");
  if (reference.length > 120) fail("That reference is too long.");

  const amountRaw = field(formData, "amount");
  const amount = amountRaw.length > 0 ? Number(amountRaw) : plan.price;
  if (!Number.isFinite(amount) || amount < 0 || amount > 100000) {
    fail("Enter the amount you paid.");
  }

  const note = field(formData, "note").slice(0, 500);

  const upload = formData.get("receipt");
  if (!(upload instanceof File) || upload.size === 0) {
    fail("Attach the payment receipt (image or PDF).");
  }

  const extension = RECEIPT_TYPES[upload.type];
  if (!extension) fail("Receipts must be PNG, JPEG, WebP or PDF.");
  if (upload.size > MAX_BYTES) fail("That receipt is larger than 5 MB.");

  const admin = supabaseAdmin();
  if (!admin) {
    fail("Receipt uploads need SUPABASE_SERVICE_ROLE_KEY on the server.");
  }

  const path = `${session.user.id}/${randomUUID()}.${extension}`;
  const bytes = new Uint8Array(await upload.arrayBuffer());

  const { error: uploadError } = await admin.storage
    .from("receipts")
    .upload(path, bytes, { contentType: upload.type, upsert: false });

  if (uploadError) {
    fail(`The receipt could not be stored: ${uploadError.message}`);
  }

  const { error } = await session.supabase.rpc("submit_payment_request", {
    p_plan: plan.id,
    p_amount: Math.round(amount * 100) / 100,
    p_reference: reference,
    p_note: note.length > 0 ? note : null,
    p_receipt_path: path,
    p_receipt_name: upload.name.slice(0, 200),
  });

  if (error) {
    // Best effort: do not leave an object nobody can see.
    await admin.storage.from("receipts").remove([path]);
    fail(error.message.replace(/^payment:\s*/, ""));
  }

  revalidatePath("/pay");
  revalidatePath("/admin");
  redirect("/pay?submitted=1");
}

async function account() {
  const session = await getSession();

  if (session.state === "unconfigured") redirect("/setup");
  if (session.state !== "signed-in") redirect("/login?next=%2Fpay");

  return session;
}

function done(message: string): never {
  redirect(`/pay?dew=${encodeURIComponent(message)}`);
}

/**
 * A top-up without a receipt: an operator-issued code, redeemed once.
 *
 * This is the receipt-free direction. Money still has to arrive on the hosted
 * payment page and be seen by an operator; a code is what the operator hands
 * back for it, and `redeem_dew_code` is the only thing that can turn one into
 * Dew.
 */
export async function redeemTopUpCode(formData: FormData) {
  const session = await account();

  // A code is a bearer value, so attempts are counted before one is looked up.
  const limited = await checkRateLimit(supabaseAdmin(), "redeem", session.user.id);
  if (!limited.allowed) {
    fail(`Too many code attempts. Try again in ${limited.retryAfterSeconds} seconds.`);
  }

  const code = field(formData, "code");

  if (code.length === 0) fail("Enter a code first.");
  if (code.length > 64) fail("That code is too long.");

  const result = await redeemDewCode(session.supabase, code);
  if (!result.ok) fail(result.error);

  revalidatePath("/pay");
  revalidatePath("/activity");
  done(`Redeemed ${result.amount} Dew. New balance: ${result.balance}.`);
}

/**
 * A deduction without a receipt: the account gives Dew back.
 *
 * It is one-directional on purpose. `deduct_own_dew` can only subtract from the
 * signed-in balance and refuses to go below zero, so this form can never mint
 * Dew — a self-service top-up with no code and no receipt would be free credit.
 */
export async function deductOwnDew(formData: FormData) {
  const session = await account();

  const limited = await checkRateLimit(supabaseAdmin(), "wallet", session.user.id);
  if (!limited.allowed) {
    fail(`Too many deductions. Try again in ${limited.retryAfterSeconds} seconds.`);
  }

  const raw = Number(field(formData, "amount"));
  if (!Number.isFinite(raw) || raw <= 0) fail("Enter the Dew to deduct.");

  const amount = Math.min(Math.round(raw), 100000);
  const reason = field(formData, "reason").slice(0, 120);

  const { data, error } = await session.supabase.rpc("deduct_own_dew", {
    p_amount: amount,
    p_reason: reason.length > 0 ? reason : null,
  });

  if (error) fail(error.message.replace(/^dew:\s*/, ""));

  const balance = Number(Array.isArray(data) ? data[0] : data);

  revalidatePath("/pay");
  revalidatePath("/activity");
  done(
    `Deducted ${amount} Dew. New balance: ${Number.isFinite(balance) ? balance : "updated"}.`
  );
}
