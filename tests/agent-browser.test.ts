import { expect, test } from "bun:test";

import {
  BROWSER_HOME,
  BROWSER_MAX_IMAGE_BYTES,
  BROWSER_MAX_VIEWPORT,
  BROWSER_MIN_VIEWPORT,
  BROWSER_TOOL_SPEC,
  browserInstallCommand,
  browserScript,
  browserShotCommand,
  clampViewport,
  clampWaitMs,
  parseShotMeta,
  shotCaption,
  shotReport,
  validateBrowserTarget,
  type ShotMeta,
} from "../lib/agent/browser";
import { isShellTool } from "../lib/agent/shell";
import { MISSION_WORKDIR } from "../lib/execution/mission/budget";

/**
 * The browser is the one tool that takes an address, so the address is what is
 * asserted here: http(s) only, passed through argv, never spliced into code.
 */

const META: ShotMeta = {
  ok: true,
  url: "http://localhost:3000/",
  title: "Home",
  status: 200,
  navigationError: null,
  errors: ["boom"],
  viewport: { width: 1_280, height: 800 },
  fullPage: false,
};

test("a screenshot target is an http(s) page, nothing else", () => {
  expect(validateBrowserTarget("http://localhost:3000")?.url).toBe(
    "http://localhost:3000/"
  );
  expect(validateBrowserTarget(" https://example.com/a?b=1 ")?.url).toBe(
    "https://example.com/a?b=1"
  );

  // Anything that is not the web is not a page this tool may open.
  expect(validateBrowserTarget("javascript:alert(1)")).toBeNull();
  expect(validateBrowserTarget("file:///etc/passwd")).toBeNull();
  expect(validateBrowserTarget("ftp://example.com")).toBeNull();
  expect(validateBrowserTarget("data:text/html,hi")).toBeNull();
  expect(validateBrowserTarget("not a url")).toBeNull();
  expect(validateBrowserTarget("")).toBeNull();
  expect(validateBrowserTarget(42)).toBeNull();
  expect(validateBrowserTarget(`https://example.com/${"a".repeat(2_000)}`)).toBeNull();
});

test("viewports and waits are clamped, never trusted", () => {
  expect(clampViewport(undefined, 1_280)).toBe(1_280);
  expect(clampViewport(10, 800)).toBe(BROWSER_MIN_VIEWPORT);
  expect(clampViewport(99_999, 800)).toBe(BROWSER_MAX_VIEWPORT);
  expect(clampViewport("wide", 800)).toBe(800);

  expect(clampWaitMs(undefined)).toBeGreaterThan(0);
  expect(clampWaitMs(-5)).toBeGreaterThan(0);
  expect(clampWaitMs(10_000_000)).toBeLessThanOrEqual(15_000);
});

test("the install is lazy, pinned and outside the workspace", () => {
  const command = browserInstallCommand();

  expect(command).toContain("npx playwright install");
  expect(command).toContain("chromium");
  expect(command).toContain(".ready");
  expect(command).toContain("npm i playwright@");
  expect(BROWSER_HOME.startsWith("/tmp/")).toBe(true);
  expect(BROWSER_HOME).not.toContain(MISSION_WORKDIR);
});

test("a URL is an argument, never code", () => {
  const hostile = "http://example.com/'; touch /tmp/pwned; '";
  const command = browserShotCommand({
    url: hostile,
    outputPath: "/tmp/shot.jpg",
    width: 1_280,
    height: 800,
    fullPage: false,
    waitMs: 0,
  });

  // The quote is escaped, so the URL stays one argument.
  expect(command).toContain("'\\''");
  expect(command).not.toContain(hostile);

  const script = browserScript();
  expect(script).not.toContain(hostile);
  expect(script).toContain("process.argv");
  expect(script).toContain("page.screenshot");
  // The browser is driven directly; nothing here spawns a shell.
  expect(script).not.toContain("child_process");
});

test("the snapshot is read from the last JSON line, and a missing one is a failure", () => {
  const stdout = [
    "npm warn deprecated something",
    JSON.stringify(META),
  ].join("\n");

  const meta = parseShotMeta(stdout);
  expect(meta?.ok).toBe(true);
  expect(meta?.status).toBe(200);
  expect(meta?.errors).toEqual(["boom"]);

  expect(parseShotMeta("")).toBeNull();
  expect(parseShotMeta("not json")).toBeNull();
  expect(parseShotMeta(JSON.stringify({ ok: false, error: "launch failed" }))?.error).toBe(
    "launch failed"
  );
});

test("the caption and the report say what was actually seen", () => {
  const caption = shotCaption(META);

  expect(caption).toContain("Home");
  expect(caption).toContain("200");
  expect(caption).toContain("1280×800");
  expect(caption).toContain("1 console error(s)");

  const report = shotReport(META, 123_456);
  expect(report).toContain("http status: 200");
  expect(report).toContain("console errors:\n- boom");
  expect(report).toContain("123,456 bytes");
});

test("the browser tool is part of a chat turn and takes only an address", () => {
  expect(isShellTool("browser")).toBe(true);
  expect(BROWSER_TOOL_SPEC.name).toBe("browser");
  expect(BROWSER_TOOL_SPEC.parameters.required).toEqual(["url"]);
  expect(BROWSER_TOOL_SPEC.parameters.additionalProperties).toBe(false);
  expect(Object.keys(BROWSER_TOOL_SPEC.parameters.properties)).toEqual([
    "url",
    "full_page",
    "width",
    "height",
    "wait_ms",
    "purpose",
  ]);
  expect(BROWSER_MAX_IMAGE_BYTES).toBeGreaterThan(0);
});
