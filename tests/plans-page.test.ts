import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const page = () => readFileSync("app/pay/page.tsx", "utf8");
const admin = () => readFileSync("app/admin/page.tsx", "utf8");

test("the plans page offers the paid passes, not the one-off top-up packs", () => {
  const source = page();

  expect(source).toContain(
    "const OFFERED_PLANS = PLANS.filter((plan) => plan.days !== undefined)"
  );
  expect(source).toContain("OFFERED_PLANS.map");
  // Every list on the page — the cards, the receipt form's options and its
  // default — reads the filtered set, so a hidden pack cannot be picked.
  // A word boundary on the left keeps this from matching OFFERED_PLANS.
  expect(/[^\w]PLANS\.map/.test(source)).toBe(false);
  expect(/[^\w]PLANS\[/.test(source)).toBe(false);
});

test("the admin panel still tops up a balance by hand", () => {
  const source = admin();

  expect(source).toContain("Top up a balance");
  expect(source).toContain("grantDew");
});
