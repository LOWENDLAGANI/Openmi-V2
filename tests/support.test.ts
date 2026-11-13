import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { SUPPORT_EMAIL, supportMailto } from "../lib/support";

/**
 * One address, one place.
 *
 * The support address appears in both legal pages, and anywhere else a reader is
 * told to write to us. Two spellings of it means one of them is wrong, and the
 * failure is silent until mail bounces — so the pages are checked against the
 * constant instead of being trusted to copy it correctly.
 */

test("the support address is a real mailbox, not a placeholder", () => {
  expect(SUPPORT_EMAIL).toBe("support@openmi.space");
  // The values a template ships with, and the ones that reach nobody.
  expect(SUPPORT_EMAIL).not.toContain("example.com");
  expect(SUPPORT_EMAIL).not.toContain("yourdomain");
  expect(SUPPORT_EMAIL).not.toMatch(/^(support|hello|contact)@?$/);
});

test("a mailto link carries the address and encodes its subject", () => {
  expect(supportMailto()).toBe("mailto:support@openmi.space");
  expect(supportMailto("Delete my data")).toBe(
    "mailto:support@openmi.space?subject=Delete%20my%20data"
  );
  // A `&` in a subject must not become a second query parameter.
  expect(supportMailto("refund & close")).toBe(
    "mailto:support@openmi.space?subject=refund%20%26%20close"
  );
});

test("the legal pages use the constant rather than their own copy", () => {
  for (const page of ["../app/privacy/page.tsx", "../app/terms/page.tsx"]) {
    const source = readFileSync(new URL(page, import.meta.url), "utf8");

    expect(source).toContain('from "@/lib/support"');
    expect(source).toContain("{SUPPORT_EMAIL}");
    // A literal address in a page is how the two copies drift apart.
    expect(source).not.toContain("support@openmi.space");
  }
});
