import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * These are source assertions on the security boundary, because the parts that
 * matter most cannot be exercised without a Supabase project: a signed-in
 * account that is not an admin must be refused by the server, and every admin
 * mutation must re-derive the role.
 */

const MIDDLEWARE = readFileSync(
  new URL("../middleware.ts", import.meta.url),
  "utf8"
);
const ADMIN_PAGE = readFileSync(
  new URL("../app/admin/page.tsx", import.meta.url),
  "utf8"
);
const ADMIN_ACTIONS = readFileSync(
  new URL("../app/admin/actions.ts", import.meta.url),
  "utf8"
);
const PAY_ACTIONS = readFileSync(
  new URL("../app/pay/actions.ts", import.meta.url),
  "utf8"
);
const STATUS_ROUTE = readFileSync(
  new URL("../app/api/admin/status/route.ts", import.meta.url),
  "utf8"
);
const MIGRATION = readFileSync(
  new URL("../supabase/migrations/013_admin_payments.sql", import.meta.url),
  "utf8"
);
const BRAND = readFileSync(
  new URL("../components/Brand.tsx", import.meta.url),
  "utf8"
);

test("middleware gates the admin and billing routes behind a session", () => {
  expect(MIDDLEWARE).toContain('"/admin/:path*"');
  expect(MIDDLEWARE).toContain('"/pay/:path*"');
});

test("the admin page resolves access on the server and hides itself", () => {
  expect(ADMIN_PAGE).toContain("readAdminAccess()");
  expect(ADMIN_PAGE).toContain("notFound()");
  expect(ADMIN_PAGE).toContain('redirect("/login?next=%2Fadmin")');
  expect(ADMIN_PAGE).toContain('export const dynamic = "force-dynamic"');
  expect(ADMIN_PAGE).toContain("robots:");
});

test("admin mutations re-check access instead of trusting the form", () => {
  expect(ADMIN_ACTIONS).toContain("await requireAdmin()");
  expect(ADMIN_ACTIONS).toContain('rpc("review_payment_request"');
  expect(ADMIN_ACTIONS).toContain('rpc("admin_grant_dew"');
  expect(ADMIN_ACTIONS).toContain('rpc("admin_set_admin"');
  expect(ADMIN_ACTIONS).not.toContain("isAdmin:");
});

test("receipts are stored privately before the request is written", () => {
  const uploadAt = PAY_ACTIONS.indexOf(".upload(path");
  const insertAt = PAY_ACTIONS.indexOf('rpc("submit_payment_request"');

  expect(uploadAt).toBeGreaterThan(-1);
  expect(insertAt).toBeGreaterThan(uploadAt);
  expect(PAY_ACTIONS).toContain(".remove([path])");
  expect(PAY_ACTIONS).toContain("MAX_BYTES");
  expect(PAY_ACTIONS).toContain("image/png");
});

test("the status route is uncacheable and tells the truth about the session", () => {
  expect(STATUS_ROUTE).toContain('"cache-control": "no-store"');
  expect(STATUS_ROUTE).toContain("readAdminAccess()");
});

test("the logo carries the gesture and reveals verification, not access", () => {
  expect(BRAND).toContain("advanceGesture");
  expect(BRAND).toContain("signInWithOAuth");
  expect(BRAND).toContain("createPortal");
  expect(BRAND).toContain("/api/admin/status");
});

test("the migration makes the role table unreadable and re-checks the role", () => {
  expect(MIGRATION).toContain("revoke all on public.admin_users");
  expect(MIGRATION).toContain("security definer");
  expect(MIGRATION).toContain("if not public.is_admin() then");
  expect(MIGRATION).toContain(
    "revoke update on public.profiles from authenticated"
  );
  expect(MIGRATION).toContain("grant update (timezone, handle)");
  expect(MIGRATION).toContain("for select to authenticated");
  expect(MIGRATION).not.toContain(
    "for insert to authenticated\n  with check (true)"
  );
});
