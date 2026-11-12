import { expect, test } from "bun:test";

import {
  PREVIEW_DEFAULT_PORT,
  PREVIEW_IDLE_STOP_MINUTES,
  PREVIEW_MAX_MINUTES_PER_CHAT,
  PREVIEW_POLL_INTERVAL_MS,
  PREVIEW_READY_ATTEMPTS,
  PREVIEW_READY_TIMEOUT_MS,
  PREVIEW_VITE_PORT,
  detectDevServer,
  isPreviewProcessId,
  portFromScript,
  previewEnabled,
  previewExpiry,
  previewProcessId,
  readinessCommand,
} from "../lib/execution/preview/plan";

/**
 * What a preview will run, before a sandbox exists.
 *
 * These cases pin the two things that go wrong quietly: a repository whose dev
 * script was guessed instead of read, and a readiness loop that forgets to give
 * up. The first produces a server on the wrong port that the panel reports as a
 * broken app; the second produces a request that never returns.
 */

const pkg = (scripts: Record<string, string>) => ({ scripts });

test("a Next dev script runs with the repository's own package manager", () => {
  const detected = detectDevServer({
    paths: ["bun.lock", "package.json"],
    packageJson: pkg({ dev: "next dev" }),
  });

  expect(detected.ok).toBe(true);
  if (!detected.ok) return;

  expect(detected.plan.command).toBe("bun run dev");
  expect(detected.plan.port).toBe(PREVIEW_DEFAULT_PORT);
  expect(detected.plan.framework).toBe("next");
  expect(detected.plan.script).toBe("dev");
});

test("Vite gets its own default port", () => {
  const detected = detectDevServer({
    paths: ["package-lock.json"],
    packageJson: pkg({ dev: "vite" }),
  });

  expect(detected.ok).toBe(true);
  if (!detected.ok) return;

  expect(detected.plan.port).toBe(PREVIEW_VITE_PORT);
  // Vite binds loopback by default; without this the sandbox host answers
  // nothing and the panel would report a working server as a failed start.
  expect(detected.plan.command).toBe("npm run dev -- --host 0.0.0.0");

  const alreadyHosted = detectDevServer({
    paths: [],
    packageJson: pkg({ dev: "vite --host 0.0.0.0" }),
  });

  expect(alreadyHosted.ok).toBe(true);
  if (alreadyHosted.ok) {
    expect(alreadyHosted.plan.command).toBe("npm run dev");
  }
});

test("a port written in the script beats every default", () => {
  for (const script of ["next dev --port 4100", "vite -p 4100", "node server.js --port=4100"]) {
    const detected = detectDevServer({ paths: [], packageJson: pkg({ dev: script }) });

    expect(detected.ok).toBe(true);
    if (!detected.ok) return;

    expect(detected.plan.port).toBe(4100);
  }

  expect(portFromScript("next dev")).toBeNull();
  expect(portFromScript("next dev --port 99999")).toBeNull();
});

test("start is used when there is no dev script, and says which one ran", () => {
  const detected = detectDevServer({
    paths: ["pnpm-lock.yaml"],
    packageJson: pkg({ start: "next start" }),
  });

  expect(detected.ok).toBe(true);
  if (!detected.ok) return;

  expect(detected.plan.script).toBe("start");
  expect(detected.plan.command).toBe("pnpm run start");
});

test("a workspace that cannot say how it runs gets a reason, not a guess", () => {
  const noScripts = detectDevServer({
    paths: [],
    packageJson: pkg({ build: "next build" }),
  });

  expect(noScripts.ok).toBe(false);
  if (noScripts.ok) return;
  expect(noScripts.reason).toContain("no dev or start script");

  // `{}` is a package.json that declares no scripts, so it gets the script
  // sentence, not the missing-file one. A reason has to name what is missing.
  const empty = detectDevServer({ paths: ["package.json"], packageJson: {} });
  expect(empty.ok).toBe(false);
  if (empty.ok) return;
  expect(empty.reason).toContain("no dev or start script");

  for (const packageJson of [null, [], "nope"]) {
    const noPackage = detectDevServer({ paths: ["package.json"], packageJson });

    expect(noPackage.ok).toBe(false);
    if (noPackage.ok) return;
    expect(noPackage.reason).toContain("no package.json");
  }
});

test("the readiness loop gives up inside the time it is allowed", () => {
  expect(PREVIEW_READY_ATTEMPTS * (PREVIEW_POLL_INTERVAL_MS + 1_000)).toBeLessThanOrEqual(
    PREVIEW_READY_TIMEOUT_MS + 5_000
  );

  const command = readinessCommand(4321);

  expect(command).toContain("127.0.0.1:4321");
  expect(command).toContain("exit 1");
});

test("the preview is on only where a sandbox can exist", () => {
  expect(previewEnabled({})).toBe(false);
  expect(previewEnabled({ OPENMI_PREVIEW: "on" })).toBe(false);

  const configured = { E2B_API_KEY: "k" };
  expect(previewEnabled(configured)).toBe(true);

  for (const off of ["off", "false", "0", "OFF"]) {
    expect(previewEnabled({ ...configured, OPENMI_PREVIEW: off })).toBe(false);
  }

  expect(previewEnabled({ ...configured, EXECUTION_ENABLED: "off" })).toBe(false);
});

test("a preview expires by lifetime first, then by idleness", () => {
  const now = Date.UTC(2026, 10, 12, 12, 0);
  const ago = (minutes: number) =>
    new Date(now - minutes * 60_000).toISOString();

  const running = (startedMinutesAgo: number, hitMinutesAgo: number) => ({
    state: "ready" as const,
    startedAt: ago(startedMinutesAgo),
    lastHitAt: ago(hitMinutesAgo),
  });

  expect(PREVIEW_IDLE_STOP_MINUTES).toBeLessThan(PREVIEW_MAX_MINUTES_PER_CHAT);

  expect(previewExpiry(running(1, 0), now)).toBe("none");
  expect(previewExpiry(running(PREVIEW_MAX_MINUTES_PER_CHAT, 0), now)).toBe(
    "max-lifetime"
  );
  expect(previewExpiry(running(5, PREVIEW_IDLE_STOP_MINUTES), now)).toBe("idle");

  // The hour wins even when the panel was also closed, because it is the limit
  // a reader can reason about.
  expect(
    previewExpiry(running(PREVIEW_MAX_MINUTES_PER_CHAT, PREVIEW_MAX_MINUTES_PER_CHAT), now)
  ).toBe("max-lifetime");

  // Only a served preview expires; an unknown age never stops anything.
  expect(previewExpiry({ state: "stopped", startedAt: ago(600), lastHitAt: ago(600) }, now)).toBe("none");
  expect(previewExpiry({ state: "failed", startedAt: ago(600), lastHitAt: null }, now)).toBe("none");
  expect(previewExpiry({ state: "ready", startedAt: null, lastHitAt: null }, now)).toBe("none");
});

test("a preview process id is generated, not accepted", () => {
  const id = previewProcessId(1_700_000_000_000);

  expect(isPreviewProcessId(id)).toBe(true);
  expect(isPreviewProcessId("pv0")).toBe(false);
  expect(isPreviewProcessId("p1700000000000")).toBe(false);
  expect(isPreviewProcessId("../../etc/passwd")).toBe(false);
  expect(isPreviewProcessId(null)).toBe(false);
});
