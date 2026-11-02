import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  diffMigrations,
  normalizeSql,
  sqlChecksum,
  statementsChecksum,
} from "../lib/migrations";
import { classifyProviderStatus } from "../lib/probe-status";

const SETUP = readFileSync(
  new URL("../app/setup/page.tsx", import.meta.url),
  "utf8"
);
const ABOUT = readFileSync(
  new URL("../app/about/page.tsx", import.meta.url),
  "utf8"
);
const LEDGER = readFileSync(
  new URL("../supabase/migrations/009_setup.sql", import.meta.url),
  "utf8"
);
const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("reformatting a migration is not drift, editing a statement is", () => {
  const applied = [
    {
      version: "001",
      name: "001_a.sql",
      checksum: sqlChecksum("create table a (id integer);"),
    },
  ];

  const reformatted = [
    {
      version: "001",
      name: "001_a.sql",
      checksum: sqlChecksum("-- a note\ncreate  table a (\n  id integer\n);"),
    },
  ];

  expect(diffMigrations(reformatted, applied)[0].state).toBe("applied");

  const edited = [
    {
      version: "001",
      name: "001_a.sql",
      checksum: sqlChecksum("create table a (id bigint);"),
    },
  ];

  expect(diffMigrations(edited, applied)[0].state).toBe("drift");
});

test("pending, unknown and orphaned are distinct states", () => {
  const local = [
    { name: "001_a.sql", version: "001", checksum: sqlChecksum("select 1;") },
    { name: "002_b.sql", version: "002", checksum: sqlChecksum("select 2;") },
  ];

  const applied = [
    {
      version: "001",
      name: "001_a.sql",
      checksum: sqlChecksum("select 1;"),
    },
    { version: "003", name: "003_c.sql", checksum: null },
  ];

  const entries = diffMigrations(local, applied);

  expect(entries.find((entry) => entry.version === "001")?.state).toBe("applied");
  expect(entries.find((entry) => entry.version === "002")?.state).toBe("pending");
  expect(entries.find((entry) => entry.version === "003")?.state).toBe("orphaned");

  const unknown = diffMigrations(
    [local[0]],
    [{ version: "001", name: "001_a.sql", checksum: null }]
  );
  expect(unknown[0].state).toBe("unknown");
});

test("normalization ignores comments and whitespace, not content", () => {
  expect(normalizeSql("-- hi\nselect  1;\n")).toBe("select 1");
  expect(normalizeSql("/* block */ select 1;")).toBe("select 1");
  expect(normalizeSql("select 1;")).not.toBe(normalizeSql("select 2;"));
});

test("a ledger row with no statements cannot claim a match", () => {
  expect(statementsChecksum(null)).toBeNull();
  expect(statementsChecksum([])).toBeNull();
  expect(statementsChecksum(["select 1"])).toBe(sqlChecksum("select 1"));
});

test("provider statuses become specific messages", () => {
  expect(classifyProviderStatus(200).state).toBe("ok");
  expect(classifyProviderStatus(401).state).toBe("failed");
  expect(classifyProviderStatus(401).detail).toContain("rejected");
  expect(classifyProviderStatus(429).state).toBe("ok");
  expect(classifyProviderStatus(429).detail).toContain("rate limiting");
  expect(classifyProviderStatus(500).detail).toContain("500");
});

test("the setup page reads presence, the ledger and live probes", () => {
  expect(SETUP).toContain("readEnvReport");
  expect(SETUP).toContain("readMigrationReport");
  expect(SETUP).toContain("runSetupProbes");
  expect(SETUP).not.toContain("process.env");
  expect(SETUP).toContain("Values are never read back");
});

test("the ledger function is service-role only", () => {
  expect(LEDGER).toContain("openmi_migration_ledger");
  expect(LEDGER).toContain("security definer");
  expect(LEDGER).not.toMatch(
    /grant execute on function public\.openmi_migration_ledger\(\) to (anon|authenticated)/
  );
  expect(LEDGER).toContain("operator_adjust_dew");
});

test("the about page claims no verification the product does not perform", () => {
  expect(ABOUT).toContain("AGENT_BRANCH_PREFIX");
  expect(ABOUT).toContain("DEW_PER_HOUR");
  expect(ABOUT).toContain("does not run");
  expect(ABOUT.toLowerCase()).not.toContain("tests passed");
  expect(ABOUT.toLowerCase()).not.toContain("build passed");
  expect(ABOUT.toLowerCase()).not.toContain("all tests");
});

test("the README points at both truth surfaces", () => {
  expect(README).toContain("/setup");
  expect(README).toContain("/about");
});
