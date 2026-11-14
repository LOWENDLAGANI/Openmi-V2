import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

/**
 * The operator pass control, executed against the real migrations.
 *
 * A pass is an entitlement on `profiles.paid_until`, so the rules that matter
 * are: only an admin can set one, a grant extends a running window instead of
 * replacing it, and a revoke ends the window without erasing the history that a
 * pass was ever bought.
 */

const ROOT = join(import.meta.dir, "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEMBER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OUTSIDER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const MEMBER_EMAIL = "member@example.test";

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

type PassRow = { paid_until: string; has_paid: boolean };

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
    `insert into auth.users (id, email, raw_user_meta_data)
     values ($1, $2, '{}'::jsonb),
            ($3, $4, '{}'::jsonb),
            ($5, $6, '{}'::jsonb)`,
    [
      ADMIN,
      "admin@example.test",
      MEMBER,
      MEMBER_EMAIL,
      OUTSIDER,
      "outsider@example.test",
    ]
  );

  await db.query(
    "insert into public.admin_users (user_id, note) values ($1, 'test')",
    [ADMIN]
  );
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec("reset role");
  await db.query(
    "update public.profiles set paid_until = null, has_paid = false where id = $1",
    [MEMBER]
  );
});

async function actAs(id: string) {
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: id, role: "authenticated" }),
  ]);
  await db.exec("set role authenticated");
}

/** Days remaining in a pass, read from the RPC's own answer. */
function daysLeft(row: PassRow): number {
  return (Date.parse(row.paid_until) - Date.now()) / 86_400_000;
}

test("an operator grants a pass, and a second grant extends it", async () => {
  await actAs(ADMIN);

  const first = await db.query<PassRow>(
    "select * from public.admin_set_pass($1, 30)",
    [MEMBER_EMAIL]
  );

  expect(first.rows[0].has_paid).toBe(true);
  expect(daysLeft(first.rows[0])).toBeGreaterThan(29);

  // A running window is extended, never replaced: the later of now and the
  // current end is the base, exactly as receipt approval does it.
  const second = await db.query<PassRow>(
    "select * from public.admin_set_pass($1, 30)",
    [MEMBER_EMAIL]
  );

  expect(daysLeft(second.rows[0])).toBeGreaterThan(59);
});

test("a pass can be revoked, and the history stays", async () => {
  await actAs(ADMIN);
  await db.query("select * from public.admin_set_pass($1, 30)", [MEMBER_EMAIL]);

  const off = await db.query<PassRow>(
    "select * from public.admin_set_pass($1, 0)",
    [MEMBER_EMAIL]
  );

  // Revoking ends the window now; it does not rewrite history, because
  // `has_paid` records that a pass was bought and `paid_until` is the
  // entitlement.
  expect(Date.parse(off.rows[0].paid_until)).toBeLessThanOrEqual(
    Date.now() + 5_000
  );
  expect(off.rows[0].has_paid).toBe(true);
});

test("only an admin can set a pass", async () => {
  await actAs(MEMBER);

  await expect(
    db.query("select * from public.admin_set_pass($1, 30)", [MEMBER_EMAIL])
  ).rejects.toThrow(/admin: not allowed/);
});

test("an unknown address and an absurd term are refused", async () => {
  await actAs(ADMIN);

  await expect(
    db.query("select * from public.admin_set_pass('nobody@example.test', 30)")
  ).rejects.toThrow(/no account/);

  await expect(
    db.query("select * from public.admin_set_pass($1, 4000)", [MEMBER_EMAIL])
  ).rejects.toThrow(/between 0 and 3660/);
});
