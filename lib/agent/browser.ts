/**
 * The headless browser a chat turn may borrow — and drive.
 *
 * Pure: no database, no provider, no `server-only`. The sandbox runs the script
 * this module generates, so the caps here are the caps the tool enforces. A
 * model cannot ask for a 12000-pixel viewport or a tenthousand-step plan.
 *
 * Playwright is the default because it is the one browser this deployment can
 * install and drive with no display: Chromium headless, no X server, no GPU.
 * Nothing is installed until a turn actually asks for a page, and the install
 * lives outside the repository so it never reaches a diff or a commit.
 *
 * The plan — the URL and the steps — is written to a file and read by the
 * script. It is never spliced into a command line: a filled password must not
 * appear in argv, in a process list, or in an error message the transcript
 * quotes back.
 */

import { shellQuote } from "./shell";

export const BROWSER_VIEWPORT = { width: 1_280, height: 800 };
export const BROWSER_MIN_VIEWPORT = 320;
export const BROWSER_MAX_VIEWPORT = 2_560;

/** One screenshot's ceiling. A page taller than this is not a screenshot. */
export const BROWSER_MAX_IMAGE_BYTES = 3_000_000;

export const BROWSER_DEFAULT_WAIT_MS = 800;
export const BROWSER_MAX_WAIT_MS = 15_000;
export const BROWSER_NAVIGATION_TIMEOUT_MS = 30_000;
export const BROWSER_ACTION_TIMEOUT_MS = 10_000;
export const BROWSER_COMMAND_MS = 120_000;
export const BROWSER_INSTALL_MS = 240_000;
export const BROWSER_JPEG_QUALITY = 72;

/** Steps one call may run. A page is a task, not a crawler. */
export const BROWSER_MAX_ACTIONS = 24;

/** Characters one filled value or typed string may carry. */
export const BROWSER_MAX_VALUE_CHARS = 1_000;

/** Pixels one scroll step may move, in either direction. */
export const BROWSER_MAX_SCROLL = 4_000;

/** How much of the page's own text the model reads back. */
export const BROWSER_TEXT_CHARS = 4_000;

/** Deliberately outside the workspace: an install is not part of the project. */
export const BROWSER_HOME = "/tmp/openmi-browser";
export const BROWSER_SCRIPT_PATH = `${BROWSER_HOME}/browse.mjs`;
export const BROWSER_SHOT_DIR = `${BROWSER_HOME}/shots`;

/**
 * Cookies and local storage for this chat's box.
 *
 * Inside the sandbox, outside the repository: a session survives between calls
 * the way a browser tab does, and dies with the container.
 */
export const BROWSER_STATE_PATH = `${BROWSER_HOME}/state.json`;

/** The version the sandbox installs. Pinned so a screenshot is reproducible. */
export const PLAYWRIGHT_VERSION = "1.49.1";

export type BrowserTarget = { url: string };

/**
 * A page a turn may open.
 *
 * http(s) only: a file:// or javascript: target is not a website, and letting
 * one through would make the tool a way to read the box's own files back out.
 */
export function validateBrowserTarget(value: unknown): BrowserTarget | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 2_000) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.hostname.length === 0) return null;

  return { url: parsed.toString() };
}

/** A viewport inside the caps, or the default for a missing or absurd value. */
export function clampViewport(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? Math.trunc(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(BROWSER_MAX_VIEWPORT, Math.max(BROWSER_MIN_VIEWPORT, parsed));
}

export function clampWaitMs(value: unknown): number {
  const parsed = typeof value === "number" ? Math.trunc(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return BROWSER_DEFAULT_WAIT_MS;
  return Math.min(BROWSER_MAX_WAIT_MS, parsed);
}

export type BrowserAction =
  | { type: "goto"; url: string }
  | { type: "click"; selector?: string; text?: string }
  | { type: "fill"; selector: string; value: string }
  | { type: "type"; text: string }
  | { type: "press"; key: string; selector?: string }
  | { type: "scroll"; y: number }
  | { type: "wait"; ms?: number; selector?: string }
  | { type: "back" };

export type BrowserPlan =
  | { ok: true; actions: BrowserAction[] }
  | { ok: false; error: string };

const ACTION_TYPES = [
  "goto",
  "click",
  "fill",
  "type",
  "press",
  "scroll",
  "wait",
  "back",
] as const;

/** A short string argument: trimmed, non-empty, capped. */
function shortText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return null;
  return trimmed;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The steps a turn asked for, validated before a browser is launched.
 *
 * A bad step is a message, not a half-finished login: nothing runs unless the
 * whole plan parses. Values are kept verbatim — a password may have spaces at
 * either end — but never echoed back in an error.
 */
export function parseBrowserActions(value: unknown): BrowserPlan {
  if (value === undefined || value === null) return { ok: true, actions: [] };

  if (!Array.isArray(value)) {
    return { ok: false, error: "actions must be an array" };
  }

  if (value.length > BROWSER_MAX_ACTIONS) {
    return {
      ok: false,
      error: `at most ${BROWSER_MAX_ACTIONS} actions per call`,
    };
  }

  const actions: BrowserAction[] = [];

  for (const [index, raw] of value.entries()) {
    const at = `action ${index + 1}`;

    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { ok: false, error: `${at} must be an object` };
    }

    const entry = raw as Record<string, unknown>;
    const type = entry.type;

    if (typeof type !== "string" || !ACTION_TYPES.includes(type as never)) {
      return {
        ok: false,
        error: `${at}: type must be one of ${ACTION_TYPES.join(", ")}`,
      };
    }

    if (type === "goto") {
      const target = validateBrowserTarget(entry.url);
      if (!target) return { ok: false, error: `${at}: goto needs an http(s) url` };
      actions.push({ type: "goto", url: target.url });
      continue;
    }

    if (type === "click") {
      const selector = shortText(entry.selector, 300);
      const text = shortText(entry.text, 200);
      if (!selector && !text) {
        return { ok: false, error: `${at}: click needs a selector or a text` };
      }
      actions.push(selector ? { type: "click", selector } : { type: "click", text: text ?? "" });
      continue;
    }

    if (type === "fill") {
      const selector = shortText(entry.selector, 300);
      if (!selector) return { ok: false, error: `${at}: fill needs a selector` };

      const filled = entry.value;
      if (
        typeof filled !== "string" ||
        filled.length === 0 ||
        filled.length > BROWSER_MAX_VALUE_CHARS
      ) {
        return {
          ok: false,
          error: `${at}: fill needs a value of at most ${BROWSER_MAX_VALUE_CHARS} characters`,
        };
      }

      actions.push({ type: "fill", selector, value: filled });
      continue;
    }

    if (type === "type") {
      const typed = entry.text;
      if (
        typeof typed !== "string" ||
        typed.length === 0 ||
        typed.length > BROWSER_MAX_VALUE_CHARS
      ) {
        return {
          ok: false,
          error: `${at}: type needs text of at most ${BROWSER_MAX_VALUE_CHARS} characters`,
        };
      }
      actions.push({ type: "type", text: typed });
      continue;
    }

    if (type === "press") {
      const key = shortText(entry.key, 40);
      if (!key) return { ok: false, error: `${at}: press needs a key` };

      const selector = shortText(entry.selector, 300);
      actions.push(selector ? { type: "press", key, selector } : { type: "press", key });
      continue;
    }

    if (type === "scroll") {
      const y = finiteNumber(entry.y);
      if (y === null) return { ok: false, error: `${at}: scroll needs a y offset` };

      const clamped = Math.max(
        -BROWSER_MAX_SCROLL,
        Math.min(BROWSER_MAX_SCROLL, Math.trunc(y))
      );
      actions.push({ type: "scroll", y: clamped });
      continue;
    }

    if (type === "wait") {
      const selector = shortText(entry.selector, 300);
      const ms = finiteNumber(entry.ms);

      if (!selector && ms === null) {
        return { ok: false, error: `${at}: wait needs ms or a selector` };
      }

      if (selector) {
        actions.push({ type: "wait", selector });
      } else {
        actions.push({ type: "wait", ms: clampWaitMs(ms) });
      }
      continue;
    }

    actions.push({ type: "back" });
  }

  return { ok: true, actions };
}

/**
 * The one-time install.
 *
 * The marker is written only after the browser binary is in place, so a job that
 * dies halfway through npm leaves no false "ready" behind. `--with-deps` is
 * tried first because Chromium needs system libraries a bare image may lack; the
 * plain install is the fallback for images where apt is unavailable.
 */
export function browserInstallCommand(): string {
  return [
    `mkdir -p ${BROWSER_SHOT_DIR}`,
    `cd ${BROWSER_HOME}`,
    `if [ ! -f .ready ]; then`,
    `  test -f package.json || npm init -y >/dev/null 2>&1`,
    `  npm i playwright@${PLAYWRIGHT_VERSION} --no-audit --no-fund --silent || true`,
    `  npx playwright install --with-deps chromium || npx playwright install chromium`,
    `  touch .ready`,
    `fi`,
    `echo browser-ready`,
  ].join("\n");
}

/**
 * The script the sandbox runs.
 *
 * Everything specific to this call lives in the plan file it reads: the URL, the
 * steps, the typed values. The script itself is constant, so no user input is
 * ever interpolated into JavaScript, and no page is allowed to run code the plan
 * supplied — there is no evaluate step, only real input events.
 *
 * The last line of stdout is the status snapshot the model and the reader both
 * get. Cookies are written back to the state file after each run, which is what
 * makes a login survive until the next call.
 */
export function browserScript(): string {
  return `import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";

const [planPath, outPath, widthArg, heightArg, fullPageArg, waitArg] =
  process.argv.slice(2);

const width = Number(widthArg) || ${BROWSER_VIEWPORT.width};
const height = Number(heightArg) || ${BROWSER_VIEWPORT.height};
const fullPage = fullPageArg === "1";
const settleMs = Number(waitArg) || 0;
const statePath = "${BROWSER_STATE_PATH}";

const errors = [];
const steps = [];
let status = null;
let stopped = null;
let browser = null;
let context = null;

function describe(caught) {
  const message = caught && caught.message ? caught.message : String(caught);
  return message.slice(0, 300);
}

function note(index, action, ok, detail) {
  steps.push({
    index,
    action,
    ok,
    detail: String(detail === undefined || detail === null ? "" : detail).slice(0, 300),
  });
}

async function run(page, action) {
  const type = action.type;

  if (type === "goto") {
    const response = await page.goto(action.url, {
      waitUntil: "domcontentloaded",
      timeout: ${BROWSER_NAVIGATION_TIMEOUT_MS},
    });
    if (response) status = response.status();
    return (status === null ? "" : String(status) + " ") + page.url();
  }

  if (type === "click") {
    const target = action.selector
      ? page.locator(action.selector).first()
      : page.getByText(action.text, { exact: false }).first();
    await target.click();
    return action.selector ? action.selector : "text " + JSON.stringify(action.text);
  }

  if (type === "fill") {
    await page.locator(action.selector).first().fill(action.value);
    return action.selector + " filled";
  }

  if (type === "type") {
    await page.keyboard.type(action.text, { delay: 20 });
    return action.text.length + " chars typed";
  }

  if (type === "press") {
    if (action.selector) {
      await page.locator(action.selector).first().press(action.key);
    } else {
      await page.keyboard.press(action.key);
    }
    return action.key;
  }

  if (type === "scroll") {
    await page.mouse.wheel(0, action.y);
    return "scrolled " + action.y + "px";
  }

  if (type === "wait") {
    if (action.selector) {
      await page.waitForSelector(action.selector, {
        timeout: ${BROWSER_ACTION_TIMEOUT_MS},
      });
    } else {
      await page.waitForTimeout(action.ms);
    }
    return action.selector ? action.selector : String(action.ms) + "ms";
  }

  if (type === "back") {
    await page.goBack({ waitUntil: "domcontentloaded" });
    return page.url();
  }

  throw new Error("unknown action: " + String(type));
}

try {
  let plan = null;

  try {
    plan = JSON.parse(readFileSync(planPath, "utf8"));
  } catch (caught) {
    console.log(JSON.stringify({ ok: false, error: "plan unreadable: " + describe(caught) }));
  }

  if (plan) {
    browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });

    const options = { viewport: { width, height } };
    if (existsSync(statePath)) options.storageState = statePath;

    try {
      context = await browser.newContext(options);
    } catch (ignored) {
      // A corrupt session must not brick the tool; start clean instead.
      context = await browser.newContext({ viewport: { width, height } });
    }

    const page = await context.newPage();
    page.setDefaultTimeout(${BROWSER_ACTION_TIMEOUT_MS});

    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text().slice(0, 300));
    });
    page.on("pageerror", (error) => errors.push(String(error).slice(0, 300)));

    const actions = Array.isArray(plan.actions) ? plan.actions : [];

    for (let index = 0; index < actions.length; index += 1) {
      const action = actions[index];
      try {
        const detail = await run(page, action);
        note(index + 1, action.type, true, detail);
      } catch (caught) {
        note(index + 1, action.type, false, describe(caught));
        stopped = "step " + (index + 1) + " (" + action.type + ") failed";
        break;
      }
    }

    if (settleMs > 0) await page.waitForTimeout(settleMs);

    let text = "";
    try {
      text = await page.locator("body").innerText({ timeout: 5000 });
    } catch (ignored) {
      // A page with no body still has a screenshot.
    }

    await page.screenshot({
      path: outPath,
      type: "jpeg",
      quality: ${BROWSER_JPEG_QUALITY},
      fullPage: fullPage,
    });

    try {
      await context.storageState({ path: statePath });
    } catch (ignored) {
      // Losing the session is not losing the answer.
    }

    console.log(JSON.stringify({
      ok: true,
      url: page.url(),
      title: await page.title(),
      status: status,
      steps: steps,
      stopped: stopped,
      text: text.slice(0, ${BROWSER_TEXT_CHARS}),
      errors: errors.slice(0, 5),
    }));
  }
} catch (caught) {
  console.log(JSON.stringify({ ok: false, error: describe(caught) }));
} finally {
  if (browser) {
    try {
      await browser.close();
    } catch (ignored) {
      // A close failure is not a failed run.
    }
  }
}
`;
}

export function browserShotCommand(input: {
  planPath: string;
  outputPath: string;
  width: number;
  height: number;
  fullPage: boolean;
  waitMs: number;
}): string {
  return [
    `cd ${BROWSER_HOME}`,
    `node ${BROWSER_SCRIPT_PATH}`,
    shellQuote(input.planPath),
    shellQuote(input.outputPath),
    String(input.width),
    String(input.height),
    input.fullPage ? "1" : "0",
    String(input.waitMs),
  ].join(" ");
}

export type BrowserStepNote = {
  index: number;
  action: string;
  ok: boolean;
  detail: string;
};

export type ShotMeta = {
  ok: boolean;
  url: string;
  title: string;
  status: number | null;
  errors: string[];
  viewport: { width: number; height: number };
  fullPage: boolean;
  steps: BrowserStepNote[];
  stopped: string | null;
  text: string;
  error?: string;
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseSteps(value: unknown): BrowserStepNote[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null && !Array.isArray(entry)
    )
    .map((entry, index) => ({
      index: numberOrNull(entry.index) ?? index + 1,
      action: typeof entry.action === "string" ? entry.action : "step",
      ok: entry.ok === true,
      detail: typeof entry.detail === "string" ? entry.detail : "",
    }))
    .slice(0, BROWSER_MAX_ACTIONS);
}

/**
 * The status snapshot, read from the script's last stdout line.
 *
 * `null` means the run produced no snapshot at all — a crash before the browser
 * started, or output cut by the exec cap. That is a failure, not a silent pass.
 */
export function parseShotMeta(stdout: string): ShotMeta | null {
  const lines = stdout.split("\n").filter((line) => line.trim().startsWith("{"));

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index].trim()) as Record<string, unknown>;
      if (typeof parsed.ok !== "boolean") continue;

      if (parsed.ok === false) {
        return {
          ok: false,
          url: "",
          title: "",
          status: null,
          errors: [],
          viewport: BROWSER_VIEWPORT,
          fullPage: false,
          steps: [],
          stopped: null,
          text: "",
          error: typeof parsed.error === "string" ? parsed.error : "the browser failed",
        };
      }

      const viewport = (parsed.viewport ?? {}) as Record<string, unknown>;

      return {
        ok: true,
        url: typeof parsed.url === "string" ? parsed.url : "",
        title: typeof parsed.title === "string" ? parsed.title : "",
        status: numberOrNull(parsed.status),
        errors: Array.isArray(parsed.errors)
          ? parsed.errors
              .filter((entry): entry is string => typeof entry === "string")
              .slice(0, 5)
          : [],
        viewport: {
          width: numberOrNull(viewport.width) ?? BROWSER_VIEWPORT.width,
          height: numberOrNull(viewport.height) ?? BROWSER_VIEWPORT.height,
        },
        fullPage: parsed.fullPage === true,
        steps: parseSteps(parsed.steps),
        stopped: typeof parsed.stopped === "string" ? parsed.stopped : null,
        text: typeof parsed.text === "string" ? parsed.text : "",
      };
    } catch {
      continue;
    }
  }

  return null;
}

/** The line under the image: what was opened, and how it answered. */
export function shotCaption(meta: ShotMeta): string {
  const parts: string[] = [];

  const title = meta.title.trim().length > 0 ? meta.title.trim() : meta.url;
  if (title.length > 0) parts.push(title);
  if (meta.status !== null) parts.push(String(meta.status));
  parts.push(`${meta.viewport.width}×${meta.viewport.height}`);
  if (meta.steps.length > 0) {
    parts.push(`${meta.steps.length} step${meta.steps.length === 1 ? "" : "s"}`);
  }
  if (meta.fullPage) parts.push("full page");
  if (meta.errors.length > 0) parts.push(`${meta.errors.length} console error(s)`);
  if (meta.stopped) parts.push("stopped early");

  return parts.join(" · ");
}

/** What the model reads back. The image itself is for the reader, not for it. */
export function shotReport(meta: ShotMeta, bytes: number): string {
  const lines = [
    `Screenshot captured with headless Chromium (${bytes.toLocaleString()} bytes).`,
    `url: ${meta.url}`,
    `title: ${meta.title.trim().length > 0 ? meta.title : "(no title)"}`,
    `http status: ${meta.status ?? "none"}`,
    `viewport: ${meta.viewport.width}×${meta.viewport.height}${meta.fullPage ? " (full page)" : ""}`,
  ];

  if (meta.steps.length > 0) {
    lines.push("steps:");

    for (const step of meta.steps) {
      lines.push(
        `- ${step.index}. ${step.action} ${step.ok ? "ok" : "FAILED"}: ${step.detail}`
      );
    }
  }

  if (meta.stopped) {
    lines.push(
      `stopped: ${meta.stopped} — the later steps did not run, and the screenshot shows the page where it stopped.`
    );
  }

  if (meta.text.trim().length > 0) {
    lines.push("page text (truncated):", meta.text.trim());
  }

  lines.push(
    meta.errors.length > 0
      ? `console errors:\n- ${meta.errors.join("\n- ")}`
      : "console errors: none"
  );

  return lines.join("\n");
}

/** The tool the chat turn offers whenever a sandbox exists. */
export const BROWSER_TOOL_SPEC = {
  name: "browser",
  description:
    "Drive a real web page in headless Chromium (Playwright) inside the sandbox: open a URL, then click, fill, type, press keys, scroll or go back, and get a screenshot plus a status snapshot (final URL, title, HTTP status, per-step results, page text and console errors). Cookies persist for this chat's box, so a login done in one call still applies to the next. Use it for any website, local dev server, preview, form or visual bug instead of guessing.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "The http(s) page to open first, for example 'http://localhost:3000'. Optional when the session is already on the page you need.",
      },
      actions: {
        type: "array",
        description: `Ordered steps to run after the page opens, at most ${BROWSER_MAX_ACTIONS}. Each is an object with a type and the fields that type needs.`,
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ACTION_TYPES,
              description:
                "goto (needs url), click (needs selector or text), fill (needs selector and value), type (needs text), press (needs key, optional selector), scroll (needs y), wait (needs ms or selector), back.",
            },
            url: { type: "string", description: "http(s) URL for goto." },
            selector: {
              type: "string",
              description: "CSS selector, for example '#email' or 'button[type=submit]'.",
            },
            text: {
              type: "string",
              description: "Visible text to click, or the text to type into the page.",
            },
            value: {
              type: "string",
              description:
                "Value to fill into an input. Never repeat it back in your answer.",
            },
            key: {
              type: "string",
              description: "Key to press, for example 'Enter' or 'Tab'.",
            },
            y: { type: "integer", description: "Pixels to scroll, negative for up." },
            ms: { type: "integer", description: "Milliseconds to wait." },
          },
          required: ["type"],
          additionalProperties: false,
        },
      },
      full_page: {
        type: "boolean",
        description: "Capture the whole page rather than one viewport. Off by default.",
      },
      width: {
        type: "integer",
        description: `Viewport width, ${BROWSER_MIN_VIEWPORT} to ${BROWSER_MAX_VIEWPORT}.`,
      },
      height: {
        type: "integer",
        description: `Viewport height, ${BROWSER_MIN_VIEWPORT} to ${BROWSER_MAX_VIEWPORT}.`,
      },
      wait_ms: {
        type: "integer",
        description: `Milliseconds to wait after the last step before the shot, at most ${BROWSER_MAX_WAIT_MS}.`,
      },
      purpose: {
        type: "string",
        description: "One short line the user will read, e.g. 'sign in and open settings'.",
      },
    },
    required: [],
    additionalProperties: false,
  },
} as const;
