import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

/**
 * The phase 7 gate, executed against the real migrations.
 *
 * Every balance change runs through a function with RLS and a signed-in role,
 * exactly as the app calls it. The last test asserts the property the whole
 * design rests on: for every account, the ledger sums to the cached balance.
 */

const ROOT = join(import.meta.dir, "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const MIGRATION_SOURCE = readFileSync(join(MIGRATIONS, "008_dew.sql"), "utf8");

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "77777777-7777-4777-8777-777777777777";
const D = "44444444-4444-4444-8444-444444444444";
const E = "55555555-5555-4555-8555-555555555555";

// Keyed hashes, as the server sends them: never an address.
const IP_ONE = "1111111111111111aaaaaaaaaaaaaaaa";
const IP_TWO = "2222222222222222bbbbbbbbbbbbbbbb";

const SHIM = `
  create schema if not exists auth;
  create table if not exists auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  create or replace function auth.uid() returns uuid
    language sql stable
    as $$
      select nullif(
        current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
        ''
      )::uuid
    $$;

  do $$
  begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
      create role anon nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated nologin;
    end if;
  end
  $$;

  grant usage on schema public to anon, authenticated;
  grant usage on schema auth to anon, authenticated;
  grant usage, select on all sequences in schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  grant execute on all functions in schema public to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;

let db: PGlite;
let inviteA = "";
let sessionA = "";

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SHIM);

  for (const file of readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
});

afterAll(async () => {
  await db.close();
});

async function reset() {
  await db.exec("reset role");
}

async function actAs(role: "authenticated" | "anon", sub: string | null) {
  await reset();
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify(sub ? { sub, role } : { role }),
  ]);
  await db.exec(`set role ${role}`);
}

async function signUp(id: string, email: string, inviteCode = "") {
  await reset();
  await db.query(
    "insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)",
    [id, email, JSON.stringify(inviteCode ? { invite_code: inviteCode } : {})]
  );
}

async function balance(owner: string): Promise<number> {
  await reset();
  const { rows } = await db.query<{ dew_balance: string }>(
    "select dew_balance from public.profiles where id = $1",
    [owner]
  );
  return Number(rows[0]?.dew_balance ?? Number.NaN);
}

async function ledgerSum(owner: string): Promise<number> {
  await reset();
  const { rows } = await db.query<{ total: string }>(
    "select coalesce(sum(amount), 0) as total from public.dew_transactions where owner = $1",
    [owner]
  );
  return Number(rows[0]?.total ?? 0);
}

async function ledgerCount(owner: string, kind: string): Promise<number> {
  await reset();
  const { rows } = await db.query<{ count: number }>(
    "select count(*)::int as count from public.dew_transactions where owner = $1 and kind = $2",
    [owner, kind]
  );
  return Number(rows[0]?.count ?? 0);
}

test("the hourly session function takes no price parameter", () => {
  expect(MIGRATION_SOURCE).toContain(
    "create or replace function public.start_hour_session("
  );
  expect(MIGRATION_SOURCE).not.toMatch(/start_hour_session\([^)]*p_amount/i);
});

test("signup writes a profile and an invite code, and no Dew yet", async () => {
  await signUp(A, "a@example.test");

  // The account exists; the trial is not paid until it is used.
  expect(await balance(A)).toBe(0);

  await reset();
  const { rows } = await db.query<{ invite_code: string }>(
    "select invite_code from public.profiles where id = $1",
    [A]
  );
  inviteA = String(rows[0].invite_code);
  expect(inviteA).toHaveLength(8);

  expect(await ledgerCount(A, "trial")).toBe(0);
  expect(await ledgerSum(A)).toBe(0);
});

test("the trial is a service-role grant, once, and once per address", async () => {
  await actAs("authenticated", A);
  await expect(
    db.query("select public.grant_trial_dew($1) as amount", [IP_ONE])
  ).rejects.toThrow(/permission denied/);

  await reset();
  const granted = await db.query<{ amount: string }>(
    "select public.grant_trial_dew($1, $2) as amount",
    [A, IP_ONE]
  );
  expect(Number(granted.rows[0].amount)).toBe(5);
  expect(await balance(A)).toBe(5);
  expect(await ledgerCount(A, "trial")).toBe(1);
  expect(await ledgerSum(A)).toBe(5);

  // Asking twice from the same account pays nothing.
  const again = await db.query<{ amount: string }>(
    "select public.grant_trial_dew($1, $2) as amount",
    [A, IP_ONE]
  );
  expect(Number(again.rows[0].amount)).toBe(0);
  expect(await ledgerCount(A, "trial")).toBe(1);

  // A second account on the same address is not paid either.
  await signUp(C, "c@example.test");
  const refused = await db.query<{ amount: string }>(
    "select public.grant_trial_dew($1, $2) as amount",
    [C, IP_ONE]
  );
  expect(Number(refused.rows[0].amount)).toBe(0);
  expect(await balance(C)).toBe(0);
  expect(await ledgerCount(C, "trial")).toBe(0);
});

test("the daily allowance refills once, at the local day", async () => {
  await reset();

  // The trial is paid on first use; asking again here is a no-op.
  await db.query("select public.grant_trial_dew($1, $2)", [A, IP_ONE]);

  await actAs("authenticated", A);
  const first = await db.query<{ balance: string }>(
    "select public.refill_daily_dew() as balance"
  );
  // Five trial Dew plus the six Dew free allowance.
  expect(Number(first.rows[0].balance)).toBe(11);

  const second = await db.query<{ balance: string }>(
    "select public.refill_daily_dew() as balance"
  );
  expect(Number(second.rows[0].balance)).toBe(11);

  expect(await ledgerCount(A, "daily")).toBe(1);
  expect(await ledgerSum(A)).toBe(11);
});

test("an hour is charged once and reused inside the hour", async () => {
  await actAs("authenticated", A);

  const started = await db.query<{
    session_id: string;
    started: boolean;
    balance: string;
    price: string;
  }>("select * from public.start_hour_session('auto', 'octocat/hello')");

  expect(started.rows[0].started).toBe(true);
  expect(Number(started.rows[0].price)).toBe(2);
  expect(Number(started.rows[0].balance)).toBe(9);

  sessionA = String(started.rows[0].session_id);

  const again = await db.query<{
    session_id: string;
    started: boolean;
    balance: string;
  }>("select * from public.start_hour_session('auto', 'octocat/hello')");

  expect(again.rows[0].started).toBe(false);
  expect(String(again.rows[0].session_id)).toBe(sessionA);
  expect(Number(again.rows[0].balance)).toBe(9);

  await reset();
  const sessions = await db.query<{ count: number }>(
    "select count(*)::int as count from public.hour_sessions where owner = $1",
    [A]
  );
  expect(Number(sessions.rows[0].count)).toBe(1);

  expect(await ledgerCount(A, "session")).toBe(1);
  expect(await ledgerSum(A)).toBe(9);
});

test("a refund is service-role only, and happens once", async () => {
  await actAs("authenticated", A);
  await expect(
    db.query("select public.refund_hour_session($1, 'provider failed')", [sessionA])
  ).rejects.toThrow(/permission denied/);

  await reset();
  const refund = await db.query<{ balance: string }>(
    "select public.refund_hour_session($1, $2, 'provider failed') as balance",
    [A, sessionA]
  );
  expect(Number(refund.rows[0].balance)).toBe(11);

  await expect(
    db.query("select public.refund_hour_session($1, $2, 'again')", [A, sessionA])
  ).rejects.toThrow(/already refunded/);

  expect(await ledgerCount(A, "refund")).toBe(1);
  expect(await ledgerSum(A)).toBe(11);
});

test("a balance below one hour refuses the session before anything runs", async () => {
  await reset();
  await db.query(
    "update public.profiles set dew_balance = 1, dew_day = (now() at time zone timezone)::date where id = $1",
    [A]
  );
  await db.query(
    "update public.hour_sessions set expires_at = now() - interval '1 minute' where owner = $1",
    [A]
  );

  await actAs("authenticated", A);
  await expect(
    db.query("select * from public.start_hour_session('auto', null)")
  ).rejects.toThrow(/insufficient balance/);

  expect(await ledgerCount(A, "session")).toBe(1);

  await reset();
  await db.query("update public.profiles set dew_balance = 11 where id = $1", [A]);
});

test("a redeem code is service-role only, works once and adds Dew only", async () => {
  await reset();
  await db.query(
    "insert into public.dew_codes (code, dew_amount, kind, note) values ('TOPUP-20', 20, 'topup', 'test')"
  );

  await actAs("authenticated", A);
  await expect(
    db.query("select * from public.redeem_dew_code('topup-20')")
  ).rejects.toThrow(/permission denied/);

  // The owner is not the caller's to choose: a signed-in account can only
  // redeem into its own balance. The mismatch is refused before the code is
  // touched, so the code survives for its real owner.
  await expect(
    db.query(
      "select * from public.redeem_dew_code('99999999-9999-4999-8999-999999999999', 'topup-20')"
    )
  ).rejects.toThrow(/not your balance/);

  await reset();
  const redeemed = await db.query<{ amount: string; balance: string }>(
    "select * from public.redeem_dew_code($1, 'topup-20')",
    [A]
  );

  expect(Number(redeemed.rows[0].amount)).toBe(20);
  expect(Number(redeemed.rows[0].balance)).toBe(31);

  await expect(
    db.query("select * from public.redeem_dew_code($1, 'TOPUP-20')", [A])
  ).rejects.toThrow(/already redeemed/);

  await reset();
  const { rows } = await db.query<{
    has_paid: boolean;
    paid_until: string | null;
  }>("select has_paid, paid_until from public.profiles where id = $1", [A]);
  // A code is not a plan: under the subscription model it must not open the
  // paid window (or the allowance it controls).
  expect(rows[0].has_paid).toBe(false);
  expect(rows[0].paid_until).toBeNull();
  expect(await ledgerCount(A, "topup")).toBe(1);
});

test("a receipt reference is single-use and cannot underpay its plan", async () => {
  await reset();
  await actAs("authenticated", A);

  const first = await db.query<{ id: string }>(
    "select * from public.submit_payment_request('pass-15', 18, 'TX-REPLAY-1', null, $1)",
    [`${A}/first.pdf`]
  );
  expect(first.rows).toHaveLength(1);

  // Same transaction, second plan: already used, even with different casing.
  await expect(
    db.query(
      "select * from public.submit_payment_request('pass-30', 36, 'tx-replay-1', null, $1)",
      [`${A}/second.pdf`]
    )
  ).rejects.toThrow(/already submitted/);

  // A RM36 pass paid with RM35.99 would still open thirty paid days.
  await expect(
    db.query(
      "select * from public.submit_payment_request('pass-30', 35.99, 'TX-UNDER-1', null, $1)",
      [`${A}/third.pdf`]
    )
  ).rejects.toThrow(/below the plan price/);

  await reset();
  const { rows } = await db.query<{ count: number }>(
    "select count(*)::int as count from public.payment_requests where owner = $1 and reference like 'TX-%'",
    [A]
  );
  expect(Number(rows[0].count)).toBe(1);
});

test("a pass is a window: approval extends paid_until and grants its Dew", async () => {
  await signUp(E, "e@example.test");
  await reset();
  await db.query(
    "insert into public.admin_users (user_id, note) values ($1, 'test') on conflict (user_id) do nothing",
    [E]
  );

  const opened = await db.query<{ id: string }>(
    `insert into public.payment_requests
       (owner, plan, amount, reference, receipt_path, status)
     values ($1, 'pass-15', 18, 'ref-15', $2, 'pending')
     returning id`,
    [E, `${E}/receipt.pdf`]
  );

  await actAs("authenticated", E);
  await db.query(
    "select * from public.review_payment_request($1, 'approved', 'ok', 30)",
    [opened.rows[0].id]
  );

  const { rows } = await db.query<{
    has_paid: boolean;
    days: number;
    balance: string;
  }>(
    `select has_paid,
            extract(day from paid_until - now())::int as days,
            dew_balance as balance
       from public.profiles where id = $1`,
    [E]
  );

  expect(rows[0].has_paid).toBe(true);
  expect(Number(rows[0].days)).toBeGreaterThanOrEqual(14);
  expect(Number(rows[0].balance)).toBe(30);
});

test("operator aggregates are admin-only and self-revoke by id is refused", async () => {
  await actAs("authenticated", A);
  await expect(db.query("select public.admin_dew_held()")).rejects.toThrow(
    /admin: not allowed/
  );

  await actAs("authenticated", E);
  const held = await db.query<{ total: string }>(
    "select public.admin_dew_held() as total"
  );
  expect(Number(held.rows[0].total)).toBeGreaterThan(0);

  await expect(
    db.query("select * from public.admin_set_admin_id($1, false)", [E])
  ).rejects.toThrow(/cannot remove your own access/);
});

test("the daily allowance is 15 only while the pass is running", async () => {
  await reset();
  await db.query(
    `update public.profiles
        set dew_balance = 0,
            dew_day = (now() at time zone timezone)::date - 1,
            paid_until = now() + interval '2 days'
      where id = $1`,
    [E]
  );

  await actAs("authenticated", E);
  const paid = await db.query<{ balance: string }>(
    "select public.refill_daily_dew() as balance"
  );
  expect(Number(paid.rows[0].balance)).toBe(15);

  await reset();
  await db.query(
    `update public.profiles
        set dew_balance = 0,
            dew_day = (now() at time zone timezone)::date - 1,
            paid_until = now() - interval '1 day'
      where id = $1`,
    [E]
  );

  await actAs("authenticated", E);
  const ended = await db.query<{ balance: string }>(
    "select public.refill_daily_dew() as balance"
  );
  expect(Number(ended.rows[0].balance)).toBe(6);

  // These two checks set balances directly; restore the invariant the last test
  // asserts for every account, without touching anyone else's rows.
  await reset();
  await db.query(
    `update public.profiles
        set dew_balance = coalesce(
          (select sum(amount) from public.dew_transactions where owner = $1),
          0
        )
      where id = $1`,
    [E]
  );
});

test("operator correction is service-role only and stays in the ledger", async () => {
  await actAs("authenticated", A);
  await expect(
    db.query("select public.operator_adjust_dew($1, -5, 'correction')", [A])
  ).rejects.toThrow(/permission denied/);

  await reset();
  const adjusted = await db.query<{ balance: string }>(
    "select public.operator_adjust_dew($1, -5, 'correction') as balance",
    [A]
  );
  expect(Number(adjusted.rows[0].balance)).toBe(26);

  expect(await ledgerCount(A, "adjustment")).toBe(1);
  expect(await ledgerSum(A)).toBe(26);
});

test("both sides of an invite are rewarded once", async () => {
  await signUp(B, "b@example.test", inviteA);

  await reset();
  const inviter = await db.query<{ dew_balance: string }>(
    "select dew_balance from public.profiles where id = $1",
    [A]
  );
  expect(Number(inviter.rows[0].dew_balance)).toBe(31);

  const invitee = await db.query<{
    dew_balance: string;
    invited_by: string;
    invite_rewarded: boolean;
  }>("select dew_balance, invited_by, invite_rewarded from public.profiles where id = $1", [B]);

  expect(Number(invitee.rows[0].dew_balance)).toBe(5);
  expect(String(invitee.rows[0].invited_by)).toBe(A);
  expect(invitee.rows[0].invite_rewarded).toBe(true);

  expect(await ledgerCount(B, "invite")).toBe(1);
  expect(await ledgerSum(B)).toBe(5);

  // A different address still gets its own trial, so the invitee is paid on
  // first use exactly like anyone else who is not farming accounts.
  const trial = await db.query<{ amount: string }>(
    "select public.grant_trial_dew($1, $2) as amount",
    [B, IP_TWO]
  );
  expect(Number(trial.rows[0].amount)).toBe(5);
  expect(await balance(B)).toBe(10);
  expect(await ledgerSum(B)).toBe(10);
});

test("invite rewards stop at the per-account cap", async () => {
  const friends = Array.from(
    { length: 10 },
    (_, index) => `33333333-3333-4333-8333-${String(index + 1).padStart(12, "0")}`
  );

  for (const [index, id] of friends.entries()) {
    await signUp(id, `friend-${index}@example.test`, inviteA);
  }

  await reset();
  const rewarded = await db.query<{ count: number }>(
    "select count(*)::int as count from public.profiles where invited_by = $1 and invite_rewarded",
    [A]
  );
  expect(Number(rewarded.rows[0].count)).toBe(10);

  const last = friends[friends.length - 1];
  const beyond = await db.query<{ invited_by: string | null; invite_rewarded: boolean }>(
    "select invited_by, invite_rewarded from public.profiles where id = $1",
    [last]
  );
  expect(beyond.rows[0].invited_by).toBeNull();
  expect(beyond.rows[0].invite_rewarded).toBe(false);
  expect(await ledgerCount(last, "invite")).toBe(0);

  expect(await ledgerCount(A, "invite")).toBe(10);
});

test("a day ahead of the local date never refills", async () => {
  await signUp(D, "d@example.test");

  await reset();
  await db.query(
    "update public.profiles set dew_balance = 2, dew_day = (now() at time zone timezone)::date + 1 where id = $1",
    [D]
  );

  await actAs("authenticated", D);
  const refilled = await db.query<{ balance: string }>(
    "select public.refill_daily_dew() as balance"
  );

  expect(Number(refilled.rows[0].balance)).toBe(2);
  expect(await ledgerCount(D, "daily")).toBe(0);

  await reset();
  await db.query(
    "update public.profiles set dew_balance = 0, dew_day = null where id = $1",
    [D]
  );
});

test("another account cannot read or write the ledger", async () => {
  await actAs("authenticated", B);
  const seen = await db.query<{ owner: string }>(
    "select owner from public.dew_transactions"
  );

  expect(seen.rows.length).toBeGreaterThan(0);
  for (const row of seen.rows) expect(String(row.owner)).toBe(B);

  await expect(
    db.query(
      "insert into public.dew_transactions (owner, kind, amount, balance_after) values ($1, 'trial', 1, 1)",
      [B]
    )
  ).rejects.toThrow(/row-level security|permission denied/);

  await actAs("anon", null);
  await expect(db.query("select id from public.dew_transactions")).rejects.toThrow(
    /permission denied/
  );
});

test("every cached balance equals the sum of its ledger", async () => {
  await reset();
  const { rows } = await db.query<{
    id: string;
    dew_balance: string;
    total: string;
  }>(
    `select p.id, p.dew_balance, coalesce(sum(t.amount), 0) as total
       from public.profiles p
       left join public.dew_transactions t on t.owner = p.id
      group by p.id, p.dew_balance`
  );

  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(Number(row.dew_balance)).toBe(Number(row.total));
  }
});
