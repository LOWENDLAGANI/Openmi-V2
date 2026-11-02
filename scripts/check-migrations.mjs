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

// The objects the application actually calls. A migration that forgets one of
// these applies cleanly and then breaks a feature at runtime, which is the
// failure mode this list exists to catch before it is deployed.
const REQUIRED_TABLES = [
  "folders",
  "chats",
  "messages",
  "github_connections",
  "agent_turns",
  "changesets",
  "changeset_files",
  "hour_sessions",
  "dew_transactions",
  "dew_codes",
  "rate_limits",
];

const REQUIRED_FUNCTIONS = [
  "append_message",
  "consume_agent_step",
  "refill_daily_dew",
  "start_hour_session",
  "refund_hour_session",
  "redeem_dew_code",
  "rate_limit_hit",
  "openmi_migration_ledger",
  "openmi_schema_probe",
];

const REQUIRED_COLUMNS = [
  ["chats", "repo_full_name"],
  ["chats", "repo_branch"],
  ["chats", "repo_base_sha"],
  ["chats", "deleted_at"],
  ["chats", "last_message_at"],
  ["messages", "seq"],
  ["messages", "usage_tokens"],
  ["agent_turns", "status"],
  ["agent_turns", "cancel_requested"],
  ["agent_turns", "partial"],
  ["changesets", "pr_url"],
  ["profiles", "dew_balance"],
];

async function schemaProblems(db) {
  const tables = new Set(
    (
      await db.query(
        `select c.relname as name
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind in ('r', 'p')`
      )
    ).rows.map((row) => row.name)
  );

  const functions = new Set(
    (
      await db.query(
        `select p.proname as name
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'`
      )
    ).rows.map((row) => row.name)
  );

  const columns = new Set(
    (
      await db.query(
        `select table_name, column_name
           from information_schema.columns
          where table_schema = 'public'`
      )
    ).rows.map((row) => `${row.table_name}.${row.column_name}`)
  );

  const problems = [];
  for (const table of REQUIRED_TABLES) {
    if (!tables.has(table)) problems.push(`table public.${table}`);
  }
  for (const fn of REQUIRED_FUNCTIONS) {
    if (!functions.has(fn)) problems.push(`function public.${fn}()`);
  }
  for (const [table, column] of REQUIRED_COLUMNS) {
    if (!columns.has(`${table}.${column}`)) problems.push(`column ${table}.${column}`);
  }

  return problems;
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

    const problems = await schemaProblems(db);

    // The probe is what /setup shows. If it disagrees with the objects this
    // script just checked, the page is reporting the wrong thing, so both
    // results have to be empty rather than only the list being right.
    const probe = await db.query(
      "select kind, object from public.openmi_schema_probe()"
    );

    console.log("");
    console.log("  schema — objects the application calls");

    if (problems.length > 0) {
      for (const problem of problems) console.log(`    missing  ${problem}`);
    } else {
      console.log("    complete  every required table, function and column exists");
    }

    if (probe.rows.length > 0) {
      for (const row of probe.rows) {
        console.log(`    probe    reports missing ${row.kind} ${row.object}`);
      }
    } else {
      console.log("    probe    openmi_schema_probe() reports nothing missing");
    }

    if (problems.length > 0 || probe.rows.length > 0) {
      console.error(
        `\n  FAIL ${problems.length} schema problem(s); the setup page and this check disagree if the probe also lists rows.\n`
      );
      process.exitCode = 1;
      return;
    }

    console.log(
      `\n  Pass — ${rows[0].count} migration(s) recorded, second pass a no-op, schema complete.`
    );
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(`\n  Migration check failed: ${error.message}\n`);
  process.exitCode = 1;
});
