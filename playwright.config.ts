import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke tests for the surfaces that need no account.
 *
 * `bun run build` first: `next start` serves the production build, and these
 * specs are about what a deploy actually serves. The authenticated flows are
 * manual steps in the README because they need a real Supabase project, a real
 * GitHub token and a provider key — three things a CI runner does not have.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "bun run start",
    port: 3100,
    reuseExistingServer: true,
    timeout: 60_000,
    env: { PORT: "3100" },
  },
});
