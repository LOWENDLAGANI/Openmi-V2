import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

/**
 * The phase 1 gate, executed rather than asserted in prose: two accounts must
 * not be able to see or touch each other's rows, and the anon key must see
 * nothing at all.
 *
 * This runs the real migrations against an in-memory Postgres, then sets
 * `role` and `request.jwt.claims` the way Supabase does per request, so the
 * policies are exercised exactly as they will be in production. A policy that
 * is missing, mis-keyed or too permissive fails here.
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
  -- Supabase grants these on its own auth schema. A policy expression resolves
  -- auth.uid() either way; a function body that calls it does not.
  grant execute on function auth.uid() to anon, authenticated;
`;

let db: PGlite;
let folderA = "";
let chatA = "";

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SHIM);

  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }

  await db.query("insert into auth.users (id, email) values ($1, $2), ($3, $4)", [
    USER_A,
    "a@example.test",
    USER_B,
    "b@example.test",
  ]);
});

afterAll(async () => {
  await db.close();
});

/** Behave like a Supabase request: role plus a verified JWT subject. */
async function actAs(role: "authenticated" | "anon", sub: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify(sub ? { sub, role } : { role }),
  ]);
  await db.exec(`set role ${role}`);
}

test("the signup trigger creates exactly one profile per account", async () => {
  await db.exec("reset role");
  const { rows } = await db.query(
    "select count(*)::int as count from public.profiles where id in ($1, $2)",
    [USER_A, USER_B]
  );

  expect((rows[0] as { count: number }).count).toBe(2);
});

test("a folder is invisible to another account", async () => {
  await actAs("authenticated", USER_A);
  const created = await db.query(
    "insert into public.folders (owner, name) values ($1, $2) returning id",
    [USER_A, "Notes"]
  );
  folderA = (created.rows[0] as { id: string }).id;

  await actAs("authenticated", USER_B);
  const seen = await db.query("select id from public.folders");

  expect(seen.rows).toEqual([]);
});

test("a chat cannot be attached to another account's folder", async () => {
  await actAs("authenticated", USER_A);
  const created = await db.query(
    "insert into public.chats (owner, title) values ($1, $2) returning id",
    [USER_A, "Reading the repository"]
  );
  chatA = (created.rows[0] as { id: string }).id;

  await actAs("authenticated", USER_B);
  await expect(
    db.query("insert into public.chats (owner, folder_id) values ($1, $2)", [
      USER_B,
      folderA,
    ])
  ).rejects.toThrow(/row-level security/);
});

test("another account cannot update or delete a chat", async () => {
  await actAs("authenticated", USER_B);
  const updated = await db.query(
    "update public.chats set title = 'hijacked' where id = $1",
    [chatA]
  );
  const deleted = await db.query("delete from public.chats where id = $1", [chatA]);

  expect(Number(updated.affectedRows ?? 0)).toBe(0);
  expect(Number(deleted.affectedRows ?? 0)).toBe(0);
});

test("a message cannot be written into another account's chat", async () => {
  await actAs("authenticated", USER_B);
  await expect(
    db.query(
      "insert into public.messages (chat_id, owner, role, content) values ($1, $2, 'user', 'hi')",
      [chatA, USER_B]
    )
  ).rejects.toThrow(/row-level security/);
});

test("trash is a soft delete that can be restored", async () => {
  await actAs("authenticated", USER_A);
  await db.query("update public.chats set deleted_at = now() where id = $1", [chatA]);

  const trashed = await db.query(
    "select id from public.chats where id = $1 and deleted_at is not null",
    [chatA]
  );
  expect(trashed.rows).toHaveLength(1);

  await db.query("update public.chats set deleted_at = null where id = $1", [chatA]);
  const restored = await db.query(
    "select id from public.chats where id = $1 and deleted_at is null",
    [chatA]
  );
  expect(restored.rows).toHaveLength(1);
});

test("the anon key reads nothing", async () => {
  await actAs("anon", null);
  const chats = await db.query("select id from public.chats");
  const folders = await db.query("select id from public.folders");

  expect(chats.rows).toEqual([]);
  expect(folders.rows).toEqual([]);
});

test("the service-only marker table is not readable by a signed-in account", async () => {
  await actAs("authenticated", USER_A);
  await expect(db.query("select * from public.openmi_meta")).rejects.toThrow(
    /permission denied/
  );
});

test("a GitHub connection is invisible to another account", async () => {
  await actAs("authenticated", USER_A);
  await db.query(
    "insert into public.github_connections (owner, login, token_sealed, token_last_four, scopes) values ($1, $2, $3, $4, $5)",
    [USER_A, "octocat", "v1.aaaaaaaa.bbbbbbbb.cccccccc", "1234", "{repo,read:user}"]
  );

  const own = await db.query("select login from public.github_connections");
  expect(own.rows.length).toBe(1);

  await actAs("authenticated", USER_B);
  const other = await db.query(
    "select login, token_sealed from public.github_connections"
  );
  expect(other.rows).toEqual([]);
});

test("a changeset and its files are invisible to another account", async () => {
  await actAs("authenticated", USER_A);

  const created = await db.query(
    `insert into public.changesets
       (owner, chat_id, repo_full_name, base_sha, status, content_hash, signature, expires_at)
     values ($1, $2, $3, $4, 'ready', $5, $6, now() + interval '6 hours')
     returning id`,
    [USER_A, chatA, "octocat/hello", "a".repeat(40), "hash", "signature"]
  );
  const changesetId = (created.rows[0] as { id: string }).id;

  await db.query(
    `insert into public.changeset_files
       (changeset_id, owner, path, mode, proposed_content, diff, additions)
     values ($1, $2, 'lib/a.ts', 'write', 'export const a = 1;', '@@ -0,0 +1,1 @@\n+export const a = 1;', 1)`,
    [changesetId, USER_A]
  );

  const own = await db.query("select count(*)::int as count from public.changeset_files");
  expect((own.rows[0] as { count: number }).count).toBe(1);

  await actAs("authenticated", USER_B);
  const otherRows = await db.query("select id from public.changesets");
  const otherFiles = await db.query("select id from public.changeset_files");

  expect(otherRows.rows).toEqual([]);
  expect(otherFiles.rows).toEqual([]);

  await expect(
    db.query(
      `insert into public.changeset_files
         (changeset_id, owner, path, mode, proposed_content, diff)
       values ($1, $2, 'hijack.ts', 'write', 'x', '')`,
      [changesetId, USER_B]
    )
  ).rejects.toThrow(/row-level security/);
});

test("a changeset cannot be marked ready without a signature", async () => {
  await actAs("authenticated", USER_A);

  await expect(
    db.query(
      `insert into public.changesets
         (owner, chat_id, repo_full_name, base_sha, status, expires_at)
       values ($1, $2, $3, $4, 'ready', now() + interval '6 hours')`,
      [USER_A, chatA, "octocat/hello", "b".repeat(40)]
    )
  ).rejects.toThrow(/changesets_signed_when_reviewable/);
});

test("append_message assigns a per-chat sequence and refuses another account", async () => {
  await actAs("authenticated", USER_A);
  const created = await db.query(
    "insert into public.chats (owner, title) values ($1, $2) returning id",
    [USER_A, "New chat"]
  );
  const chatId = (created.rows[0] as { id: string }).id;

  const first = await db.query(
    "select * from public.append_message($1, 'user', $2)",
    [chatId, "Where is the router?"]
  );
  const second = await db.query(
    "select * from public.append_message($1, 'assistant', $2)",
    [chatId, "app/page.tsx:1"]
  );

  expect(Number((first.rows[0] as { seq: number }).seq)).toBe(1);
  expect(Number((second.rows[0] as { seq: number }).seq)).toBe(2);

  const titled = await db.query("select title from public.chats where id = $1", [chatId]);
  expect((titled.rows[0] as { title: string }).title).toBe("Where is the router?");

  await actAs("authenticated", USER_B);
  await expect(
    db.query("select * from public.append_message($1, 'user', $2)", [chatId, "hijack"])
  ).rejects.toThrow();
});
