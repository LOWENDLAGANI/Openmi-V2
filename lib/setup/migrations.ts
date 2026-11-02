import "server-only";

import {
  diffMigrations,
  listLocalMigrations,
  statementsChecksum,
  type MigrationEntry,
} from "@/lib/migrations";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Reads the migration ledger and the schema the application depends on.
 *
 * PostgREST does not expose the `supabase_migrations` schema, so the setup page
 * cannot select that table directly. A security-definer function returns the
 * versions, names and the statements recorded at apply time; the app hashes
 * those the same way it hashes the local files.
 *
 * Every failure is its own state: no service role is `unconfigured`, a missing
 * function or table is `unreachable`, and applied-but-unverifiable rows are
 * `unknown` rather than green.
 *
 * File checksums answer "were these files applied?". The schema probe answers
 * "does the database still have the objects chat calls?" — the question a
 * half-applied deployment actually fails, and the one a checksum cannot see.
 */

export type SchemaReport = {
  state: "unknown" | "ok" | "missing";
  missing: string[];
};

export type MigrationReport = {
  state: "unconfigured" | "unreachable" | "ok";
  detail: string;
  entries: MigrationEntry[];
  drifted: number;
  pending: number;
  schema: SchemaReport;
};

function counts(entries: MigrationEntry[]) {
  return {
    drifted: entries.filter((entry) => entry.state === "drift").length,
    pending: entries.filter((entry) => entry.state === "pending").length,
  };
}

async function readSchema(
  admin: NonNullable<ReturnType<typeof supabaseAdmin>>
): Promise<SchemaReport> {
  try {
    const { data, error } = await admin.rpc("openmi_schema_probe");

    if (error) return { state: "unknown", missing: [] };

    const rows = (data ?? []) as Array<{ kind?: unknown; object?: unknown }>;
    const missing = rows.map(
      (row) => `${String(row.kind ?? "object")} ${String(row.object ?? "?")}`
    );

    return { state: missing.length > 0 ? "missing" : "ok", missing };
  } catch {
    return { state: "unknown", missing: [] };
  }
}

export async function readMigrationReport(): Promise<MigrationReport> {
  const local = await listLocalMigrations();
  const admin = supabaseAdmin();

  if (!admin) {
    const entries = diffMigrations(local, []);
    return {
      state: "unconfigured",
      detail:
        "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not both set, so the applied ledger cannot be read.",
      entries,
      ...counts(entries),
      schema: { state: "unknown", missing: [] },
    };
  }

  try {
    const schema = await readSchema(admin);
    const { data, error } = await admin.rpc("openmi_migration_ledger");

    if (error) {
      const entries = diffMigrations(local, []);
      return {
        state: "unreachable",
        detail: `The migration ledger is not readable: ${error.message}`,
        entries,
        ...counts(entries),
        schema,
      };
    }

    const rows = (data ?? []) as Array<{
      version: string;
      name: string | null;
      statements: unknown;
    }>;

    const applied = rows.map((row) => ({
      version: String(row.version),
      name: row.name ? String(row.name) : null,
      checksum: statementsChecksum(row.statements),
    }));

    const entries = diffMigrations(local, applied);
    const appliedCount = entries.filter((entry) => entry.state === "applied").length;
    const { drifted, pending } = counts(entries);

    const schemaNote =
      schema.state === "missing"
        ? ` ${schema.missing.length} object(s) the app calls are missing.`
        : "";

    return {
      state: "ok",
      detail:
        (applied.length === 0
          ? "The ledger is empty, so no migration has been applied."
          : `${appliedCount} of ${local.length} local migration(s) applied and matching, ${pending} pending, ${drifted} drifted.`) +
        schemaNote,
      entries,
      drifted,
      pending,
      schema,
    };
  } catch (error) {
    const entries = diffMigrations(local, []);
    return {
      state: "unreachable",
      detail:
        error instanceof Error
          ? `The migration ledger could not be reached: ${error.message}`
          : "The migration ledger could not be reached.",
      entries,
      ...counts(entries),
      schema: { state: "unknown", missing: [] },
    };
  }
}
