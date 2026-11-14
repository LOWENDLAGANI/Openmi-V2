import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

import { firstSignalIn, resetSignalMemory } from "../lib/moderation/dedupe";

/**
 * Moderation, executed: a ban stops the account in the database (not only in the
 * UI), cancels the work it had running, and keeps its queue entry from being
 * claimed. The risk feed is invisible to the account it is about.
 */

const ROOT = join(import.meta.dir, "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

const ADMIN = "55555555-5555-4555-8555-555555555555";
const TARGET = "66666666-6666-4666-8666-666666666666";
const OTHER = "77777777-7777-4777-8777-777777777777";

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

  await db.query(
    "insert into auth.users (id, email) values ($1, $2), ($3, $4), ($5, $6)",
    [ADMIN, "ops@example.test", TARGET, "abuser@example.test", OTHER, "other@example.test"]
  );

  await db.query(
    "insert into public.admin_users (user_id, note) values ($1, $2)",
    [ADMIN, "test operator"]
  );
});

afterAll(async () => {
  await db.close();
});

async function actAs(sub: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify(sub ? { sub, role: "authenticated" } : { role: "authenticated" }),
  ]);
  await db.exec("set role authenticated");
}

async function asSuperuser() {
  await db.exec("reset role");
}

test("a risk signal is invisible to the account it is about", async () => {
  await asSuperuser();
  await db.query(
    "insert into public.risk_events (user_id, email, kind, severity, summary) values ($1, $2, $3, $4, $5)",
    [TARGET, "abuser@example.test", "sandbox-egress", "high", "tried the metadata service"]
  );

  await actAs(TARGET);

  // No policy, no grant: knowing what tripped the alarm is a hint for next time.
  await expect(db.query("select * from public.risk_events")).rejects.toThrow(
    /permission denied/i
  );
});

test("banning is an operator action, and never a self-ban", async () => {
  await asSuperuser();
  expect(TARGET).not.toBe(ADMIN);

  await actAs(TARGET);
  await expect(
    db.query("select public.admin_ban_user($1, $2, $3)", [OTHER, "spam", 24])
  ).rejects.toThrow(/admin/i);

  await actAs(ADMIN);
  await expect(
    db.query("select public.admin_ban_user($1, $2, $3)", [ADMIN, "oops", 24])
  ).rejects.toThrow(/own account/i);

  // A reason is the sentence the account reads; an empty one is refused.
  await expect(
    db.query("select public.admin_ban_user($1, $2, $3)", [TARGET, "  ", 24])
  ).rejects.toThrow(/reason is required/i);
});

test("a ban stops the account, cancels its live work and keeps its queue unclaimable", async () => {
  await asSuperuser();

  await db.query(
    "insert into public.runs (id, owner, prompt, model, status) values ($1, $2, $3, $4, 'queued')",
    ["11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa", TARGET, "do work", "auto"]
  );
  await db.query(
    "insert into public.runs (id, owner, prompt, model, status) values ($1, $2, $3, $4, 'queued')",
    ["22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa", OTHER, "other work", "auto"]
  );

  await actAs(ADMIN);
  await db.query("select public.admin_ban_user($1, $2, null)", [TARGET, "credential probing"]);

  await asSuperuser();

  const { rows: banned } = await db.query(
    "select public.is_banned($1) as banned, (select cancel_requested from public.runs where owner = $1) as cancelled",
    [TARGET]
  );
  const state = banned[0] as { banned: boolean; cancelled: boolean };

  expect(state.banned).toBe(true);
  expect(state.cancelled).toBe(true);

  // The worker gets the other account's run, not the banned one's.
  const claimed = await db.query("select owner from public.claim_next_run($1)", ["worker-1"]);
  expect((claimed.rows[0] as { owner: string }).owner).toBe(OTHER);
});

test("lifting a ban restores the queue entry", async () => {
  await actAs(ADMIN);
  await db.query("select public.admin_unban_user($1)", [TARGET]);

  await asSuperuser();
  const { rows } = await db.query("select public.is_banned($1) as banned", [TARGET]);
  expect((rows[0] as { banned: boolean }).banned).toBe(false);

  const claimed = await db.query("select owner from public.claim_next_run($1)", [
    "worker-2",
  ]);
  expect((claimed.rows[0] as { owner: string }).owner).toBe(TARGET);
});

test("an expired ban is over without an operator", async () => {
  await asSuperuser();
  await db.query(
    "update public.profiles set banned_at = now(), ban_expires_at = now() - interval '1 hour' where id = $1",
    [TARGET]
  );

  const { rows } = await db.query("select public.is_banned($1) as banned", [TARGET]);
  expect((rows[0] as { banned: boolean }).banned).toBe(false);
});

test("signals are deduplicated inside their window", () => {
  resetSignalMemory();

  expect(firstSignalIn("rate:user", 60_000)).toBe(true);
  expect(firstSignalIn("rate:user", 60_000)).toBe(false);
  expect(firstSignalIn("rate:other-user", 60_000)).toBe(true);
});

test("the app records signals where the decision is made, and enforces the ban at the session", () => {
  const read = (path: string) =>
    readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

  const session = read("lib/session.ts");
  const chat = read("app/api/chat/route.ts");
  const loop = read("lib/runs/loop.ts");
  const page = read("app/admin/page.tsx");
  const migrate = read("supabase/migrations/046_moderation.sql");

  // One session choke point: every page and route inherits the stop.
  expect(session).toContain('state: "banned"');
  expect(session).toContain('from("profiles")');
  expect(session).toContain("banned_at");

  // Signals are written where the fact is known, never by the client.
  expect(chat).toContain("recordRiskSignal(");
  expect(loop).toContain("sandbox-egress");
  expect(loop).toContain("recordRiskSignal(");

  // The panel shows who, what and where, and offers the stop.
  expect(page).toContain("Risk signals");
  expect(page).toContain("banUser");
  expect(page).toContain("bannedRows");

  // The database enforces it even if the app were bypassed.
  expect(migrate).toContain("create table if not exists public.risk_events");
  expect(migrate).toContain("create or replace function public.is_banned");
  expect(migrate).toContain("cancel_requested = true");
});
