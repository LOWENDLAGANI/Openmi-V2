import "server-only";

import {
  diffMigrations,
  listLocalMigrations,
  statementsChecksum,
  type MigrationEntry,
} from "@/lib/migrations";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Reads the migration ledger through a security-definer function.
 *
 * PostgREST does not expose the `supabase_migrations` schema, so the setup page
 * cannot select that table directly. The function returns versions, names and
 * the statements recorded at apply time; the app hashes those the same way it
 * hashes the local files.
 *
 * Every failure is its own state: no service role is `unconfigured`, a missing
 * function or table is `unreachable`, and applied-but-unverifiable rows are
 * `unknown` rather than green.
 */

export type MigrationReport = {
  state: "unconfigured" | "unreachable" | "ok";
  detail: string;
  entries: MigrationEntry[];
  drifted: number;
  pending: number;
};

function counts(entries: MigrationEntry[]) {
  return {
    drifted: entries.filter((entry) => entry.state === "drift").length,
    pending: entries.filter((entry) => entry.state === "pending").length,
  };
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
    };
  }

  try {
    const { data, error } = await admin.rpc("openmi_migration_ledger");

    if (error) {
      const entries = diffMigrations(local, []);
      return {
        state: "unreachable",
        detail: `The migration ledger is not readable: ${error.message}`,
        entries,
        ...counts(entries),
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

    return {
      state: "ok",
      detail:
        applied.length === 0
          ? "The ledger is empty, so no migration has been applied."
          : `${appliedCount} of ${local.length} local migration(s) applied and matching, ${pending} pending, ${drifted} drifted.`,
      entries,
      drifted,
      pending,
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
    };
  }
}
