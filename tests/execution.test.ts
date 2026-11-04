import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  EXEC_ALLOWED_DOMAINS,
  EXEC_MAX_OUTPUT_BYTES,
  EXEC_STEPS,
  detectCommands,
  tailOf,
} from "../lib/execution/commands";
import {
  EXEC_MAX_MINUTES,
  EXEC_RESERVE_DEW,
  chargeForDuration,
  formatDuration,
} from "../lib/execution/cost";
import { describeRun, isTerminal, type ExecutionRunRow } from "../lib/execution/status";

const BUN_PACKAGE = {
  scripts: { build: "next build", typecheck: "tsc --noEmit" },
};

function row(patch: Partial<ExecutionRunRow>): ExecutionRunRow {
  return {
    id: "run",
    changeset_id: "changeset",
    status: "done",
    stage: "build",
    failure_code: null,
    failure_detail: null,
    install_command: "bun install --frozen-lockfile",
    build_command: "bun run build",
    exit_code: 0,
    duration_ms: 134_000,
    reserved_dew: 0.5,
    charged_dew: 0.15,
    started_at: "2026-11-03T00:00:00.000Z",
    ended_at: "2026-11-03T00:02:14.000Z",
    heartbeat_at: null,
    ...patch,
  };
}

test("a bun workspace resolves to the frozen commands, not the model's choice", () => {
  const detected = detectCommands({
    paths: ["package.json", "bun.lock", "lib/a.ts"],
    packageJson: BUN_PACKAGE,
  });

  expect(detected.install).toBe("bun install --frozen-lockfile");
  expect(detected.build).toBe("bun run build");
  expect(detected.typecheck).toBe("bun run typecheck");
  expect(detected.reason).toBeNull();
});

test("an npm lockfile installs with ci, and a missing lockfile is refused", () => {
  const npm = detectCommands({
    paths: ["package.json", "package-lock.json"],
    packageJson: { scripts: { build: "vite build" } },
  });
  expect(npm.install).toBe("npm ci --no-audit --no-fund");
  expect(npm.build).toBe("npm run build");

  const bare = detectCommands({ paths: ["package.json"], packageJson: BUN_PACKAGE });
  expect(bare.install).toBeNull();
  expect(bare.build).toBeNull();
  expect(bare.reason).toContain("lockfile");
});

test("a package.json with no build script names why, rather than guessing", () => {
  const detected = detectCommands({
    paths: ["package.json", "bun.lock"],
    packageJson: { scripts: { dev: "next dev" } },
  });

  expect(detected.install).toBe("bun install --frozen-lockfile");
  expect(detected.build).toBeNull();
  expect(detected.reason).toContain("build script");
});

test("go, python and unknown shapes each get their own answer", () => {
  expect(detectCommands({ paths: ["go.mod", "main.go"], packageJson: null })).toMatchObject({
    install: "go mod download",
    build: "go build ./...",
  });

  expect(
    detectCommands({ paths: ["requirements.txt"], packageJson: null }).build
  ).toBeNull();

  const unknown = detectCommands({ paths: ["README.md"], packageJson: null });
  expect(unknown.build).toBeNull();
  expect(unknown.reason).toContain("not one Openmi recognises");
});

test("the step list cannot drift from what detection produces", () => {
  const detected = detectCommands({
    paths: ["package.json", "bun.lock"],
    packageJson: BUN_PACKAGE,
  });

  for (const step of EXEC_STEPS) {
    expect(detected[step] === null || typeof detected[step] === "string").toBe(true);
  }

  expect(EXEC_STEPS).toEqual(["install", "build", "typecheck"]);
});

test("the egress allowlist is opt-in, because restricted orgs reject it", () => {
  const provider = readFileSync(
    new URL("../lib/execution/provider.ts", import.meta.url),
    "utf8"
  );

  // A restricted Daytona org refuses the whole create call when the field is
  // present, so it must not be sent unconditionally.
  expect(provider).toContain("networkAllowlistEnabled()");
  expect(provider).toContain("domainAllowList: EXEC_ALLOWED_DOMAINS.join");
  expect(provider).toContain("...(networkAllowlistEnabled()");
});

test("a terminal run with nothing charged does not read as still pending", () => {
  const failed = describeRun(
    row({ status: "failed", failure_code: "refused", charged_dew: 0 })
  );

  expect(failed.charge).toContain("no sandbox time was charged");
  expect(failed.charge).not.toContain("nothing charged yet");

  const running = describeRun(
    row({ status: "running", stage: "provision", charged_dew: 0 })
  );
  expect(running.charge).toContain("nothing charged yet");
});

test("egress is an explicit list, never a wildcard", () => {
  expect(EXEC_ALLOWED_DOMAINS.length).toBeGreaterThan(0);
  expect(EXEC_ALLOWED_DOMAINS.some((domain) => domain.includes("*"))).toBe(false);
});

test("a run is charged per started minute, capped at the reserve", () => {
  expect(chargeForDuration(0)).toBe(0);
  expect(chargeForDuration(1_000)).toBe(0.05);
  expect(chargeForDuration(60_001)).toBe(0.1);
  expect(chargeForDuration(EXEC_MAX_MINUTES * 60_000)).toBe(EXEC_RESERVE_DEW);
  expect(chargeForDuration(EXEC_MAX_MINUTES * 60_000 * 4)).toBe(EXEC_RESERVE_DEW);
  expect(EXEC_RESERVE_DEW).toBe(0.5);
});

test("durations read the way a person says them", () => {
  expect(formatDuration(0)).toBe("0s");
  expect(formatDuration(14_000)).toBe("14s");
  expect(formatDuration(134_000)).toBe("2m 14s");
});

test("the output tail keeps the end and says it truncated", () => {
  const small = tailOf("ok");
  expect(small).toEqual({ text: "ok", truncated: false });

  const line = "x".repeat(100);
  const large = tailOf(Array.from({ length: 2_000 }, () => line).join("\n"));
  expect(large.truncated).toBe(true);
  expect(Buffer.byteLength(large.text, "utf8")).toBeLessThan(EXEC_MAX_OUTPUT_BYTES + 200);
  expect(large.text).toContain("truncated");
});

test("no run is not a pass", () => {
  const described = describeRun(null);
  expect(described.state).toBe("none");
  expect(described.title).toBe("Not verified");
  expect(described.detail).toContain("Nothing has run");
});

test("a success sentence is only reachable from a recorded zero exit", () => {
  const succeeded = describeRun(row({ exit_code: 0 }));
  expect(succeeded.state).toBe("succeeded");
  expect(succeeded.title).toBe("Build succeeded");

  const failedBuild = describeRun(
    row({ status: "failed", failure_code: "build_failed", exit_code: 2 })
  );
  expect(failedBuild.state).toBe("failed");
  expect(failedBuild.title).not.toContain("succeeded");

  const noCode = describeRun(row({ exit_code: null }));
  expect(noCode.state).toBe("failed");
  expect(noCode.title).toBe("No result recorded");
});

test("each failure code has its own sentence", () => {
  const install = describeRun(
    row({ status: "failed", failure_code: "install_failed", exit_code: 1 })
  );
  expect(install.detail.toLowerCase()).toContain("install");

  const quota = describeRun(row({ status: "failed", failure_code: "quota" }));
  expect(quota.detail.toLowerCase()).toContain("quota");

  const crashed = describeRun(row({ status: "failed", failure_code: "crashed" }));
  expect(crashed.detail.toLowerCase()).toContain("stopped reporting");
});

test("the card reports what the ledger charged, never a guess", () => {
  expect(describeRun(row({})).charge).toBe("0.15 Dew charged of 0.5 reserved.");
  expect(describeRun(row({ charged_dew: 0 })).charge).toBe(
    "0.5 Dew reserved; nothing charged yet."
  );
  expect(describeRun(row({ reserved_dew: 0 })).charge).toBeNull();
  expect(describeRun(null).charge).toBeNull();
});

test("an unaffordable run says so instead of failing as a build", () => {
  const described = describeRun(
    row({ status: "failed", failure_code: "insufficient_dew", exit_code: null })
  );

  expect(described.detail.toLowerCase()).toContain("not enough dew");
  expect(described.title).not.toContain("succeeded");
});

test("a timeout says timed out rather than failed", () => {
  const described = describeRun(row({ status: "timed_out", exit_code: null }));
  expect(described.state).toBe("timed_out");
  expect(described.title).toBe("Timed out");
  expect(described.tone).toBe("warn");
});

test("terminal states are the only ones that stop the poll", () => {
  expect(isTerminal("done")).toBe(true);
  expect(isTerminal("failed")).toBe(true);
  expect(isTerminal("timed_out")).toBe(true);
  expect(isTerminal("cancelled")).toBe(true);
  expect(isTerminal("running")).toBe(false);
  expect(isTerminal("queued")).toBe(false);
});
