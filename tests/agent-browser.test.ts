import { expect, test } from "bun:test";

import {
  BROWSER_HOME,
  BROWSER_MAX_ACTIONS,
  BROWSER_MAX_IMAGE_BYTES,
  BROWSER_MAX_SCROLL,
  BROWSER_MAX_VALUE_CHARS,
  BROWSER_MAX_VIEWPORT,
  BROWSER_MIN_VIEWPORT,
  BROWSER_STATE_PATH,
  BROWSER_TOOL_SPEC,
  browserInstallCommand,
  browserScript,
  browserShotCommand,
  clampViewport,
  clampWaitMs,
  parseBrowserActions,
  parseShotMeta,
  shotCaption,
  shotReport,
  validateBrowserTarget,
  type ShotMeta,
} from "../lib/agent/browser";
import { isShellTool } from "../lib/agent/shell";
import { MISSION_WORKDIR } from "../lib/execution/mission/budget";

/**
 * The browser is the one tool that takes an address and then acts on a page, so
 * what is asserted here is the boundary: http(s) only, every step validated
 * before a browser starts, and no typed value ever reachable from argv.
 */

const META: ShotMeta = {
  ok: true,
  url: "http://localhost:3000/settings",
  title: "Settings",
  status: 200,
  errors: ["boom"],
  viewport: { width: 1_280, height: 800 },
  fullPage: false,
  steps: [
    { index: 1, action: "goto", ok: true, detail: "200 http://localhost:3000/settings" },
    { index: 2, action: "fill", ok: true, detail: "#email filled" },
    { index: 3, action: "click", ok: true, detail: "button[type=submit]" },
  ],
  stopped: null,
  text: "Settings\nAccount\n",
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

test("every step is validated before a browser starts", () => {
  expect(parseBrowserActions(undefined)).toEqual({ ok: true, actions: [] });
  expect(parseBrowserActions([])).toEqual({ ok: true, actions: [] });

  expect(
    parseBrowserActions([
      { type: "goto", url: "http://localhost:3000" },
      { type: "click", text: "Sign in" },
      { type: "fill", selector: "#email", value: "user@example.com" },
      { type: "press", key: "Enter" },
      { type: "type", text: "hello" },
      { type: "scroll", y: 400 },
      { type: "wait", ms: 500 },
      { type: "back" },
    ])
  ).toEqual({
    ok: true,
    actions: [
      { type: "goto", url: "http://localhost:3000/" },
      { type: "click", text: "Sign in" },
      { type: "fill", selector: "#email", value: "user@example.com" },
      { type: "press", key: "Enter" },
      { type: "type", text: "hello" },
      { type: "scroll", y: 400 },
      { type: "wait", ms: 500 },
      { type: "back" },
    ],
  });

  // A password may carry spaces; a filled value is never trimmed.
  const filled = parseBrowserActions([
    { type: "fill", selector: "#password", value: "  hunter2  " },
  ]);
  expect(filled.ok && filled.actions[0]).toEqual({
    type: "fill",
    selector: "#password",
    value: "  hunter2  ",
  });
});

test("a page cannot be reached by a step that is not a page", () => {
  const rejected = [
    "not an array",
    [{ type: "evaluate", script: "fetch('/admin')" }],
    [{ type: "goto", url: "javascript:alert(1)" }],
    [{ type: "goto", url: "file:///etc/passwd" }],
    [{ type: "click" }],
    [{ type: "fill", selector: "#email" }],
    [{ type: "fill", selector: "#email", value: "" }],
    [{ type: "fill", selector: "#email", value: "a".repeat(BROWSER_MAX_VALUE_CHARS + 1) }],
    [{ type: "press" }],
    [{ type: "scroll" }],
    [{ type: "wait" }],
    [{ type: "wait", ms: "soon" }],
    ["click the button"],
  ];

  for (const plan of rejected) {
    expect(parseBrowserActions(plan).ok).toBe(false);
  }

  expect(
    parseBrowserActions(
      Array.from({ length: BROWSER_MAX_ACTIONS + 1 }, () => ({ type: "back" }))
    ).ok
  ).toBe(false);

  // A scroll cannot walk the page into a second viewport's worth of work.
  const scrolled = parseBrowserActions([{ type: "scroll", y: 10_000_000 }]);
  expect(scrolled.ok && scrolled.actions[0]).toEqual({
    type: "scroll",
    y: BROWSER_MAX_SCROLL,
  });
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

test("the plan is a file, so a typed secret is never an argument", () => {
  const command = browserShotCommand({
    planPath: "/tmp/openmi-browser/shots/plan-1.json",
    outputPath: "/tmp/openmi-browser/shots/shot-1.jpg",
    width: 1_280,
    height: 800,
    fullPage: false,
    waitMs: 500,
  });

  expect(command).toContain("plan-1.json");
  expect(command).toContain("shot-1.jpg");
  expect(command.endsWith("1280 800 0 500")).toBe(true);

  const script = browserScript();

  // The script is constant: everything call-specific arrives through the plan.
  expect(script).toContain("process.argv");
  expect(script).toContain("readFileSync(planPath");
  expect(script).toContain("storageState");
  expect(script).toContain("page.screenshot");
  // Real input events, never page-supplied code.
  expect(script).not.toContain("page.evaluate");
  expect(script).not.toContain("child_process");
  expect(BROWSER_STATE_PATH).not.toContain(MISSION_WORKDIR);
});

test("the snapshot is read from the last JSON line, and a missing one fails", () => {
  const stdout = [
    "npm warn deprecated something",
    JSON.stringify(META),
  ].join("\n");

  const meta = parseShotMeta(stdout);
  expect(meta?.ok).toBe(true);
  expect(meta?.status).toBe(200);
  expect(meta?.errors).toEqual(["boom"]);
  expect(meta?.steps).toHaveLength(3);
  expect(meta?.steps[1]?.detail).toBe("#email filled");
  expect(meta?.text).toContain("Settings");

  expect(parseShotMeta("")).toBeNull();
  expect(parseShotMeta("not json")).toBeNull();
  expect(parseShotMeta(JSON.stringify({ ok: false, error: "launch failed" }))?.error).toBe(
    "launch failed"
  );
});

test("the caption and the report say what was actually seen and done", () => {
  const caption = shotCaption(META);

  expect(caption).toContain("Settings");
  expect(caption).toContain("200");
  expect(caption).toContain("1280×800");
  expect(caption).toContain("3 steps");
  expect(caption).toContain("1 console error(s)");

  const report = shotReport(META, 123_456);
  expect(report).toContain("http status: 200");
  expect(report).toContain("2. fill ok: #email filled");
  expect(report).toContain("page text (truncated):");
  expect(report).toContain("console errors:\n- boom");
  expect(report).toContain("123,456 bytes");

  const failed = shotReport(
    {
      ...META,
      stopped: "step 3 (click) failed",
      steps: [
        { index: 1, action: "goto", ok: true, detail: "" },
        { index: 2, action: "click", ok: false, detail: "Timeout 10000ms" },
      ],
    },
    10
  );
  expect(failed).toContain("2. click FAILED: Timeout 10000ms");
  expect(failed).toContain("stopped: step 3 (click) failed");
});

test("the browser tool is part of a chat turn and takes a page plus steps", () => {
  expect(isShellTool("browser")).toBe(true);
  expect(BROWSER_TOOL_SPEC.name).toBe("browser");
  expect(BROWSER_TOOL_SPEC.parameters.required).toEqual([]);
  expect(BROWSER_TOOL_SPEC.parameters.additionalProperties).toBe(false);
  expect(Object.keys(BROWSER_TOOL_SPEC.parameters.properties)).toEqual([
    "url",
    "actions",
    "full_page",
    "width",
    "height",
    "wait_ms",
    "purpose",
  ]);
  expect(BROWSER_TOOL_SPEC.parameters.properties.actions.items.required).toEqual([
    "type",
  ]);
  expect(BROWSER_TOOL_SPEC.parameters.properties.actions.items.properties.type.enum).toContain(
    "fill"
  );
  expect(BROWSER_MAX_IMAGE_BYTES).toBeGreaterThan(0);
});
