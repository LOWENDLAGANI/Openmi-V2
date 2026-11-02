/**
 * Paid plans and where the money goes.
 *
 * Payment is hosted elsewhere (Sociabuzz). This app never sees a card number:
 * it shows the link, then accepts the receipt the payer uploads. A request is
 * created in `payment_requests` with status `pending` and stays visible on the
 * plans page until an operator approves or rejects it.
 */

export type PlanId = "starter" | "pro" | "studio";

export type Plan = {
  id: PlanId;
  name: string;
  /** Price in the currency the hosted page charges (RM). */
  price: number;
  /** Dew granted when a receipt for this plan is approved. */
  dew: number;
  blurb: string;
};

export const PLANS: readonly Plan[] = [
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

export const PAYMENT_LINK_FALLBACK = "https://sociabuzz.com/minetallestmc/tribe";

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
  if (configured.length === 0) return PAYMENT_LINK_FALLBACK;

  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return PAYMENT_LINK_FALLBACK;
    }
    return url.toString();
  } catch {
    return PAYMENT_LINK_FALLBACK;
  }
}
