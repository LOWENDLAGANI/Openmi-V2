#!/usr/bin/env node
// ── Migrations must apply twice ──────────────────────────────────────────────
//
// Vercel does not run migrations, so the order is always: apply with
// `supabase db push`, then deploy. That means the apply step runs on every
// deploy and must be a no-op the second time — a migration that fails when the
// ledger already knows about it is an outage in the middle of a release.
//
// This emulates Supabase's ledger in an in-memory Postgres (PGlite), applies
// every file in `supabase/migrations` in order, then applies the whole set a
// second time and requires that the second pass does nothing.
//
//   node scripts/check-migrations.mjs
//
// Exits 0 when both passes are clean, 1 otherwise. No credentials: it never
// touches the real project.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "supabase", "migrations");

// Supabase provides these objects; a bare Postgres does not. The shim is local
// to this check and is never part of a migration, so it cannot leak into the
// real database.
const SHIM = `
  create schema if not exists auth;
  create table if not exists auth.users (
    id uuid primary key,
    email text
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

  -- Supabase grants these by default; a bare Postgres does not, and without
  -- them every policy is inert because the role cannot reach the table. This
  -- runs after the roles exist, or the grant itself is the error.
  grant usage on schema public to anon, authenticated;
  grant usage on schema auth to anon, authenticated;
  grant usage, select on all sequences in schema public to anon, authenticated;
  grant execute on all functions in schema public to anon, authenticated;
  -- Supabase grants these on its own auth schema. Without them a policy that
  -- calls auth.uid() works, but a function body that calls it does not.
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public
    grant all on tables to anon, authenticated;

  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (
    version text primary key,
    name text not null,
    checksum text not null,
    applied_at timestamptz not null default now()
  );
`;

const files = existsSync(migrationsDir)
  ? readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort()
  : [];

function checksum(sql) {
  return createHash("sha256").update(sql).digest("hex");
}

async function applyPass(db, label) {
  let applied = 0;
  let skipped = 0;
  const rows = [];

  for (const file of files) {
    const version = file.split("_")[0] ?? file;
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    const digest = checksum(sql);

    const existing = await db.query(
      "select checksum from supabase_migrations.schema_migrations where version = $1",
      [version]
    );

    if (existing.rows.length > 0) {
      skipped += 1;
      rows.push({ file, version, result: "skipped (already applied)" });
      continue;
    }

    try {
      await db.exec(sql);
    } catch (error) {
      console.error(`\n  FAIL ${file}\n  ${error.message}\n`);
      throw error;
    }

    await db.query(
      `insert into supabase_migrations.schema_migrations (version, name, checksum)
       values ($1, $2, $3)`,
      [version, file, digest]
    );

    applied += 1;
    rows.push({ file, version, result: "applied" });
  }

  console.log(`\n  ${label}`);
  for (const row of rows) {
    console.log(`    ${row.file.padEnd(34)} ${row.result}`);
  }

  return { applied, skipped };
}

async function main() {
  console.log("Migrations — applied twice, in an in-memory Postgres\n");

  if (files.length === 0) {
    console.log("  No migrations found. The harness is ready for phase 1.");
    return;
  }

  const db = new PGlite();

  try {
    await db.exec(SHIM);

    const first = await applyPass(db, `first pass — ${files.length} file(s)`);
    const second = await applyPass(db, "second pass — must change nothing");

    const wrongFirst = first.applied !== files.length;
    const wrongSecond = second.applied !== 0;

    console.log("");

    if (wrongFirst) {
      console.error(
        `  FAIL first pass applied ${first.applied} of ${files.length}.`
      );
      process.exitCode = 1;
      return;
    }

    if (wrongSecond) {
      console.error(
        `  FAIL second pass applied ${second.applied} migration(s). An applied migration must be skipped by the ledger, not re-run.`
      );
      process.exitCode = 1;
      return;
    }

    const { rows } = await db.query(
      "select count(*)::int as count from supabase_migrations.schema_migrations"
    );
    console.log(
      `  Pass — ${rows[0].count} migration(s) recorded, second pass a no-op.`
    );
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(`\n  Migration check failed: ${error.message}\n`);
  process.exitCode = 1;
});
