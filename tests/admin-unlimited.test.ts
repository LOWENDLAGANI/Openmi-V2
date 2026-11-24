import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

/**
 * The operator "unlimited daily runs" control, against the real migrations:
 * only an admin can set it, it can be revoked, and a member cannot set it on
 * themselves through a plain profile update.
 */

const ROOT = join(import.meta.dir, "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEMBER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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
     values ($1, 'admin@example.test', '{}'::jsonb),
            ($2, $3, '{}'::jsonb)`,
    [ADMIN, MEMBER, MEMBER_EMAIL]
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
  await db.query("update public.profiles set unlimited_runs = false where id = $1", [
    MEMBER,
  ]);
});

async function actAs(id: string) {
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: id, role: "authenticated" }),
  ]);
  await db.exec("set role authenticated");
}

async function flag(): Promise<boolean> {
  await db.exec("reset role");
  const { rows } = await db.query<{ unlimited_runs: boolean }>(
    "select unlimited_runs from public.profiles where id = $1",
    [MEMBER]
  );
  return rows[0].unlimited_runs;
}

test("an operator grants and revokes unlimited", async () => {
  await actAs(ADMIN);
  await db.query("select * from public.admin_set_unlimited($1, true)", [MEMBER]);
  expect(await flag()).toBe(true);

  await actAs(ADMIN);
  await db.query("select * from public.admin_set_unlimited($1, false)", [MEMBER]);
  expect(await flag()).toBe(false);
});

test("only an admin can grant unlimited", async () => {
  await actAs(MEMBER);
  await expect(
    db.query("select * from public.admin_set_unlimited($1, true)", [MEMBER])
  ).rejects.toThrow(/admin: not allowed/);
});

test("a member cannot set the flag on their own profile", async () => {
  await actAs(MEMBER);
  await expect(
    db.query("update public.profiles set unlimited_runs = true where id = $1", [MEMBER])
  ).rejects.toThrow(/permission denied/);
  expect(await flag()).toBe(false);
});

test("an unknown account is refused", async () => {
  await actAs(ADMIN);
  await expect(
    db.query(
      "select * from public.admin_set_unlimited('dddddddd-dddd-4ddd-8ddd-dddddddddddd', true)"
    )
  ).rejects.toThrow(/no account/);
});
