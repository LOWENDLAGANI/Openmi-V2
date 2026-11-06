import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

/**
 * The billing-mode gate, executed against the real migrations.
 *
 * Three rules are asserted here because the browser must not be able to bend
 * them: a request costs the price the database says, an hour belongs to one
 * chat, and a split charge happens only when the two balances together cover it.
 */

const ROOT = join(import.meta.dir, "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHAT_A = "11111111-2222-4333-8444-555555555555";
const CHAT_B = "66666666-7777-4888-8999-000000000000";

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

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SHIM);

  for (const file of readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }

  await db.query(
    "insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}'::jsonb)",
    [A, "modes@example.test"]
  );

  await db.query(
    "insert into public.chats (id, owner, title) values ($1, $2, 'one'), ($3, $2, 'two')",
    [CHAT_A, A, CHAT_B]
  );
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec("reset role");
  // Pin today's refill so a charge test measures the charge, not the allowance.
  await db.query(
    `update public.profiles
        set dew_balance = 10,
            wallet_dew = 0,
            dew_day = (now() at time zone timezone)::date
      where id = $1`,
    [A]
  );
  await db.query("delete from public.hour_sessions where owner = $1", [A]);
  await db.query("delete from public.dew_transactions where owner = $1", [A]);
});

async function actAsOwner() {
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: A, role: "authenticated" }),
  ]);
  await db.exec("set role authenticated");
}

async function balances() {
  await db.exec("reset role");
  const { rows } = await db.query<{ dew_balance: string; wallet_dew: string }>(
    "select dew_balance, wallet_dew from public.profiles where id = $1",
    [A]
  );
  return {
    balance: Number(rows[0].dew_balance),
    wallet: Number(rows[0].wallet_dew),
  };
}

test("a request charges two Dew and is recorded as a request", async () => {
  await actAsOwner();

  const { rows } = await db.query<{ price: string; combined: boolean }>(
    "select * from public.charge_chat_request('deepseek-chat', $1, 'octocat/hello')",
    [CHAT_A]
  );

  expect(Number(rows[0].price)).toBe(2);
  expect(rows[0].combined).toBe(false);
  expect((await balances()).balance).toBe(8);

  await db.exec("reset role");
  const ledger = await db.query<{ kind: string; amount: string }>(
    "select kind, amount from public.dew_transactions where owner = $1",
    [A]
  );
  expect(ledger.rows).toHaveLength(1);
  expect(ledger.rows[0].kind).toBe("request");
  expect(Number(ledger.rows[0].amount)).toBe(-2);
});

test("an hour in another chat refuses both a new hour and a request", async () => {
  await actAsOwner();

  const started = await db.query<{ started: boolean; balance: string }>(
    "select * from public.start_hour_session('auto', 'octocat/hello', $1)",
    [CHAT_A]
  );
  expect(started.rows[0].started).toBe(true);
  expect(Number(started.rows[0].balance)).toBe(8);

  // Same chat, same hour: reused, free, and not an error.
  const reused = await db.query<{ started: boolean; balance: string }>(
    "select * from public.start_hour_session('auto', 'octocat/hello', $1)",
    [CHAT_A]
  );
  expect(reused.rows[0].started).toBe(false);
  expect(Number(reused.rows[0].balance)).toBe(8);

  await expect(
    db.query("select * from public.start_hour_session('auto', null, $1)", [CHAT_B])
  ).rejects.toThrow(/hour active/);

  await expect(
    db.query("select * from public.charge_chat_request('auto', $1)", [CHAT_B])
  ).rejects.toThrow(/hour active/);

  expect((await balances()).balance).toBe(8);
});

test("an hour is priced by its model and locked to it", async () => {
  await actAsOwner();

  const started = await db.query<{ price: string; started: boolean }>(
    "select * from public.start_hour_session('gpt-oss-120b', null, $1)",
    [CHAT_A]
  );
  expect(started.rows[0].started).toBe(true);
  expect(Number(started.rows[0].price)).toBe(2);

  // Same chat, same model: the hour is reused and costs nothing.
  const again = await db.query<{ price: string; started: boolean }>(
    "select * from public.start_hour_session('gpt-oss-120b', null, $1)",
    [CHAT_A]
  );
  expect(again.rows[0].started).toBe(false);
  expect(Number(again.rows[0].price)).toBe(2);

  // A turn for another model cannot ride an hour it did not pay for.
  await expect(
    db.query("select * from public.start_hour_session('deepseek-flash', null, $1)", [
      CHAT_A,
    ])
  ).rejects.toThrow(/hour on model/);

  expect((await balances()).balance).toBe(8);
});

test("ending the hour lets the current chat start a new one", async () => {
  await actAsOwner();
  await db.query("select * from public.start_hour_session('auto', null, $1)", [CHAT_A]);

  const ended = await db.query<{ end_hour_session: boolean }>(
    "select public.end_hour_session() as end_hour_session"
  );
  expect(ended.rows[0].end_hour_session).toBe(true);

  const started = await db.query<{ started: boolean; balance: string }>(
    "select * from public.start_hour_session('auto', null, $1)",
    [CHAT_B]
  );
  expect(started.rows[0].started).toBe(true);
  expect(Number(started.rows[0].balance)).toBe(6);
});

test("the wallet pays only what the balance cannot, and only when it covers it", async () => {
  await db.exec("reset role");
  await db.query(
    "update public.profiles set dew_balance = 1, wallet_dew = 5 where id = $1",
    [A]
  );

  await actAsOwner();
  const { rows } = await db.query<{ combined: boolean }>(
    "select * from public.charge_chat_request('auto', $1)",
    [CHAT_A]
  );

  expect(rows[0].combined).toBe(true);
  expect(await balances()).toEqual({ balance: 0, wallet: 4 });

  await db.exec("reset role");
  const ledger = await db.query<{ kind: string; amount: string }>(
    "select kind, amount from public.dew_transactions where owner = $1 order by kind",
    [A]
  );
  expect(ledger.rows.map((row) => [row.kind, Number(row.amount)])).toEqual([
    ["adjustment", -1],
    ["request", -1],
  ]);

  // One Dew of balance and three of wallet cannot cover two Dew of hour.
  await db.exec("reset role");
  await db.query(
    "update public.profiles set dew_balance = 0, wallet_dew = 1 where id = $1",
    [A]
  );

  await actAsOwner();
  await expect(
    db.query("select * from public.charge_chat_request('auto', $1)", [CHAT_A])
  ).rejects.toThrow(/insufficient balance/);

  expect(await balances()).toEqual({ balance: 0, wallet: 1 });
});
