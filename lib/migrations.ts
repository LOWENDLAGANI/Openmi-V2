import "server-only";

import { readdir } from "node:fs/promises";
import path from "node:path";

import { supabaseAdmin } from "./supabase/admin";

export type MigrationFile = { name: string; version: string };

/** Migration files as they exist in the repo, in apply order. */
export async function listMigrationFiles(): Promise<MigrationFile[]> {
  try {
    const dir = path.join(process.cwd(), "supabase", "migrations");
    const entries = await readdir(dir);
    return entries
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .map((name) => ({ name, version: name.split("_")[0] ?? name }));
  } catch {
    return [];
  }
}

export type MigrationState = "unconfigured" | "not-applied" | "applied" | "error";

export type MigrationProbe = { state: MigrationState; detail: string };

/**
 * Asks the database whether the base migration has run.
 *
 * This only reads a marker table, and it is the one place besides the migration
 * files where the service role is used. If the table is absent the answer is
 * "not applied", which is a useful fact rather than an error page.
 */
export async function probeMigrations(): Promise<MigrationProbe> {
  const admin = supabaseAdmin();

  if (!admin) {
    return {
      state: "unconfigured",
      detail: "Supabase URL and service-role key are not both set.",
    };
  }

  try {
    const { data, error } = await admin
      .from("openmi_meta")
      .select("value")
      .eq("key", "schema_version")
      .maybeSingle();

    if (error) {
      return {
        state: "not-applied",
        detail: `openmi_meta is not readable: ${error.message}`,
      };
    }

    return {
      state: "applied",
      detail:
        data && typeof data.value === "string"
          ? `schema_version = ${data.value}`
          : "openmi_meta exists but has no schema_version row.",
    };
  } catch (error) {
    return {
      state: "error",
      detail:
        error instanceof Error
          ? error.message
          : "The database could not be reached.",
    };
  }
}
