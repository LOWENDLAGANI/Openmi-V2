import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

/**
 * The database half of the admin kill switch, executed rather than described.
 *
 * The app-level check in `readAdminAccess()` cannot help a request that never
 * reaches the app. This exercises that request: an `authenticated` session with
 * a valid admin JWT calling the admin RPCs directly, exactly as PostgREST would
 * serve it, with the mirror row switched off.
 */

const ROOT = join(import.meta.dir, "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

const ADMIN = "33333333-3333-4333-8333-333333333333";

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

  await db.query("insert into auth.users (id, email) values ($1, $2)", [
    ADMIN,
    "boss@example.test",
  ]);
  await db.query(
    "insert into public.admin_users (user_id, note) values ($1, $2)",
    [ADMIN, "test operator"]
  );
});

afterAll(async () => {
  await db.close();
});

/** Behave like a Supabase request: role plus a verified JWT subject. */
async function actAs(sub: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify(sub ? { sub, role: "authenticated" } : { role: "authenticated" }),
  ]);
  await db.exec("set role authenticated");
}

test("the deployment starts with the panel on and the admin a real admin", async () => {
  await db.exec("reset role");

  const { rows } = await db.query(
    "select public.admin_panel_disabled() as disabled, public.is_admin($1) as admin",
    [ADMIN]
  );
  const row = rows[0] as { disabled: boolean; admin: boolean };

  expect(row.disabled).toBe(false);
  expect(row.admin).toBe(true);
});

test("switching it off makes a valid admin token worth nothing in the database", async () => {
  await db.exec("reset role");
  await db.query("select public.admin_set_disabled(true)");

  const { rows } = await db.query(
    "select public.is_admin($1) as admin",
    [ADMIN]
  );

  expect((rows[0] as { admin: boolean }).admin).toBe(false);

  // The role row is still there; it simply stops granting anything.
  const held = await db.query(
    "select 1 from public.admin_users where user_id = $1",
    [ADMIN]
  );
  expect(held.rows).toHaveLength(1);

  // An admin RPC called straight against PostgREST refuses.
  await actAs(ADMIN);
  await expect(db.query("select * from public.admin_list_dew_codes(5)")).rejects.toThrow(
    /admin/i
  );
});

test("a signed-in admin cannot switch the panel back on", async () => {
  await actAs(ADMIN);

  await expect(db.query("select public.admin_set_disabled(false)")).rejects.toThrow(
    /permission denied/i
  );
});

test("switching it back on restores the panel and the RPCs", async () => {
  await db.exec("reset role");
  await db.query("select public.admin_set_disabled(false)");

  await actAs(ADMIN);
  const codes = await db.query("select * from public.admin_list_dew_codes(5)");

  expect(codes.rows).toEqual([]);
  await db.exec("reset role");

  const { rows } = await db.query("select public.is_admin($1) as admin", [ADMIN]);
  expect((rows[0] as { admin: boolean }).admin).toBe(true);
});
