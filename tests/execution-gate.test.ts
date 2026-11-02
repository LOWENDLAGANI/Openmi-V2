import { expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 10 (execution) is gated, not built. This test is the gate that remains
 * meaningful while it stays unbuilt: no surface may imply that code, tests or a
 * build ran, and no sandbox dependency may appear quietly.
 *
 * If execution is ever built, this file changes with it — deliberately, in the
 * same PR that adds real observations to the review card.
 */

const ROOT = join(import.meta.dir, "..");

const FORBIDDEN = [
  "tests passed",
  "build passed",
  "all tests pass",
  "test suite passed",
  "tests are green",
  "ran the tests",
];

function walk(dir: string): string[] {
  const out: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx|md)$/.test(entry)) {
      out.push(full);
    }
  }

  return out;
}

test("no product surface claims a test or build ran", () => {
  const files = [
    ...walk(join(ROOT, "app")),
    ...walk(join(ROOT, "components")),
    ...walk(join(ROOT, "lib")),
  ];

  for (const file of files) {
    const source = readFileSync(file, "utf8").toLowerCase();

    for (const phrase of FORBIDDEN) {
      if (source.includes(phrase)) {
        throw new Error(`${file.replace(ROOT, "")} claims "${phrase}"`);
      }
    }
  }
});

test("no sandbox dependency was added without the decisions it needs", () => {
  const pkg = readFileSync(join(ROOT, "package.json"), "utf8").toLowerCase();

  for (const name of ["e2b", "daytona", "@vercel/sandbox", "firecracker"]) {
    expect(pkg).not.toContain(name);
  }
});

test("the plan still marks execution as gated and names why", () => {
  const plan = readFileSync(join(ROOT, "OPENMI_BUILD_PHASES.md"), "utf8");

  expect(plan).toContain("Status: not buildable");
  expect(plan).toContain("D6.1");
  expect(plan).toContain("D6.4");
});

test("the README states the gate rather than implying execution", () => {
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");

  expect(readme).toContain("Phase 10");
  expect(readme.toLowerCase()).toContain("not buildable");
});
