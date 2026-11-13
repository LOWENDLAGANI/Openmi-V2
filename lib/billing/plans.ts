/**
 * Paid plans and where the money goes.
 *
 * Payment is hosted elsewhere (Sociabuzz). This app never sees a card number:
 * it shows the link, then accepts the receipt the payer uploads. A request is
 * created in `payment_requests` with status `pending` and stays visible on the
 * plans page until an operator approves or rejects it.
 *
 * Every plan is a pass: a window of the paid daily allowance that ends. The pass
 * ids are mirrored in `supabase/migrations/019_chat_billing_modes.sql` and the
 * days are mirrored in `038_subscription_passes.sql`; a plan the database does
 * not know is refused at submission rather than stored as a string.
 *
 * The one-off Dew packs are gone. They sold Dew at RM0.60–0.75 each while a pass
 * already raised the daily allowance, so they were strictly worse value and one
 * of them undercut the cheapest pass.
 */

export type PlanId = "pass-15" | "pass-30";

export type Plan = {
  id: PlanId;
  name: string;
  /** Price in the currency the hosted page charges (RM). */
  price: number;
  /** Dew granted when a receipt for this plan is approved. */
  dew: number;
  /** Days of paid allowance the pass covers. */
  days: number;
  blurb: string;
};

export const PLANS: readonly Plan[] = [
  {
    id: "pass-15",
    name: "15-day pass",
    price: 18,
    dew: 30,
    days: 15,
    blurb: "Fifteen days at 15 Dew a day, plus 30 Dew up front.",
  },
  {
    id: "pass-30",
    name: "30-day pass",
    price: 36,
    dew: 70,
    days: 30,
    blurb: "Thirty days at 15 Dew a day, plus 70 Dew up front.",
  },
];

export const PLAN_IDS = PLANS.map((plan) => plan.id);

/**
 * What a paid account actually gets. Shown next to the plans, and the same
 * rules the receipt review and the daily refill implement: fifteen Dew a day
 * while the pass is active, six once it ends.
 */
export const PAID_BENEFITS = [
  "15 Dew a day instead of 6",
  "For the length of the pass — the allowance returns to 6 when it ends",
  "Approval extends a running pass from its current end, never from today",
  "Everything the free tier includes",
] as const;

/**
 * Real-money checkout is closed unless the operator opens it.
 *
 * `TOPUP_PAUSED=off` shows the hosted payment link and the receipt form; unset,
 * or any other value, keeps the safe default of a closed checkout. A redeem
 * code works either way, because no checkout is involved. The page, its copy
 * and the tests all read this one switch, so they cannot disagree about whether
 * money can be taken.
 */
export function checkoutPaused(value: string | undefined): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  return !["off", "false", "0"].includes(normalized);
}

export const TOPUP_PAUSED = checkoutPaused(process.env.TOPUP_PAUSED);

export function planById(value: string | null | undefined): Plan | null {
  if (!value) return null;
  return PLANS.find((plan) => plan.id === value) ?? null;
}

/**
 * PAYMENT_LINK is optional; the hosted page above is the default. A value that
 * is not http(s) is ignored rather than rendered as a javascript: URL.
 */
export function paymentLink(env: Record<string, string | undefined> = process.env): string {
  const configured = (env.PAYMENT_LINK ?? "").trim();
  if (configured.length === 0) return "https://sociabuzz.com/minetallestmc/tribe";

  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return "https://sociabuzz.com/minetallestmc/tribe";
    }
    return url.toString();
  } catch {
    return "https://sociabuzz.com/minetallestmc/tribe";
  }
}
