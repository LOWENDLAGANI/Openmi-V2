import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

/**
 * The tells this product refuses, pinned.
 *
 * These are not style preferences: each one was a measurable marker in the 2026
 * studies of generated sites — an animated gradient border on the primary
 * control, gradient-clipped headline type, a page that calls itself honest, a
 * screenshot of a design that no longer exists. A future edit can still add
 * one, but it has to delete a failing test first.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const at = (path: string) => new URL(`../${path}`, import.meta.url);

const PACKAGE = JSON.parse(read("package.json")) as {
  dependencies?: Record<string, string>;
};

test("the composer is one surface, not a glowing frame", () => {
  const composer = read("components/Composer.tsx");

  // A rainbow animated border around the message field is the single most
  // recognisable generated-UI ornament, and it was here.
  expect(composer).not.toContain("Beam");
  expect(existsSync(at("components/Beam.tsx"))).toBe(false);
  expect(PACKAGE.dependencies?.["border-beam"]).toBeUndefined();
});

test("no gradient is applied to type", () => {
  const css = read("app/globals.css");

  // A heading whose colour has to fade to stay interesting is decoration
  // applied to typography, and its light end fails contrast on a phone.
  expect(css).not.toContain(".gradient-text");

  for (const file of ["app/page.tsx", "components/LandingPreview.tsx"]) {
    expect(read(file)).not.toContain("gradient-text");
    expect(read(file)).not.toContain("bg-clip-text");
  }
});

test("the landing page shows facts instead of labelling the page", () => {
  const landing = read("app/page.tsx");

  // No uppercase kicker above every heading, and no page calling itself honest:
  // both are counted generation tells, and neither is information.
  expect(landing).not.toContain("uppercase");
  expect(landing.toLowerCase()).not.toContain("honest");
  expect(read("app/about/page.tsx")).not.toContain("The honesty rule");
});

test("no screenshot of a design that no longer exists", () => {
  // A committed landing-page.png went stale the moment the page was rebuilt;
  // the product is drawn in HTML, which cannot drift from the app.
  expect(existsSync(at("landing-page.png"))).toBe(false);
  expect(read("components/LandingPreview.tsx")).toContain("role=\"img\"");
});
