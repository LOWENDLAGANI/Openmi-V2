import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { adminPanelEnabled } from "../lib/admin/switches";

const ACCESS = readFileSync(
  new URL("../lib/admin/access.ts", import.meta.url),
  "utf8"
);
const PAGE = readFileSync(new URL("../app/admin/page.tsx", import.meta.url), "utf8");
const ACTIONS = readFileSync(
  new URL("../app/admin/actions.ts", import.meta.url),
  "utf8"
);
const STATUS = readFileSync(
  new URL("../app/api/admin/status/route.ts", import.meta.url),
  "utf8"
);
const EXAMPLE = readFileSync(new URL("../.env.example", import.meta.url), "utf8");

test("unset or blank keeps the panel on, as it always was", () => {
  expect(adminPanelEnabled({})).toBe(true);
  expect(adminPanelEnabled({ OPENMI_ADMIN_PANEL: "" })).toBe(true);
  expect(adminPanelEnabled({ OPENMI_ADMIN_PANEL: "   " })).toBe(true);
});

test("off means off in every spelling, and anything else is on", () => {
  for (const off of ["off", "OFF", "false", "FALSE", "0", "no", "disabled"]) {
    expect(adminPanelEnabled({ OPENMI_ADMIN_PANEL: off })).toBe(false);
    expect(adminPanelEnabled({ OPENMI_ADMIN_PANEL: ` ${off} ` })).toBe(false);
  }

  for (const on of ["on", "true", "1", "yes", "anything-else"]) {
    expect(adminPanelEnabled({ OPENMI_ADMIN_PANEL: on })).toBe(true);
  }
});

test("the switch is checked before the allowlist and before the database role", () => {
  const gate = ACCESS.indexOf("if (!adminPanelEnabled())");
  const allowlist = ACCESS.indexOf("isVerifiedAllowlistedAdmin(user.email");
  const role = ACCESS.indexOf('rpc("is_admin")');

  expect(gate).toBeGreaterThan(-1);
  expect(allowlist).toBeGreaterThan(-1);
  expect(role).toBeGreaterThan(-1);

  // The order is the guarantee: a compromised account that still holds the role
  // row and a valid session must not be able to outrank an operator's flip.
  expect(gate).toBeLessThan(allowlist);
  expect(gate).toBeLessThan(role);
});

test("a disabled panel gives the stranger's answer, not an explanation", () => {
  // `forbidden` is what an ordinary signed-in account already gets: the page
  // 404s, the actions redirect, and nothing tells an attacker the switch exists.
  expect(ACCESS).toContain('if (!adminPanelEnabled()) return { state: "forbidden", email: null };');
});

test("every admin surface resolves access through that one function", () => {
  expect(PAGE).toContain("readAdminAccess()");
  expect(ACTIONS).toContain("requireAdmin()");
  expect(STATUS).toContain("readAdminAccess()");

  // No second gate: a direct `is_admin()` call somewhere would be a place the
  // switch could be forgotten.
  for (const source of [PAGE, ACTIONS, STATUS]) {
    expect(source).not.toContain('rpc("is_admin"');
  }
});

test("the switch is documented where an operator would look for it", () => {
  expect(EXAMPLE).toContain("OPENMI_ADMIN_PANEL=");
  expect(EXAMPLE).toContain("kill switch");
});
