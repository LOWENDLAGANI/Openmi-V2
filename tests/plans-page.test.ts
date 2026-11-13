import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { PLANS, PLAN_IDS } from "../lib/billing/plans";

const page = () => readFileSync("app/pay/page.tsx", "utf8");
const admin = () => readFileSync("app/admin/page.tsx", "utf8");

test("the plans page sells the passes and nothing else", () => {
  const source = page();

  // Every list on the page — the cards, the receipt form's options and its
  // defaults — reads the same catalogue.
  expect(source).toContain("{PLANS.map(");
  expect(source).toContain("defaultValue={PLANS[0]?.id}");
  expect(source).not.toContain("OFFERED_PLANS");
});

test("every sellable plan is an expiring pass", () => {
  expect(PLAN_IDS).toEqual(["pass-15", "pass-30"]);

  for (const plan of PLANS) {
    // A plan without days would be the old permanent badge in disguise.
    expect(plan.days).toBeGreaterThan(0);
    expect(plan.price).toBeGreaterThan(0);
    expect(plan.dew).toBeGreaterThan(0);
  }
});

test("the database charges and extends exactly what the catalogue sells", () => {
  const sql = [
    readFileSync("supabase/migrations/038_subscription_passes.sql", "utf8"),
    readFileSync("supabase/migrations/039_payment_holes.sql", "utf8"),
  ].join("\n");

  // The price and the days live in SQL as well as here; drift in either place
  // would sell something the database does not honour.
  for (const plan of PLANS) {
    expect(sql).toContain(`when '${plan.id}' then ${plan.price}`);
    expect(sql).toContain(`when '${plan.id}' then ${plan.days}`);
  }
});

test("the admin panel still tops up a balance by hand", () => {
  const source = admin();

  expect(source).toContain("Top up a balance");
  expect(source).toContain("grantDew");
});

test("the admin member list shows when a pass ends", () => {
  const source = admin();

  // paid_until is the entitlement; an operator reading the list needs the date,
  // not only the paid/free pill.
  expect(source).toContain("passLabel(member.paid_until)");
  expect(source).toContain("pass until");
  expect(source).toContain("pass ended");
});
