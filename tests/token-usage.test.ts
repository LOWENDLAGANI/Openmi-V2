import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

/**
 * The account's token total, executed against the real migrations.
 *
 * The activity page reads one stored number rather than summing messages, so
 * the number has to be kept correct by the database itself: whichever path
 * appends a message — the chat route, the run worker, or a direct insert —
 * adds that message's estimate to `profiles.tokens_used`.
 */

const ROOT = join(import.meta.dir, "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

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
});

afterAll(async () => {
  await db.close();
});

async function actAs(sub: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify(sub ? { sub, role: "authenticated" } : { role: "anon" }),
  ]);
  await db.exec(`set role ${sub ? "authenticated" : "anon"}`);
}

async function signUp(id: string, email: string) {
  await db.exec("reset role");
  await db.query(
    "insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}'::jsonb)",
    [id, email]
  );
}

async function tokensUsed(owner: string): Promise<number> {
  await db.exec("reset role");
  const { rows } = await db.query<{ tokens_used: string }>(
    "select tokens_used from public.profiles where id = $1",
    [owner]
  );

  return Number(rows[0]?.tokens_used ?? -1);
}

async function newChat(owner: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into public.chats (owner, title) values ($1, 'Token chat') returning id",
    [owner]
  );

  return rows[0].id;
}

async function append(chatId: string, content: string, tokens: number | null) {
  await db.query("select * from public.append_message($1, 'user', $2, null, $3)", [
    chatId,
    content,
    tokens,
  ]);
}

test("every appended message adds its tokens to the account total", async () => {
  await signUp(USER_A, "a@example.com");
  await signUp(USER_B, "b@example.com");

  await actAs(USER_A);
  const chat = await newChat(USER_A);

  await append(chat, "first", 300);
  expect(await tokensUsed(USER_A)).toBe(300);

  await append(chat, "second", 120);
  expect(await tokensUsed(USER_A)).toBe(420);

  // A message with no estimate adds nothing rather than resetting the total.
  await append(chat, "unmeasured", null);
  expect(await tokensUsed(USER_A)).toBe(420);

  // The other account is untouched.
  expect(await tokensUsed(USER_B)).toBe(0);
});

test("deleting a message keeps the tokens it spent", async () => {
  await actAs(USER_A);
  const chat = await newChat(USER_A);

  await append(chat, "spent", 500);
  const before = await tokensUsed(USER_A);

  await db.query("delete from public.messages where chat_id = $1", [chat]);
  expect(await tokensUsed(USER_A)).toBe(before);
});
