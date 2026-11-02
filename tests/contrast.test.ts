import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

/**
 * The contrast gate is a script so a contributor can run it without Bun, and a
 * test so `bun run test` cannot go green while it fails. One implementation.
 */
test("every text pair clears 4.5:1 in all three themes", () => {
  const result = spawnSync("node", ["scripts/check-contrast.mjs"], {
    cwd: new URL("..", import.meta.url).pathname,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
  }

  expect(result.status).toBe(0);
});
