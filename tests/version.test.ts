import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { APP_VERSION, APP_VERSION_TAG, CHANGELOG } from "../lib/version";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("APP_VERSION matches package.json and the latest CHANGELOG entry", () => {
  const pkg = JSON.parse(read("package.json")) as { version?: string };

  expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  expect(APP_VERSION_TAG).toBe(`v${APP_VERSION}`);
  expect(pkg.version).toBe(APP_VERSION);

  expect(CHANGELOG.length).toBeGreaterThan(0);
  expect(CHANGELOG[0]?.version).toBe(APP_VERSION);
  expect(CHANGELOG[0]?.changes.length).toBeGreaterThan(0);
});

test("CHANGELOG.md documents the current version and every entry in CHANGELOG", () => {
  const markdown = read("CHANGELOG.md");

  for (const entry of CHANGELOG) {
    expect(markdown).toContain(`## [${entry.version}]`);
    expect(markdown).toContain(entry.title);
  }
});

test("version badge is displayed in the sidebar, landing footer, and about page", () => {
  const sidebar = read("components/Sidebar.tsx");
  const landing = read("app/page.tsx");
  const about = read("app/about/page.tsx");

  expect(sidebar).toContain("VersionBadge");
  expect(landing).toContain("VersionBadge");
  expect(about).toContain("VersionBadge");
  expect(about).toContain("CHANGELOG");
});
