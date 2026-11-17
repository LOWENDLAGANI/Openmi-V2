import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * What these pin: where a refunded hour lands, what a refund does to the hour,
 * and who pays for a turn that never started.
 *
 * Each one is a real defect that was in the deployed paid path:
 *
 *   - every refund went to the wallet, so a refunded free hour became permanent
 *     paid credit that the daily refill then replaced — free credit, daily;
 *   - a refunded hour kept its `expires_at`, so the Credit came back and the
 *     hour stayed live as well;
 *   - a pass approved at noon raised tomorrow's allowance but not today's, so
 *     "15 Credit a day" read 6 until midnight;
 *   - an hour charged for a turn stopped by a quota or a queue failure stayed
 *     charged, because the refund only covered a run that had started.
 */

const read = (path: string) =>
  readFileSync(new URL(`..${path}`, import.meta.url), "utf8");

const PAID_PATH = read("/supabase/migrations/057_paid_path.sql");
const ROUTE = read("/app/api/chat/route.ts");

test("a refund returns the hour to the buckets that paid for it", () => {
  // The charge: daily balance first, wallet for the rest.
  expect(PAID_PATH).toContain("credit_balance = credit_balance + v_from_balance");
  expect(PAID_PATH).toContain("wallet_credit = wallet_credit + v_from_wallet");

  // Where each part came from: the session's own charge rows.
  expect(PAID_PATH).toContain("and t.kind = 'session'");
  expect(PAID_PATH).toContain("and t.note = 'paid from wallet credit'");

  // The old behaviour — the whole price into the wallet — is gone. A refund
  // that mints permanent credit out of renewable daily allowance is the bug.
  expect(PAID_PATH).not.toContain("wallet_credit = wallet_credit + v_amount");
  expect(PAID_PATH).not.toContain("credit_balance = credit_balance + v_amount");

  // The refund never pays more than the hour cost.
  expect(PAID_PATH).toContain("least(greatest(v_from_balance, 0), v_amount)");
  expect(PAID_PATH).toContain("v_from_wallet := v_amount - v_from_balance");
});

test("a refund ends the hour it gives back", () => {
  expect(PAID_PATH).toContain("expires_at = least(expires_at, now())");
  // And it is still stamped once, next to the ending.
  expect(PAID_PATH).toContain("refunded_at = now()");
});

test("a refund is still one per session, and still server-only", () => {
  expect(PAID_PATH).toContain("already refunded");

  // One refund row per function body: the unique index allows no more.
  const ownerBody = PAID_PATH.split("(p_owner, 'refund', v_amount").length - 1;
  const callerBody = PAID_PATH.split("(v_uid, 'refund', v_amount").length - 1;
  expect(ownerBody).toBe(1);
  expect(callerBody).toBe(1);

  // A browser must not be able to return an hour to itself.
  expect(PAID_PATH).toContain("revoke all on function public.refund_hour_session(uuid, uuid, text)");
  expect(PAID_PATH).toContain("revoke all on function public.refund_hour_session(uuid, text)");
  expect(PAID_PATH).toContain("grant execute on function public.refund_hour_session(uuid, uuid, text)");
  expect(PAID_PATH).not.toContain(
    "grant execute on function public.refund_hour_session(uuid, uuid, text)\n      to authenticated"
  );
});

test("a pass approved today raises today's allowance too", () => {
  // The same rule the daily refill uses: top up to the paid allowance.
  expect(PAID_PATH).toContain("v_topup := greatest(0, 15 - v_balance)");
  // Only for a day that has already been settled; an unsettled day is the
  // next refill's job, and settling it twice would double the allowance.
  expect(PAID_PATH).toContain("if v_day is not null and v_day >= v_today then");
  expect(PAID_PATH).toContain("'paid allowance on the day the pass was approved'");
  // Only a plan with days moves the allowance; a legacy pack does not.
  expect(PAID_PATH).toContain("if v_days > 0 then");
});

test("an hour charged for a turn that never started is given back", () => {
  expect(ROUTE).toContain("refundCreditSession");
  expect(ROUTE).toContain("const refundChargedHour = async (reason: string)");

  // Only an hour this request bought: an hour that was already running was paid
  // for by an earlier message.
  expect(ROUTE).toContain("if (!credit.session.started || !credit.session.sessionId) return;");

  // Every exit between the charge and the queued run.
  const calls = ROUTE.split("await refundChargedHour(").length - 1;
  expect(calls).toBeGreaterThanOrEqual(5);

  expect(ROUTE).toContain('"the message was not saved"');
  expect(ROUTE).toContain('"the turn was over the account\'s quota"');
  expect(ROUTE).toContain('"the turn could not be queued"');
  expect(ROUTE).toContain('"another turn was already running"');

  // And the charge still happens before any of them.
  expect(ROUTE.indexOf("startCreditSession(")).toBeLessThan(
    ROUTE.indexOf("refundChargedHour(")
  );
});
