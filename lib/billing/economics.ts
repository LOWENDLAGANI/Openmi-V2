/**
 * What a pass is actually worth, in Credit and in ringgit.
 *
 * The pass price is not what the member buys: the price buys a daily allowance
 * for a fixed number of days plus a small wallet grant. Those two numbers, not
 * the RM on the card, are what the model calls are charged against, so the
 * margin of a plan can only be read once they are converted into Credit and
 * hours. This module is that conversion, in one place, so a pricing page, an
 * admin table and a test cannot disagree about it.
 *
 * Everything is derived from `PLANS` and `lib/credits.ts`; no number is typed in
 * here, because a constant that lives twice drifts.
 */

import { CREDIT_PER_HOUR, PAID_DAILY_FREE_CREDIT } from "@/lib/credits";

import type { Plan } from "./plans";

export type PassEconomics = {
  /** Credit the pass puts in reach: daily allowance × days, plus the wallet grant. */
  allowanceCredit: number;
  /** Hours of chat that allowance buys at the catalogue's hourly price. */
  chatHours: number;
  /** Effective price of one Credit under this pass, in RM. */
  creditPrice: number;
  /** Revenue per chat hour: the pass price divided by the hours it includes. */
  revenuePerChatHour: number;
  /** The share of the allowance that sits in the wallet rather than the daily pool. */
  walletShare: number;
};

/**
 * The daily allowance is granted for each day of the pass, including the day it
 * starts, and the wallet grant is paid once at approval.
 */
export function passAllowanceCredit(plan: Plan): number {
  return plan.days * PAID_DAILY_FREE_CREDIT + plan.credit;
}

export function passEconomics(plan: Plan): PassEconomics {
  const allowanceCredit = passAllowanceCredit(plan);
  const chatHours = allowanceCredit / CREDIT_PER_HOUR;

  return {
    allowanceCredit,
    chatHours,
    creditPrice: plan.price / allowanceCredit,
    revenuePerChatHour: (plan.price * CREDIT_PER_HOUR) / allowanceCredit,
    walletShare: plan.credit / allowanceCredit,
  };
}

/**
 * Gross margin of a pass at a given model cost per chat hour.
 *
 * `costPerChatHour` is the provider's bill for one active hour, which is what
 * the margin depends on and what this repository does not yet measure. Callers
 * pass it in rather than assuming it: an assumed cost that is published in a
 * table is exactly the kind of number that stops being true without a test
 * failing.
 */
export function passMargin(
  plan: Plan,
  costPerChatHour: number
): {
  revenue: number;
  cost: number;
  gross: number;
  /** Revenue ÷ cost. Below 1 means the pass sells at a loss. */
  multiple: number;
} {
  const { chatHours } = passEconomics(plan);
  const revenue = plan.price;
  const cost = chatHours * costPerChatHour;

  return {
    revenue,
    cost,
    gross: revenue - cost,
    multiple: cost > 0 ? revenue / cost : Number.POSITIVE_INFINITY,
  };
}

/**
 * The cheapest Credit on sale, as RM per Credit.
 *
 * Two passes that sell the same Credit at visibly different prices are a
 * pricing mistake rather than a bundle, so this is the number the plans are
 * compared on — not the sticker price, which buys different lengths.
 */
export function cheapestCreditPrice(plans: readonly Plan[]): number {
  return Math.min(...plans.map((plan) => passEconomics(plan).creditPrice));
}
