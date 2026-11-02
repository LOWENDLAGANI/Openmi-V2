import { expect, test } from "@playwright/test";

/**
 * The two pages that must work on a deployment with no environment at all.
 *
 * Everything else needs an account, a GitHub token and a provider key, so those
 * flows are manual steps in the README instead of specs that would skip
 * silently and call themselves green.
 */

test("the sign-in page renders with no configuration", async ({ page }) => {
  const response = await page.goto("/login");

  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Sign in to Openmi" })
  ).toBeVisible();
  await expect(page.locator("form button").first()).toBeVisible();
});

test("setup names what is missing instead of failing", async ({ page }) => {
  await page.goto("/setup");

  await expect(page.getByRole("heading", { name: "Setup", level: 1 })).toBeVisible();
  await expect(page.getByText("Configuration", { exact: true })).toBeVisible();
  await expect(page.getByText("Migrations", { exact: true })).toBeVisible();
  await expect(page.getByText("Live probes", { exact: true })).toBeVisible();
  await expect(page.getByText("Still missing", { exact: true })).toBeVisible();
});
