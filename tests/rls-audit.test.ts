import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

/**
 * The phase 9 audit: not a list of tables somebody remembered, but every table
 * the migrations create.
 *
 * Three properties, each checked against the database rather than a document:
 *
 *  1. Every table in `public` has row-level security enabled.
 *  2. A table with no policy is also a table no client role can read — the
 *     service-only case is explicit, not an oversight.
 *  3. The anon role reads no rows from any table, and a second account reads no
 *     row owned by the first.
 *
 * A new table added without RLS fails the first check even if nobody updates
 * this file, which is the point.
 */

const ROOT = join(import.meta.dir, "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

const USER_A = "33333333-3333-4333-8333-333333333333";
const USER_B = "44444444-4444-4444-8444-444444444444";

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

  await db.query("insert into auth.users (id, email) values ($1, $2), ($3, $4)", [
    USER_A,
    "audit-a@example.test",
    USER_B,
    "audit-b@example.test",
  ]);
});

afterAll(async () => {
  await db.close();
});

async function actAs(role: "authenticated" | "anon", sub: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify(sub ? { sub, role } : { role }),
  ]);
  await db.exec(`set role ${role}`);
}

async function tables(): Promise<string[]> {
  const { rows } = await db.query<{ relname: string }>(
    `select c.relname
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname`
  );

  return rows.map((row) => row.relname);
}

test("every public table has row-level security enabled", async () => {
  const { rows } = await db.query<{ relname: string; enabled: boolean }>(
    `select c.relname, c.relrowsecurity as enabled
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname`
  );

  expect(rows.length).toBeGreaterThan(0);

  const unprotected = rows.filter((row) => !row.enabled).map((row) => row.relname);
  expect(unprotected).toEqual([]);
});

test("a table without a policy is a table no client can read", async () => {
  const { rows: policyRows } = await db.query<{ tablename: string }>(
    "select tablename from pg_policies where schemaname = 'public'"
  );
  const withPolicy = new Set(policyRows.map((row) => row.tablename));

  const { rows: grantRows } = await db.query<{ table_name: string }>(
    `select table_name
       from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'authenticated')`
  );
  const granted = new Set(grantRows.map((row) => row.table_name));

  const exposed = (await tables()).filter(
    (table) => !withPolicy.has(table) && granted.has(table)
  );

  // dew_codes, openmi_meta and rate_limits are the service-only tables; each has
  // no policy and no grant, which is what this asserts.
  expect(exposed).toEqual([]);
});

test("the anon role reads no rows from any table", async () => {
  await actAs("anon", null);

  for (const table of await tables()) {
    try {
      const { rows } = await db.query<{ count: number }>(
        `select count(*)::int as count from public."${table}"`
      );
      expect({ table, count: rows[0]?.count }).toEqual({ table, count: 0 });
    } catch (error) {
      // "permission denied" is the stronger outcome for a service-only table.
      expect(String(error)).toMatch(/permission denied/i);
    }
  }
});

test("a second account reads no row owned by the first", async () => {
  await actAs("authenticated", USER_A);
  await db.query("insert into public.folders (owner, name) values ($1, $2)", [
    USER_A,
    "Audit folder",
  ]);
  await db.query("insert into public.chats (owner, title) values ($1, $2)", [
    USER_A,
    "Audit chat",
  ]);

  // Only tables a signed-in account can actually read are queried here. A
  // service-only table with an owner column (chat_sandboxes) would answer this
  // query with "permission denied" rather than a count; the previous test is
  // what proves it is not readable, and a permission denial is not isolation
  // evidence. Filtering by the client grant keeps this test about the tables
  // where a cross-account read is even possible.
  const { rows: owned } = await db.query<{ table_name: string }>(
    `select c.table_name
       from information_schema.columns c
       join information_schema.role_table_grants g
         on g.table_schema = c.table_schema
        and g.table_name = c.table_name
        and g.grantee = 'authenticated'
      where c.table_schema = 'public' and c.column_name = 'owner'
      group by c.table_name`
  );

  await actAs("authenticated", USER_B);

  for (const { table_name } of owned) {
    const { rows } = await db.query<{ foreign: number }>(
      `select count(*)::int as foreign from public."${table_name}" where owner <> $1`,
      [USER_B]
    );

    expect({ table: table_name, foreign: rows[0]?.foreign }).toEqual({
      table: table_name,
      foreign: 0,
    });
  }

  const { rows: profiles } = await db.query<{ count: number }>(
    "select count(*)::int as count from public.profiles where id = $1",
    [USER_A]
  );
  expect(profiles[0]?.count).toBe(0);

  const { rows: own } = await db.query<{ count: number }>(
    "select count(*)::int as count from public.profiles where id = $1",
    [USER_B]
  );
  expect(own[0]?.count).toBe(1);
});
