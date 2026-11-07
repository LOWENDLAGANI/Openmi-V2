import "server-only";

import {
  AuthenticationError,
  CommandExitError,
  NotFoundError,
  RateLimitError,
  Sandbox,
  TimeoutError,
} from "e2b";

import { executionConfigured } from "@/lib/env";

import {
  DEFAULT_TEMPLATE,
  EXEC_ALLOWED_DOMAINS,
  EXEC_FREE_TIER_TIMEOUT_SECONDS,
  EXEC_MAX_TIMEOUT_SECONDS,
  EXEC_STEP_TIMEOUT_MS,
  EXEC_WORKDIR,
  tailOf,
} from "./commands";
import { EXEC_MAX_MINUTES } from "./cost";

/**
 * The only module that imports the sandbox SDK.
 *
 * Everything the product knows about the sandbox provider goes through the small
 * handle below, so the rest of the codebase is testable without the dependency
 * and a provider swap is one file. This file is that swap: Daytona, then
 * orkestr, now E2B, with every caller untouched.
 *
 * Three callers: a verification run (create, use, destroy inside one function),
 * a mission (create once, `attachSandbox` on every later tick), and a chat
 * environment (create once per chat, parked when idle and woken on the next
 * message). The handle is identical, so the tools cannot tell which one they are
 * in; the factories are separate so a persistent box is never created by
 * forgetting a flag.
 *
 * Two differences from the previous provider are worth knowing when reading
 * this file:
 *
 *   - E2B's sandbox user is `user` with `/home/user` as the home and the default
 *     working directory, not `/workspace`. The file API writes as that user, so
 *     `/workspace` is not writable and must not be used as the root. Everything
 *     relative resolves against `/home/user`, and the repository lives in
 *     `/home/user/openmi-workspace`.
 *   - `pause()` snapshots the box and releases compute; `Sandbox.connect(id)`
 *     resumes a paused box automatically. So `stop`/`start` map onto
 *     pause/connect and nothing above this file changed. Deletion is `kill()`.
 */

export { executionConfigured };

/** The template a run boots from unless the operator pins another. */
export function executionTemplate(): string {
  const configured = process.env.EXECUTION_TEMPLATE?.trim() ?? "";
  return configured.length > 0 ? configured : DEFAULT_TEMPLATE;
}

/**
 * E2B sandbox egress.
 *
 * `restricted` is the default because an install is the whole point of a run.
 * The current provider SDK requires the restrict+deny pairing below, so
 * `restricted` sends an allowAllOut policy rather than the old hostname allowlist.
 * `off` takes the sandbox off the network entirely, and `open` leaves the
 * provider's defaults in place.
 */
export function executionNetworkMode(): "off" | "restricted" | "open" {
  const configured = (process.env.EXEC_NETWORK_MODE ?? "").trim().toLowerCase();
  if (configured === "off" || configured === "open") return configured;
  return "restricted";
}

/** The one place the allowlist is attached, so `off`/`open` never send it. */
type RestrictedNetwork = {
  network: { allowOut: string[]; denyOut: string[] };
};

function networkOption():
  | RestrictedNetwork
  | { allowInternetAccess: false }
  | Record<string, never> {
  const mode = executionNetworkMode();

  if (mode === "off") return { allowInternetAccess: false };
  if (mode === "restricted") {
    const allow: string[] = [...EXEC_ALLOWED_DOMAINS];
    // The CIDR itself, not the SDK's `ALL_TRAFFIC` name: a deny list takes
    // CIDRs and bare IPs only, and the literal name is rejected with a 400.
    const deny: string[] = ["0.0.0.0/0"];
    return { network: { allowOut: allow, denyOut: deny } };
  }

  return {};
}

/**
 * Credentials, per call.
 *
 * Passed explicitly rather than relying on the process-wide default, so a
 * process that also uses the E2B CLI or another agent never inherits a
 * different client. The key is `E2B_API_KEY` and should be a team key scoped to
 * sandboxes: a leaked key with no project scope cannot deploy anything.
 */
function clientOptions(): { apiKey?: string } {
  const apiKey = process.env.E2B_API_KEY?.trim() ?? "";
  return apiKey.length > 0 ? { apiKey } : {};
}

/**
 * The home directory of the sandbox user, and the only place the file API
 * writes. E2B runs commands as `user` with this as the default cwd; a
 * repository under `/workspace` would fail to be written at all.
 */
const WORKSPACE_ROOT = "/home/user";

/**
 * The callers above name workspace paths the way a shell sees them — `openmi-workspace`,
 * `.openmi/env.json`, `.` — because that is what `mkdir` and `cd` take. The file
 * API wants an absolute path, so this is the one place the two vocabularies
 * meet. An absolute path is passed through untouched.
 */
function absolutePath(path: string): string {
  const trimmed = path.trim();

  if (trimmed.startsWith("/")) return trimmed;
  if (trimmed.length === 0 || trimmed === ".") return WORKSPACE_ROOT;

  return `${WORKSPACE_ROOT}/${trimmed.replace(/^\.\//, "")}`;
}

/**
 * A wall-clock ceiling the provider will accept.
 *
 * E2B caps a sandbox at 24 hours on a plan with a card and one hour without
 * one, so the ceiling is clamped to the paid maximum and the free-tier
 * constant is what a retry falls back to.
 */
function boundedTimeoutMs(seconds: number): number {
  const clamped = Math.min(EXEC_MAX_TIMEOUT_SECONDS, Math.max(60, Math.trunc(seconds)));
  return clamped * 1000;
}

export type ExecResult = {
  command: string;
  exitCode: number;
  output: string;
  truncated: boolean;
  durationMs: number;
  /** True only when the provider said the command hit its limit. */
  timedOut: boolean;
};

/**
 * A lifecycle state, normalised from the provider's own vocabulary.
 *
 * `unknown` is deliberate: a provider that adds a state must not make the
 * resolver guess that the box is gone. Every consumer treats unknown as "do not
 * destroy, look again" rather than as a stop or a wipe.
 */
export type SandboxState =
  | "pending"
  | "starting"
  | "started"
  | "stopping"
  | "stopped"
  | "pausing"
  | "paused"
  | "resuming"
  | "archiving"
  | "archived"
  | "restoring"
  | "deleting"
  | "deleted"
  | "error"
  | "unknown";

/**
 * E2B reports `running` or `paused`. A box that is unreachable or gone surfaces
 * as an error from `getInfo` rather than as a state, so `unknown` is what the
 * caller sees between the two and neither is read as "gone".
 */
function normalizeState(value: unknown): SandboxState {
  const state = typeof value === "string" ? value.trim().toLowerCase() : "";

  switch (state) {
    case "running":
    case "started":
      return "started";
    case "paused":
      return "paused";
    case "pausing":
    case "resuming":
      return state;
    case "deleted":
    case "terminated":
      return "deleted";
    case "error":
    case "failed":
      return "error";
    case "starting":
    case "pending":
    case "creating":
      return "pending";
    default:
      return "unknown";
  }
}

export type SandboxHandle = {
  id: string;
  exec: (command: string, cwd?: string, timeoutMs?: number) => Promise<ExecResult>;
  upload: (bytes: Buffer, remotePath: string) => Promise<void>;
  /** Reads a workspace file for a repair pass or a mission's diff. */
  readText: (remotePath: string, maxBytes?: number) => Promise<string>;
  /** Binary read, for a screenshot the text reader would mangle. */
  readBytes: (remotePath: string, maxBytes?: number) => Promise<Buffer>;
  /** The provider's current state, refreshed rather than remembered. */
  state: () => Promise<SandboxState>;
  /** Boots a paused box; a no-op for a running one. */
  start: (timeoutSeconds?: number) => Promise<void>;
  /** Releases compute and keeps the filesystem. Never deletes. */
  stop: (options?: { force?: boolean }) => Promise<void>;
  /** Refreshes the wall-clock ceiling. Persistent boxes only. */
  setTtl: (minutes: number) => Promise<void>;
  destroy: () => Promise<void>;
};

export class SandboxStartError extends Error {
  readonly failure: "quota" | "refused" | "not_configured" | "missing";

  constructor(
    failure: "quota" | "refused" | "not_configured" | "missing",
    message: string
  ) {
    super(message);
    this.failure = failure;
    this.name = "SandboxStartError";
  }
}

function statusOf(caught: unknown): number | null {
  if (caught instanceof NotFoundError) return 404;
  if (caught instanceof AuthenticationError) return 401;
  if (caught instanceof RateLimitError) return 429;
  if (caught instanceof TimeoutError) return 408;

  const status = (caught as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === "number" ? status : null;
}

/**
 * A provider failure, classified once so callers do not parse English.
 *
 * `context` matters for exactly one case: a 404 while attaching means the box
 * is gone and the chat can reseed, while a 404 while creating usually means the
 * template is missing and retrying would fail the same way. Those are different
 * answers, so they get different codes.
 */
function classifyStartError(
  caught: unknown,
  context: "create" | "attach" = "create"
): SandboxStartError {
  const message =
    caught instanceof Error ? caught.message : "The sandbox could not be started.";

  const status = statusOf(caught);

  if (
    context === "attach" &&
    (caught instanceof NotFoundError ||
      status === 404 ||
      status === 410 ||
      /not found|no such sandbox|does not exist|already deleted|has been deleted|terminated|not running/i.test(
        message
      ))
  ) {
    return new SandboxStartError("missing", message);
  }

  if (
    caught instanceof RateLimitError ||
    status === 429 ||
    status === 503 ||
    /429|rate.?limit|quota|too many requests|plan limit|concurr/i.test(message)
  ) {
    return new SandboxStartError("quota", message);
  }

  if (
    caught instanceof AuthenticationError ||
    status === 401 ||
    status === 403 ||
    /401|403|unauthor|forbidden|api.?key|invalid key/i.test(message)
  ) {
    return new SandboxStartError(
      "not_configured",
      `E2B rejected the configured key: ${message}`
    );
  }

  return new SandboxStartError("refused", message);
}

/**
 * The operations a run needs, over any sandbox — freshly created or reattached.
 * A mission reattaches on every tick; a verification run never does, and neither
 * difference is visible above this function.
 *
 * `current` is mutable on purpose: connecting may hand back a box on a different
 * host, so every later call has to go through the newest instance.
 */
function handleFor(initial: Sandbox, id: string): SandboxHandle {
  let current = initial;

  const combined = (stdout: string, stderr: string): string =>
    stderr.length === 0
      ? stdout
      : stdout.length === 0 || stdout.endsWith("\n")
        ? `${stdout}${stderr}`
        : `${stdout}\n${stderr}`;

  return {
    id,
    async exec(command, cwd, timeoutMs) {
      const startedAt = Date.now();
      const limitMs = Math.max(5_000, timeoutMs ?? EXEC_STEP_TIMEOUT_MS);

      const result = (exitCode: number, stdout: string, stderr: string): ExecResult => {
        const tail = tailOf(combined(stdout, stderr));

        return {
          command,
          exitCode,
          output: tail.text,
          truncated: tail.truncated,
          durationMs: Date.now() - startedAt,
          timedOut: false,
        };
      };

      // E2B runs the string through a shell, which is why the callers above can
      // send `a && b` chains. No `bash -c` wrapper: the image is ours to pick
      // and the shell is the platform's.
      try {
        const response = await current.commands.run(command, {
          cwd: absolutePath(cwd ?? EXEC_WORKDIR),
          timeoutMs: limitMs,
        });

        return result(response.exitCode, response.stdout ?? "", response.stderr ?? "");
      } catch (caught) {
        // A non-zero exit is information, not a provider failure: the card and
        // the model both need the code and the output, not an exception.
        if (caught instanceof CommandExitError) {
          return result(caught.exitCode, caught.stdout ?? "", caught.stderr ?? "");
        }

        const message =
          caught instanceof Error ? caught.message : "The command could not run.";
        const timedOut =
          caught instanceof TimeoutError || /timeout|timed out|deadline/i.test(message);

        return {
          command,
          exitCode: timedOut ? 124 : 1,
          output: message,
          truncated: false,
          durationMs: Date.now() - startedAt,
          timedOut,
        };
      }
    },
    async upload(bytes, remotePath) {
      await current.files.write(absolutePath(remotePath), new Uint8Array(bytes));
    },
    async readText(remotePath, maxBytes = 200_000) {
      const text = await current.files.read(absolutePath(remotePath));

      // The read itself is already done; the cap is a refusal, not a
      // truncation, so a caller never mistakes a cut file for a whole one.
      if (Buffer.byteLength(text, "utf8") > maxBytes) {
        throw new Error(`${remotePath} is over the ${maxBytes} byte cap`);
      }

      return text;
    },
    async readBytes(remotePath, maxBytes = 200_000) {
      const bytes = await current.files.read(absolutePath(remotePath), {
        format: "bytes",
      });

      if (bytes.byteLength > maxBytes) {
        throw new Error(`${remotePath} is over the ${maxBytes} byte cap`);
      }

      return Buffer.from(bytes);
    },
    async state() {
      try {
        const info = await current.getInfo();
        return normalizeState(info.state);
      } catch {
        // A transient failure reports the last known state. Turning it into
        // "missing" would make a healthy box look wipeable.
        return "unknown";
      }
    },
    async start() {
      try {
        const info = await current.getInfo().catch(() => null);

        if (info && info.state === "running") return;

        // Connecting to a paused sandbox resumes it, so a message that arrives
        // after a night of silence does not have to know it was parked.
        current = await Sandbox.connect(id, clientOptions());
      } catch (caught) {
        throw classifyStartError(caught, "attach");
      }
    },
    async stop() {
      try {
        const info = await current.getInfo().catch(() => null);

        // Parked or gone already: the disk is where it was, which is the goal.
        if (info && info.state === "paused") return;

        await current.pause();
      } catch {
        // A plan that cannot snapshot refuses the pause; the wall-clock timeout
        // is then the backstop. A failed stop must not mark a healthy row
        // failed, and must never be turned into a delete.
      }
    },
    async setTtl(minutes) {
      await current.setTimeout(Math.max(60_000, Math.round(minutes * 60_000)));
    },
    async destroy() {
      try {
        await current.kill();
      } catch {
        // The deadline and the provider's own retention are the backstop. A
        // failed kill must not fail the run that already has a real result
        // recorded.
      }
    },
  };
}

/**
 * Creates one ephemeral sandbox. The deadline is not decoration: `onTimeout:
 * "kill"` means a process that dies mid-run cannot bill an account indefinitely.
 */
export async function createSandbox(
  runId: string,
  options: { ttlMinutes?: number; labels?: Record<string, string> } = {}
): Promise<SandboxHandle> {
  if (!executionConfigured()) {
    throw new SandboxStartError(
      "not_configured",
      "Execution is not configured on this deployment."
    );
  }

  const ttl = Math.max(5, Math.trunc(options.ttlMinutes ?? EXEC_MAX_MINUTES + 5));

  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.create({
      template: executionTemplate(),
      timeoutMs: boundedTimeoutMs(ttl * 60),
      // One run, one box: the deadline kills it.
      lifecycle: { onTimeout: "kill", autoResume: false },
      metadata: { app: "openmi", run: runId, ...(options.labels ?? {}) },
      ...networkOption(),
      ...clientOptions(),
    });
  } catch (caught) {
    throw classifyStartError(caught, "create");
  }

  return handleFor(sandbox, sandbox.sandboxId);
}

export type ChatSandboxOptions = {
  chatId: string;
  owner: string;
  /** Wall-clock ceiling, refreshed on activity. 48 h plus slack. */
  ttlMinutes: number;
  /** The chat's own inactivity deadline. Enforced by the sweep, not the provider. */
  autoDeleteMinutes: number;
  /** Stop after this many idle minutes. */
  idleMinutes: number;
  /**
   * Kept so the env contract does not change. E2B has no archive tier: a parked
   * box holds a snapshot, not a disk, so there is nothing to archive and the
   * value is not sent.
   */
  archiveMinutes?: number;
};

/**
 * Creates the one long-lived sandbox a chat owns.
 *
 * It must survive going quiet: the box pauses at the deadline instead of dying,
 * and the next command resumes it, so every installed package and every
 * uncommitted file is still there after a night of silence.
 *
 *   - `onTimeout: "pause"` snapshots at the wall-clock ceiling instead of
 *     killing, which is the provider-side backstop for a crashed process;
 *   - `autoResume: true` means a message that arrives after the park is woken
 *     by the first command, without the caller doing anything;
 *   - the ceiling itself is refreshed on open and close, and clamped to what the
 *     plan accepts.
 *
 * Deletion is ours: `deleteAfter` in the row plus the sweep. The provider's
 * backstop for a row nobody looks at again is its paused-snapshot retention,
 * not an interval we set.
 */
export async function createChatSandbox(
  options: ChatSandboxOptions
): Promise<SandboxHandle> {
  if (!executionConfigured()) {
    throw new SandboxStartError(
      "not_configured",
      "Execution is not configured on this deployment."
    );
  }

  if (options.chatId.trim().length === 0 || options.owner.trim().length === 0) {
    throw new SandboxStartError(
      "refused",
      "A chat sandbox needs a chat and an owner."
    );
  }

  const idle = Math.max(1, Math.trunc(options.idleMinutes));
  const autoDelete = Math.max(idle + 1, Math.trunc(options.autoDeleteMinutes));
  const ttl = Math.max(autoDelete, Math.trunc(options.ttlMinutes));

  const create = (timeoutMs: number) =>
    Sandbox.create({
      template: executionTemplate(),
      timeoutMs,
      lifecycle: { onTimeout: "pause", autoResume: true },
      metadata: {
        app: "openmi",
        kind: "chat",
        chat: options.chatId,
        owner: options.owner.slice(0, 8),
      },
      ...networkOption(),
      ...clientOptions(),
    });

  const requested = boundedTimeoutMs(ttl * 60);

  let sandbox: Sandbox;
  try {
    sandbox = await create(requested);
  } catch (caught) {
    const failure = classifyStartError(caught, "create");
    const freeCeiling = EXEC_FREE_TIER_TIMEOUT_SECONDS * 1000;

    // A Hobby key caps a sandbox at one hour. Asking for two days is still the
    // right default for everyone else, so a refusal that is not an auth failure
    // is retried once at the ceiling every tier accepts rather than leaving
    // chat workspaces unusable on a fresh account.
    if (
      failure.failure === "not_configured" ||
      requested <= freeCeiling
    ) {
      throw failure;
    }

    try {
      sandbox = await create(freeCeiling);
    } catch (retried) {
      throw classifyStartError(retried, "create");
    }
  }

  return handleFor(sandbox, sandbox.sandboxId);
}

/**
 * Reattaches to a sandbox a previous tick created.
 *
 * This is what makes a mission longer than one request: the row holds the id,
 * the workspace lives in the sandbox, and every tick gets a fresh handle to the
 * same box. Connecting also resumes a paused box, so a resumed tick needs no
 * special case.
 */
export async function attachSandbox(sandboxId: string): Promise<SandboxHandle> {
  if (!executionConfigured()) {
    throw new SandboxStartError(
      "not_configured",
      "Execution is not configured on this deployment."
    );
  }

  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.connect(sandboxId, clientOptions());
  } catch (caught) {
    throw classifyStartError(caught, "attach");
  }

  return handleFor(sandbox, sandbox.sandboxId ?? sandboxId);
}

/**
 * Destroys a recorded sandbox and says what the provider confirmed.
 *
 * The ordinary `destroy()` swallows failures because a run that already has a
 * result must not fail on teardown. The sweep needs the opposite: a row is only
 * deleted once the provider says the box is gone (or never existed), so a failed
 * kill stays visible and is retried instead of leaking a snapshot.
 */
export async function destroySandboxConfirmed(
  sandboxId: string
): Promise<"deleted" | "missing"> {
  if (!executionConfigured()) {
    throw new SandboxStartError(
      "not_configured",
      "Execution is not configured on this deployment."
    );
  }

  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.connect(sandboxId, clientOptions());
  } catch (caught) {
    const error = classifyStartError(caught, "attach");
    if (error.failure === "missing") return "missing";
    throw error;
  }

  try {
    await sandbox.kill();
  } catch (caught) {
    const error = classifyStartError(caught, "attach");
    if (error.failure === "missing") return "missing";

    // A refused kill can mean "already gone" as easily as "not now". Ask the
    // provider which one it is before failing a wipe that may have worked.
    try {
      await Sandbox.getInfo(sandboxId, clientOptions());
    } catch (again) {
      if (classifyStartError(again, "attach").failure === "missing") {
        return "missing";
      }
    }

    throw error;
  }

  return "deleted";
}

export type RemoteSandboxSummary = {
  id: string;
  labels: Record<string, string>;
  createdAt: string | null;
};

/**
 * Lists provider sandboxes that carry the chat metadata.
 *
 * This is the ledger that survives a crash before the row insert: the metadata
 * is written at create time, so a box with no row can still be found and
 * destroyed. Bounded because reconciliation is a safety net, not a scan of the
 * whole account's estate.
 */
export async function listChatSandboxes(
  limit = 200
): Promise<RemoteSandboxSummary[]> {
  if (!executionConfigured()) {
    throw new SandboxStartError(
      "not_configured",
      "Execution is not configured on this deployment."
    );
  }

  try {
    const paginator = Sandbox.list({
      query: { metadata: { app: "openmi", kind: "chat" } },
      limit,
      ...clientOptions(),
    });

    const found = paginator.hasNext ? await paginator.nextItems() : [];

    return found.slice(0, limit).map((sandbox) => ({
      id: sandbox.sandboxId,
      labels: sandbox.metadata ?? {},
      createdAt:
        sandbox.startedAt instanceof Date
          ? sandbox.startedAt.toISOString()
          : null,
    }));
  } catch (caught) {
    throw classifyStartError(caught, "attach");
  }
}
