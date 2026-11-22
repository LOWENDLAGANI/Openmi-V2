import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

/**
 * The tells this product refuses, pinned.
 *
 * These are not style preferences: each one was a measurable marker of
 * generated-site clichés — animated gradient borders, gradient-clipped
 * headline type, faux macOS traffic-light dots, pulsing dot badges, purple/
 * lavender dark themes, radial glow backdrops, or editorial serif+cream
 * templates. A future edit can still add one, but it has to fail a test first.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const at = (path: string) => new URL(`../${path}`, import.meta.url);

const PACKAGE = JSON.parse(read("package.json")) as {
  dependencies?: Record<string, string>;
};

test("the composer is one surface, not a glowing frame", () => {
  const composer = read("components/Composer.tsx");

  expect(composer).not.toContain("Beam");
  expect(existsSync(at("components/Beam.tsx"))).toBe(false);
  expect(PACKAGE.dependencies?.["border-beam"]).toBeUndefined();
});

test("no gradient is applied to type", () => {
  const css = read("app/globals.css");

  expect(css).not.toContain(".gradient-text");

  for (const file of ["app/page.tsx", "components/LandingPreview.tsx"]) {
    expect(read(file)).not.toContain("gradient-text");
    expect(read(file)).not.toContain("bg-clip-text");
  }
});

test("the landing page shows facts instead of labelling the page", () => {
  const landing = read("app/page.tsx");

  expect(landing).not.toContain("uppercase");
  expect(landing.toLowerCase()).not.toContain("honest");
  expect(read("app/about/page.tsx")).not.toContain("The honesty rule");
});

test("no screenshot of a design that no longer exists", () => {
  expect(existsSync(at("landing-page.png"))).toBe(false);
  expect(read("components/LandingPreview.tsx")).toContain("role=\"img\"");
});

test("precision typography and zero AI-slop visual tropes", () => {
  const layout = read("app/layout.tsx");
  const css = read("app/globals.css");
  const preview = read("components/LandingPreview.tsx");
  const about = read("app/about/page.tsx");

  // No editorial-serif + Instrument Sans cliché
  expect(layout).not.toContain("Fraunces");
  expect(layout).not.toContain("Instrument_Sans");
  expect(layout).toContain("Geist");

  // No purple/lavender ink theme or radial dark-mode glow
  expect(css).not.toContain("#a09ad8");
  expect(css).not.toContain("#1b1826");
  const darkBlock = css.slice(css.indexOf("html.dark {"), css.indexOf("html.ink {"));
  expect(darkBlock).not.toContain("radial-gradient");

  // No macOS traffic lights, pulsing badge dots, or left-stripe callout cards
  expect(css).not.toContain(".preview-dots");
  expect(css).not.toContain("badge-pulse");
  expect(preview).not.toContain("preview-dots");
  expect(about).not.toContain("shadow-[inset_3px_0_0_var(--accent)]");
});
