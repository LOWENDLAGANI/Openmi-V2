/**
 * The headless browser a chat turn may borrow.
 *
 * Pure: no database, no provider, no `server-only`. The sandbox runs the script
 * this module generates, so the caps here are the caps the tool enforces — a
 * model cannot ask for a 12000-pixel screenshot and call it a viewport.
 *
 * Playwright is the default because it is the one browser this deployment can
 * install and drive with no display: Chromium headless, no X server, no GPU.
 * Nothing is installed until a turn actually asks for a page, and the install
 * lives outside the repository so it never reaches a diff or a commit.
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
export const BROWSER_COMMAND_MS = 90_000;
export const BROWSER_INSTALL_MS = 240_000;
export const BROWSER_JPEG_QUALITY = 72;

/** Deliberately outside the workspace: an install is not part of the project. */
export const BROWSER_HOME = "/tmp/openmi-browser";
export const BROWSER_SCRIPT_PATH = `${BROWSER_HOME}/shot.mjs`;
export const BROWSER_SHOT_DIR = `${BROWSER_HOME}/shots`;

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
 * Arguments arrive through argv, never through this source: a URL is data, and
 * a URL interpolated into JavaScript is how a screenshot tool becomes a command
 * runner. The last line of stdout is the status snapshot the model and the
 * reader both get.
 */
export function browserScript(): string {
  return `import { chromium } from "playwright";

const [url, out, width, height, fullPage, waitMs] = process.argv.slice(2);
const errors = [];
let browser = null;

try {
  browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext({
    viewport: { width: Number(width), height: Number(height) },
  });
  const page = await context.newPage();

  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text().slice(0, 300));
  });
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 300)));

  let status = null;
  let navigationError = null;

  try {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: ${BROWSER_NAVIGATION_TIMEOUT_MS},
    });
    status = response ? response.status() : null;
  } catch (caught) {
    navigationError = String(caught && caught.message ? caught.message : caught).slice(0, 300);
  }

  const wait = Number(waitMs) || 0;
  if (wait > 0) await page.waitForTimeout(wait);

  await page.screenshot({
    path: out,
    type: "jpeg",
    quality: ${BROWSER_JPEG_QUALITY},
    fullPage: fullPage === "1",
  });

  console.log(JSON.stringify({
    ok: true,
    url: page.url(),
    title: await page.title(),
    status: status,
    navigationError: navigationError,
    errors: errors.slice(0, 5),
    viewport: { width: Number(width), height: Number(height) },
    fullPage: fullPage === "1",
  }));
} catch (caught) {
  console.log(JSON.stringify({
    ok: false,
    error: String(caught && caught.message ? caught.message : caught).slice(0, 500),
  }));
} finally {
  if (browser) {
    try {
      await browser.close();
    } catch (ignored) {
      // A close failure is not a failed screenshot.
    }
  }
}
`;
}

export function browserShotCommand(input: {
  url: string;
  outputPath: string;
  width: number;
  height: number;
  fullPage: boolean;
  waitMs: number;
}): string {
  return [
    `cd ${BROWSER_HOME}`,
    `node ${BROWSER_SCRIPT_PATH}`,
    shellQuote(input.url),
    shellQuote(input.outputPath),
    String(input.width),
    String(input.height),
    input.fullPage ? "1" : "0",
    String(input.waitMs),
  ].join(" ");
}

export type ShotMeta = {
  ok: boolean;
  url: string;
  title: string;
  status: number | null;
  navigationError: string | null;
  errors: string[];
  viewport: { width: number; height: number };
  fullPage: boolean;
  error?: string;
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
          navigationError: null,
          errors: [],
          viewport: BROWSER_VIEWPORT,
          fullPage: false,
          error: typeof parsed.error === "string" ? parsed.error : "the browser failed",
        };
      }

      const viewport = (parsed.viewport ?? {}) as Record<string, unknown>;

      return {
        ok: true,
        url: typeof parsed.url === "string" ? parsed.url : "",
        title: typeof parsed.title === "string" ? parsed.title : "",
        status: numberOrNull(parsed.status),
        navigationError:
          typeof parsed.navigationError === "string" ? parsed.navigationError : null,
        errors: Array.isArray(parsed.errors)
          ? parsed.errors.filter((entry): entry is string => typeof entry === "string").slice(0, 5)
          : [],
        viewport: {
          width: numberOrNull(viewport.width) ?? BROWSER_VIEWPORT.width,
          height: numberOrNull(viewport.height) ?? BROWSER_VIEWPORT.height,
        },
        fullPage: parsed.fullPage === true,
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
  if (meta.fullPage) parts.push("full page");
  if (meta.errors.length > 0) parts.push(`${meta.errors.length} console error(s)`);
  if (meta.navigationError) parts.push("navigation failed");

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

  if (meta.navigationError) lines.push(`navigation error: ${meta.navigationError}`);

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
    "Open a web page in headless Chromium (Playwright) inside the sandbox and return a screenshot plus a status snapshot: final URL, title, HTTP status and console errors. Use it whenever the user asks what a site, a local dev server or a preview looks like, or reports a visual bug. Chromium installs itself on first use, so the first call can take a minute.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The http(s) URL to open, for example 'http://localhost:3000'.",
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
        description: `Milliseconds to wait after load before the shot, at most ${BROWSER_MAX_WAIT_MS}.`,
      },
      purpose: {
        type: "string",
        description: "One short line the user will read, e.g. 'check the sign-in page'.",
      },
    },
    required: ["url"],
    additionalProperties: false,
  },
} as const;
