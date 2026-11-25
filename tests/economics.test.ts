import { expect, test } from "bun:test";

import {
  cheapestCreditPrice,
  passAllowanceCredit,
  passEconomics,
  passMargin,
} from "../lib/billing/economics";
import { PLANS } from "../lib/billing/plans";
import { CREDIT_PER_HOUR, DAILY_FREE_CREDIT, PAID_DAILY_FREE_CREDIT } from "../lib/credits";

const PASS_15 = PLANS[0];
const PASS_30 = PLANS[1];

test("a pass is its daily allowance times its days, plus the wallet grant", () => {
  expect(PASS_15).toBeDefined();
  expect(PASS_30).toBeDefined();

  expect(passAllowanceCredit(PASS_15)).toBe(
    PASS_15.days * PAID_DAILY_FREE_CREDIT + PASS_15.credit
  );
  expect(passAllowanceCredit(PASS_15)).toBe(15 * 15 + 2);
  expect(passAllowanceCredit(PASS_30)).toBe(30 * 15 + 3);
});

test("the wallet grant is a rounding error next to the daily allowance", () => {
  for (const plan of PLANS) {
    const economics = passEconomics(plan);

    // After the cut from 30/70 to 2/3 the "upfront wallet Credit" bullet is
    // under a percent of what the pass is worth, so the copy should not imply
    // it is a reason to buy.
    expect(economics.walletShare).toBeLessThan(0.01);
    expect(economics.allowanceCredit).toBeGreaterThan(plan.credit * 50);
  }
});

test("both passes sell Credit at the same price", () => {
  const fifteen = passEconomics(PASS_15);
  const thirty = passEconomics(PASS_30);

  // The lengths differ; the unit price must not. A pass that quietly sells the
  // same Credit for more is a pricing bug, not a bundle.
  expect(fifteen.creditPrice).toBeCloseTo(thirty.creditPrice, 3);
  expect(cheapestCreditPrice(PLANS)).toBeCloseTo(fifteen.creditPrice, 6);
});

test("the published economics match the catalogue", () => {
  const fifteen = passEconomics(PASS_15);
  const thirty = passEconomics(PASS_30);

  // Credit price: RM18 / 227 and RM36 / 453.
  expect(fifteen.creditPrice).toBeCloseTo(0.0793, 3);
  expect(thirty.creditPrice).toBeCloseTo(0.0795, 3);

  // Hours: 227 / 3 and 453 / 3 at the catalogue's hourly price.
  expect(fifteen.chatHours).toBeCloseTo(75.67, 2);
  expect(thirty.chatHours).toBeCloseTo(151, 2);
  expect(fifteen.allowanceCredit / CREDIT_PER_HOUR).toBe(fifteen.chatHours);

  // Revenue per chat hour is around a quarter ringgit.
  expect(fifteen.revenuePerChatHour).toBeCloseTo(0.238, 3);
  expect(thirty.revenuePerChatHour).toBeCloseTo(0.238, 3);
});

test("the margin turns at the cost per chat hour", () => {
  const cheap = passMargin(PASS_15, 0.05);
  expect(cheap.gross).toBeGreaterThan(0);
  expect(cheap.multiple).toBeCloseTo(18 / (0.05 * 75.6667), 2);

  // A model that costs more per hour than the pass charges per hour sells at a
  // loss. This is the number the pricing decision has to be made against.
  const expensive = passMargin(PASS_15, 0.5);
  expect(expensive.gross).toBeLessThan(0);
  expect(expensive.multiple).toBeLessThan(1);

  // Break-even sits at revenue ÷ hours: about RM 0.238 per chat hour.
  const breakEven = passMargin(PASS_15, passEconomics(PASS_15).revenuePerChatHour);
  expect(breakEven.gross).toBeCloseTo(0, 6);
  expect(breakEven.multiple).toBeCloseTo(1, 6);
});

test("the free tier is not free at the pass price", () => {
  const { creditPrice } = passEconomics(PASS_15);

  // 6 Credit a day is about 48 sen of Credit at the price a pass sells it for.
  expect(DAILY_FREE_CREDIT * creditPrice).toBeCloseTo(0.476, 2);
});
