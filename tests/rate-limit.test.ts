import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

import {
  RATE_LIMIT_WINDOW_MS,
  checkRateLimit,
  rateBucket,
  retryAfterSeconds,
  windowStart,
} from "../lib/rate-limit";

const ROOT = join(import.meta.dir, "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

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
});

afterAll(async () => {
  await db.close();
});

test("windows are fixed and a retry never rounds below one second", () => {
  expect(windowStart(120_000, 60_000)).toBe(120_000);
  expect(windowStart(179_999, 60_000)).toBe(120_000);
  expect(windowStart(180_000, 60_000)).toBe(180_000);

  expect(retryAfterSeconds(120_000, 60_000)).toBe(60);
  expect(retryAfterSeconds(179_999, 60_000)).toBe(1);
});

test("a bucket names the kind and the account, and nothing else", () => {
  expect(rateBucket("chat", " user-1 ")).toBe("openmi:chat:user-1");
  expect(rateBucket("approval", "user-1")).not.toBe(rateBucket("chat", "user-1"));
  expect(rateBucket("chat", "   ")).toBe("");
});

test("an absent limiter allows the request and says it is degraded", async () => {
  const result = await checkRateLimit(null, "chat", "user-1", Date.now(), {});

  expect(result.allowed).toBe(true);
  expect(result.source).toBe("degraded");
  expect(result.limit).toBe(20);
});

test("an unreachable Upstash falls through instead of blocking", async () => {
  const result = await checkRateLimit(null, "chat", "user-1", Date.now(), {
    UPSTASH_REDIS_REST_URL: "http://127.0.0.1:9",
    UPSTASH_REDIS_REST_TOKEN: "not-a-token",
  });

  expect(result.allowed).toBe(true);
  expect(result.source).toBe("degraded");
});

test("the counter stops at the cap", async () => {
  const bucket = "test:cap";
  const window = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
  const seen: Array<{ allowed: boolean; hits: number }> = [];

  for (let i = 0; i < 7; i += 1) {
    const { rows } = await db.query<{ allowed: boolean; hits: number }>(
      "select * from public.rate_limit_hit($1, $2, $3)",
      [bucket, window, 5]
    );
    seen.push(rows[0]);
  }

  expect(seen.filter((row) => row.allowed).length).toBe(5);
  expect(seen[5]).toEqual({ allowed: false, hits: 5 });
  expect(seen[6]).toEqual({ allowed: false, hits: 5 });
});

test("a burst across two callers shares one counter", async () => {
  const bucket = "test:burst";
  const window = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();

  // Two "instances" calling at once. The increment and the cap check are one
  // statement, so the boundary cannot be won twice.
  const calls = await Promise.all(
    Array.from({ length: 10 }, () =>
      db.query<{ allowed: boolean; hits: number }>(
        "select * from public.rate_limit_hit($1, $2, $3)",
        [bucket, window, 5]
      )
    )
  );

  const allowed = calls.filter((call) => call.rows[0]?.allowed).length;
  expect(allowed).toBe(5);

  const { rows } = await db.query<{ hits: number }>(
    "select hits from public.rate_limits where bucket = $1",
    [bucket]
  );
  expect(rows[0]?.hits).toBe(5);
});

test("a bucket with no name or a non-positive cap is refused", async () => {
  await expect(
    db.query("select * from public.rate_limit_hit($1, now(), $2)", ["  ", 5])
  ).rejects.toThrow(/bucket is required/);

  await expect(
    db.query("select * from public.rate_limit_hit($1, now(), $2)", ["x", 0])
  ).rejects.toThrow(/max must be at least 1/);
});

test("the limiter window is a named constant", () => {
  expect(RATE_LIMIT_WINDOW_MS).toBe(60_000);
});
