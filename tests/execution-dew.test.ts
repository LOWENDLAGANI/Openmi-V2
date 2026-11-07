import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

/**
 * The billing contract for a sandbox run, executed against the real migrations.
 *
 * Three properties matter and each is checked here rather than argued for:
 *
 *  1. A reservation the balance cannot cover refunds nothing and writes
 *     nothing — the run is refused before it starts.
 *  2. Settlement never charges more than was reserved, whatever the caller
 *     passes.
 *  3. The ledger still sums to the cached balance after every movement, and a
 *     second settle for the same run is a no-op.
 */

const ROOT = join(import.meta.dir, "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

const OWNER = "55555555-5555-4555-8555-555555555555";

const RUN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RUN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RUN_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

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
  grant execute on all functions in schema public to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
`;

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SHIM);

  for (const file of readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }

  await db.query("insert into auth.users (id, email) values ($1, $2)", [
    OWNER,
    "run@example.test",
  ]);

  // The trial is paid on first use now, so the test pays it the way the app
  // does before it measures the reservation.
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: OWNER, role: "authenticated" }),
  ]);
  await db.exec("set role authenticated");
  await db.query("select public.grant_trial_dew($1)", [
    "execution-test-address-01",
  ]);
  await db.exec("reset role");
});

afterAll(async () => {
  await db.close();
});

async function balance(): Promise<number> {
  const { rows } = await db.query<{ dew_balance: string }>(
    "select dew_balance from public.profiles where id = $1",
    [OWNER]
  );
  return Number(rows[0]?.dew_balance);
}

async function ledgerSum(): Promise<number> {
  const { rows } = await db.query<{ total: string }>(
    "select coalesce(sum(amount), 0) as total from public.dew_transactions where owner = $1",
    [OWNER]
  );
  return Number(rows[0]?.total ?? 0);
}

async function ledgerCount(kind: string, reference?: string): Promise<number> {
  const { rows } = reference
    ? await db.query<{ count: number }>(
        "select count(*)::int as count from public.dew_transactions where owner = $1 and kind = $2 and reference = $3",
        [OWNER, kind, reference]
      )
    : await db.query<{ count: number }>(
        "select count(*)::int as count from public.dew_transactions where owner = $1 and kind = $2",
        [OWNER, kind]
      );

  return Number(rows[0]?.count ?? 0);
}

test("a run reserves its cap before anything is created", async () => {
  const { rows } = await db.query<{ balance: string }>(
    "select public.execution_reserve_dew($1, $2, 0.5) as balance",
    [OWNER, RUN_A]
  );

  // The first request granted five Dew; the reservation takes half of one.
  expect(Number(rows[0].balance)).toBe(4.5);
  expect(await ledgerCount("execution", RUN_A)).toBe(1);
  expect(await ledgerSum()).toBe(4.5);
});

test("settlement charges the minutes used and returns the rest", async () => {
  const { rows } = await db.query<{ balance: string }>(
    "select public.execution_settle_dew($1, $2, 0.15) as balance",
    [OWNER, RUN_A]
  );

  expect(Number(rows[0].balance)).toBe(4.85);
  expect(await ledgerCount("execution_refund", RUN_A)).toBe(1);
  expect(await ledgerSum()).toBe(4.85);
});

test("settling twice does not refund twice", async () => {
  const { rows } = await db.query<{ balance: string }>(
    "select public.execution_settle_dew($1, $2, 0.15) as balance",
    [OWNER, RUN_A]
  );

  expect(Number(rows[0].balance)).toBe(4.85);
  expect(await ledgerCount("execution_refund", RUN_A)).toBe(1);
  expect(await ledgerSum()).toBe(4.85);
});

test("a caller cannot charge more than was reserved", async () => {
  const reserved = await db.query<{ balance: string }>(
    "select public.execution_reserve_dew($1, $2, 0.5) as balance",
    [OWNER, RUN_B]
  );
  expect(Number(reserved.rows[0].balance)).toBe(4.35);

  // Ten Dew of claimed usage against a half-Dew reservation.
  const settled = await db.query<{ balance: string }>(
    "select public.execution_settle_dew($1, $2, 10) as balance",
    [OWNER, RUN_B]
  );

  expect(Number(settled.rows[0].balance)).toBe(4.35);
  expect(await ledgerCount("execution_refund", RUN_B)).toBe(0);
  expect(await ledgerSum()).toBe(4.35);
});

test("an unaffordable reservation is refused and writes nothing", async () => {
  // Spend down through the ledger, not by editing the balance: the
  // "sum equals balance" property has to stay meaningful for the last test.
  await db.query("select public.operator_adjust_dew($1, -4.25, 'spend down')", [
    OWNER,
  ]);

  await expect(
    db.query("select public.execution_reserve_dew($1, $2, 0.5)", [OWNER, RUN_C])
  ).rejects.toThrow(/insufficient balance/);

  expect(await ledgerCount("execution", RUN_C)).toBe(0);
  expect(await ledgerSum()).toBe(await balance());
});

test("a reservation can only exist once per run", async () => {
  await db.query("select public.operator_adjust_dew($1, 4.9, 'top up for the test')", [
    OWNER,
  ]);

  await db.query("select public.execution_reserve_dew($1, $2, 0.5)", [OWNER, RUN_C]);

  await expect(
    db.query("select public.execution_reserve_dew($1, $2, 0.5)", [OWNER, RUN_C])
  ).rejects.toThrow(/duplicate key|unique/i);

  expect(await ledgerCount("execution", RUN_C)).toBe(1);
});

test("the run functions are not callable by a signed-in account", async () => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: OWNER, role: "authenticated" }),
  ]);
  await db.exec("set role authenticated");

  await expect(
    db.query("select public.execution_reserve_dew($1, $2, 0.5)", [
      OWNER,
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    ])
  ).rejects.toThrow(/permission denied/);

  await db.exec("reset role");
});

test("every cached balance still equals the sum of its ledger", async () => {
  await db.exec("reset role");

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
