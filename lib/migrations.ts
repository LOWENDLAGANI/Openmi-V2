import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Migration files and drift detection.
 *
 * This module is deliberately free of `server-only` and of a database client:
 * the comparison is pure and tested without a Supabase project. The reader that
 * talks to Postgres lives in `lib/setup/migrations.ts`.
 *
 * Checksums are taken over normalized SQL: comments are stripped and whitespace
 * collapsed. Reformatting a file is not drift; changing a statement is. The
 * ledger side is the `statements` array Supabase stores, joined back into SQL
 * before it is normalized the same way.
 */

export type LocalMigration = {
  name: string;
  version: string;
  checksum: string;
};

export type AppliedMigration = {
  version: string;
  name: string | null;
  checksum: string | null;
};

export type MigrationEntryState =
  | "applied"
  | "drift"
  | "pending"
  | "unknown"
  | "orphaned";

export type MigrationEntry = {
  version: string;
  name: string;
  state: MigrationEntryState;
};

export async function listLocalMigrations(): Promise<LocalMigration[]> {
  try {
    const dir = path.join(process.cwd(), "supabase", "migrations");
    const entries = await readdir(dir);

    return await Promise.all(
      entries
        .filter((name) => name.endsWith(".sql"))
        .sort()
        .map(async (name) => ({
          name,
          version: name.split("_")[0] ?? name,
          checksum: sqlChecksum(await readFile(path.join(dir, name), "utf8")),
        }))
    );
  } catch {
    return [];
  }
}

/** Comments and formatting are not part of an applied migration. */
export function normalizeSql(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n\r]*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*([(),;])\s*/g, "$1")
    .replace(/;$/, "");
}

export function sqlChecksum(sql: string): string {
  return createHash("sha256").update(normalizeSql(sql), "utf8").digest("hex");
}

/**
 * The checksum of a ledger row, from the statements Supabase recorded.
 *
 * Null means the ledger did not record statements for this version, so drift
 * cannot be judged. That is reported as `unknown`, never as "up to date".
 */
export function statementsChecksum(statements: unknown): string | null {
  if (!Array.isArray(statements)) return null;

  const parts = statements.filter(
    (statement): statement is string => typeof statement === "string"
  );

  if (parts.length === 0) return null;

  return sqlChecksum(parts.join(";\n"));
}

export function diffMigrations(
  local: LocalMigration[],
  applied: AppliedMigration[]
): MigrationEntry[] {
  const ledger = new Map(applied.map((row) => [row.version, row]));
  const entries: MigrationEntry[] = local.map((migration) => {
    const row = ledger.get(migration.version);

    if (!row) {
      return {
        version: migration.version,
        name: migration.name,
        state: "pending",
      };
    }

    if (!row.checksum) {
      return {
        version: migration.version,
        name: migration.name,
        state: "unknown",
      };
    }

    return {
      version: migration.version,
      name: migration.name,
      state: row.checksum === migration.checksum ? "applied" : "drift",
    };
  });

  const localVersions = new Set(local.map((migration) => migration.version));

  for (const row of applied) {
    if (localVersions.has(row.version)) continue;
    entries.push({
      version: row.version,
      name: row.name ?? `${row.version} (not in this checkout)`,
      state: "orphaned",
    });
  }

  return entries;
}
