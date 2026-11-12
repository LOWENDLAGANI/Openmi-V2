/**
 * How a preview is planned, without a sandbox or a database.
 *
 * Pure on purpose: the detection that decides what to run is the part most
 * likely to be wrong about a repository, so it is a function of a parsed
 * `package.json` and a list of lockfiles. The session module does the provider
 * work and the tests read these rules directly.
 *
 * The product decision this file encodes: a preview runs the repository's own
 * dev script. It does not guess a framework's CLI, and it does not start
 * something a `package.json` never asked for — an app that cannot say how it
 * runs gets a sentence saying so instead of a server that serves nothing.
 */

/** Where a dev server usually listens when the script does not say. */
export const PREVIEW_DEFAULT_PORT = 3000;

/** Vite's default, and the one framework-specific port worth knowing. */
export const PREVIEW_VITE_PORT = 5173;

/**
 * How long a start may wait for the port to answer.
 *
 * A first `next dev` installs nothing but still compiles on the first request,
 * so this is generous on purpose. The cap is the thing that keeps a preview
 * request from becoming a five-minute stall.
 */
export const PREVIEW_READY_TIMEOUT_MS = 90_000;

/** One readiness attempt per second, matching the command below. */
export const PREVIEW_POLL_INTERVAL_MS = 1_000;

/** Attempts the readiness command makes before it declares the port silent. */
export const PREVIEW_READY_ATTEMPTS = 45;

/** Log lines kept from a failed start, so the reader sees the real error. */
export const PREVIEW_MAX_LOG_LINES = 200;

/** One command in the row is a label, not an essay. */
export const PREVIEW_MAX_COMMAND_CHARS = 160;

/**
 * How long one start may serve before it is stopped.
 *
 * A preview holds compute on a box that is otherwise idle, and there is no
 * per-minute charge behind it yet. The cap is what keeps a forgotten tab from
 * holding a sandbox open until the 48-hour wipe; restarting costs two clicks.
 */
export const PREVIEW_MAX_MINUTES_PER_CHAT = 60;

/**
 * How long a preview nobody is looking at keeps running.
 *
 * The panel touches the row while it is open, so this measures attention rather
 * than traffic: a preview behind a closed tab is the one that needs stopping.
 */
export const PREVIEW_IDLE_STOP_MINUTES = 15;

export type PreviewFramework = "next" | "vite" | "node";

export type DevServerPlan = {
  /** The script to run, resolved through the repository's own package manager. */
  command: string;
  /** Where readiness is probed and the public host is built. */
  port: number;
  framework: PreviewFramework;
  /** Which `package.json` script this is, for the card. */
  script: "dev" | "start";
};

export type DevServerDetection =
  | { ok: true; plan: DevServerPlan }
  | { ok: false; reason: string };

export type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

type PackageJson = {
  scripts?: Record<string, unknown>;
};

function readPackageJson(value: unknown): PackageJson | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as PackageJson;
}

function scriptOf(pkg: PackageJson | null, name: string): string {
  const script = pkg?.scripts?.[name];
  return typeof script === "string" ? script.trim() : "";
}

/**
 * The lockfile decides the runner. One is enough: a repository that installed
 * with bun should be started with bun, because the binary layout it produced is
 * the one that will be on disk.
 */
export function packageManagerOf(paths: readonly string[]): PackageManager {
  if (paths.includes("bun.lock") || paths.includes("bun.lockb")) return "bun";
  if (paths.includes("pnpm-lock.yaml")) return "pnpm";
  if (paths.includes("yarn.lock")) return "yarn";
  return "npm";
}

/**
 * `--port 4000` (or `-p 4000`) in the script wins over any default.
 *
 * Read from the string the repository wrote, not from the framework's docs: a
 * script that pins a port means it, and a preview that probed 3000 anyway would
 * report a silent port as a broken app.
 */
export function portFromScript(script: string): number | null {
  const match = /(?:--port|-p)\s*[= ]\s*(\d{2,5})\b/.exec(script);
  if (!match) return null;

  const port = Number.parseInt(match[1], 10);
  return port > 0 && port <= 65_535 ? port : null;
}

function frameworkOf(script: string): PreviewFramework {
  if (/\bnext\b/.test(script)) return "next";
  if (/\bvite\b/.test(script)) return "vite";
  return "node";
}

function defaultPortFor(framework: PreviewFramework): number {
  return framework === "vite" ? PREVIEW_VITE_PORT : PREVIEW_DEFAULT_PORT;
}

/**
 * The command and port for this workspace, or the sentence that explains why
 * there is nothing to preview.
 *
 * `dev` first and `start` second: `next dev` is a development server with hot
 * reload, while `start` is a production server that needs a build first. A
 * repository that has only `start` is still previewable, and the card says
 * which one ran.
 */
export function detectDevServer(input: {
  paths: readonly string[];
  packageJson: unknown;
}): DevServerDetection {
  const pkg = readPackageJson(input.packageJson);

  if (!pkg) {
    return {
      ok: false,
      reason:
        "This workspace has no package.json, so there is no dev server to start.",
    };
  }

  const dev = scriptOf(pkg, "dev");
  const start = scriptOf(pkg, "start");
  const script = dev.length > 0 ? "dev" : start.length > 0 ? "start" : null;

  if (!script) {
    return {
      ok: false,
      reason:
        "This workspace has no dev or start script, so there is nothing to preview.",
    };
  }

  const body = script === "dev" ? dev : start;
  const framework = frameworkOf(body);
  const port = portFromScript(body) ?? defaultPortFor(framework);
  const manager = packageManagerOf(input.paths);

  // Vite listens on loopback unless it is told otherwise, which would make the
  // sandbox's public host answer nothing. Next binds every interface already,
  // and a script that names a host has already decided.
  const expose =
    framework === "vite" && !/--host\b/.test(body) ? " -- --host 0.0.0.0" : "";

  const command = `${manager} run ${script}${expose}`.slice(
    0,
    PREVIEW_MAX_COMMAND_CHARS
  );

  return { ok: true, plan: { command, port, framework, script } };
}

/**
 * Whether the preview surface exists on this deployment.
 *
 * On when a sandbox provider is configured, because a preview without one has
 * nothing to run in. An explicit `off` always wins, and turning execution off
 * takes the preview with it — there is no second way to reach a box.
 */
export function previewEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const flag = (env.OPENMI_PREVIEW ?? "").trim().toLowerCase();
  if (flag === "off" || flag === "false" || flag === "0") return false;

  const execution = (env.EXECUTION_ENABLED ?? "on").trim().toLowerCase();
  if (execution === "off" || execution === "false" || execution === "0") {
    return false;
  }

  return (env.E2B_API_KEY ?? "").trim().length > 0;
}

/**
 * One line the sandbox can run to answer "is anything listening?".
 *
 * Any HTTP status counts, including 500: a server that answers is a server that
 * started, and a compiler error is information the reader should see in the
 * frame rather than a reason to call the start failed.
 */
export function readinessCommand(
  port: number,
  attempts: number = PREVIEW_READY_ATTEMPTS
): string {
  const url = `http://127.0.0.1:${port}`;

  return [
    `for i in $(seq 1 ${attempts}); do`,
    // Node, not curl: any workspace this module can plan for has a
    // package.json and therefore a Node to run it, while `curl` is an image
    // detail that would turn a running server into a false failure.
    `  code=$(node -e 'const r=require("http").get(process.argv[1],res=>{console.log(res.statusCode);process.exit(0)});r.setTimeout(1000,()=>{r.destroy();console.log("000");process.exit(0)});r.on("error",()=>{console.log("000");process.exit(0)})' ${url} 2>/dev/null || echo 000)`,
    `  if [ -n "$code" ] && [ "$code" != "000" ]; then echo "ready $code"; exit 0; fi`,
    `  sleep 1`,
    `done`,
    `echo "nothing answered on port ${port}"`,
    `exit 1`,
  ].join("\n");
}

/**
 * The id of one preview process.
 *
 * Time-based like `chatProcessId`, with its own prefix, because a preview and a
 * shell's background process share one directory and must not be mistaken for
 * each other by a kill. The value is generated here and read back from the row;
 * it is never accepted from a request.
 */
export function previewProcessId(now: number = Date.now()): string {
  return `pv${Math.trunc(now)}`;
}

export function isPreviewProcessId(value: unknown): value is string {
  return typeof value === "string" && /^pv[1-9][0-9]{0,14}$/.test(value);
}

/** The states an expiry rule applies to: only a served preview can expire. */
export type ExpirablePreview = {
  state: "starting" | "ready" | "stopped" | "failed";
  startedAt: string | null;
  lastHitAt: string | null;
};

export type PreviewExpiry = "none" | "max-lifetime" | "idle";

function minutesSince(value: string | null, now: number): number | null {
  if (!value) return null;

  const at = Date.parse(value);
  if (!Number.isFinite(at)) return null;

  return (now - at) / 60_000;
}

/**
 * Whether a running preview has outlived a limit, and which one.
 *
 * Lifetime is checked before idleness: a preview that hit the hour is reported
 * as that, even if it was also untouched, because the hour is the limit a
 * reader can reason about. A missing timestamp is never an expiry — an unknown
 * age must not stop something that may have just started.
 */
export function previewExpiry(
  preview: ExpirablePreview,
  now: number = Date.now()
): PreviewExpiry {
  if (preview.state !== "ready") return "none";

  const lifetime = minutesSince(preview.startedAt, now);
  if (lifetime !== null && lifetime >= PREVIEW_MAX_MINUTES_PER_CHAT) {
    return "max-lifetime";
  }

  const idle = minutesSince(preview.lastHitAt ?? preview.startedAt, now);
  if (idle !== null && idle >= PREVIEW_IDLE_STOP_MINUTES) return "idle";

  return "none";
}
