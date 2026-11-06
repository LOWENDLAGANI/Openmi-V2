/**
 * Paid plans and where the money goes.
 *
 * Payment is hosted elsewhere (Sociabuzz). This app never sees a card number:
 * it shows the link, then accepts the receipt the payer uploads. A request is
 * created in `payment_requests` with status `pending` and stays visible on the
 * plans page until an operator approves or rejects it.
 *
 * Two kinds of plan: a one-off pack of Dew, and a timed pass that also raises
 * the daily allowance. The pass ids are mirrored in
 * `supabase/migrations/019_chat_billing_modes.sql`; a plan the database does
 * not know is refused at submission rather than stored as a string.
 */

export type PlanId = "starter" | "pro" | "studio" | "pass-15" | "pass-30";

export type Plan = {
  id: PlanId;
  name: string;
  /** Price in the currency the hosted page charges (RM). */
  price: number;
  /** Dew granted when a receipt for this plan is approved. */
  dew: number;
  /** Days of paid allowance a pass covers. Packs are one-off, so no days. */
  days?: number;
  blurb: string;
};

export const PLANS: readonly Plan[] = [
  {
    id: "pass-15",
    name: "15-day pass",
    price: 18,
    dew: 30,
    days: 15,
    blurb: "Fifteen days at the paid allowance, paid once.",
  },
  {
    id: "pass-30",
    name: "30-day pass",
    price: 36,
    dew: 70,
    days: 30,
    blurb: "A month at the paid allowance, paid once.",
  },
  {
    id: "starter",
    name: "Starter",
    price: 15,
    dew: 20,
    blurb: "Roughly six chat hours, and the paid daily allowance.",
  },
  {
    id: "pro",
    name: "Pro",
    price: 35,
    dew: 50,
    blurb: "Roughly sixteen chat hours, for a project week.",
  },
  {
    id: "studio",
    name: "Studio",
    price: 60,
    dew: 100,
    blurb: "Roughly thirty-three hours, for a long sprint.",
  },
];

export const PLAN_IDS = PLANS.map((plan) => plan.id);

/**
 * What a paid account actually gets. Shown next to the plans, and the same
 * list the daily refill implements: fifteen Dew a day instead of six.
 */
export const PAID_BENEFITS = [
  "Bumped up to 15 Dew a day",
  "Priority support",
  "More usage",
  "Everything in free",
] as const;

/**
 * Real-money top-ups are paused while the payment path is being tested.
 *
 * A code still works, because an operator hands it out and no checkout is
 * involved. The flag is a constant rather than an environment variable so the
 * page, the copy and its test cannot disagree about whether checkout is live.
 */
export const TOPUP_PAUSED = true;



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
