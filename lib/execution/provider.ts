import "server-only";

import {
  AuthError,
  ExecTimeout,
  FleetFull,
  OrkestrError,
  PlanLimitError,
  RateLimitError,
  Sandbox,
  SandboxNotFound,
  SandboxNotReady,
  type NetworkMode,
  type SandboxSize,
} from "orkestr";

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
 * and a provider swap is one file. This file is that swap: Daytona in, orkestr
 * out, with every caller untouched.
 *
 * Three callers now: a verification run (create, use, destroy inside one
 * function), a mission (create once, `attachSandbox` on every later tick), and a
 * chat environment (create once per chat, parked when idle and woken on the next
 * message). The handle is identical, so the tools cannot tell which one they are
 * in; the factories are separate so a persistent box is never created by
 * forgetting a flag.
 *
 * Two vocabulary differences are worth knowing when reading this file:
 *
 *   - orkestr has no `stop`. `pause()` snapshots the box and releases compute,
 *     which is exactly the "stopped, disk kept" state the chat lifecycle wants,
 *     and `Sandbox.resume(id)` is the way back. So `stop`/`start` map onto
 *     pause/resume and nothing above this file changed.
 *   - orkestr has no archive tier and no "delete N minutes after stop". Its
 *     backstops are `onTimeout` (kill or park at the deadline) and the shared
 *     snapshot retention cap. The per-chat deadline is still enforced by our own
 *     sweep, which is the authority either way.
 */

export { executionConfigured };

/** The template a run boots from unless the operator pins another. */
export function executionTemplate(): string {
  const configured = process.env.EXECUTION_TEMPLATE?.trim() ?? "";
  return configured.length > 0 ? configured : DEFAULT_TEMPLATE;
}

/**
 * The machine size. `medium` is 2 vCPU / 4 GiB, the same shape the Dew rate in
 * `cost.ts` was computed on, so the default keeps the price honest.
 */
export function executionSize(): SandboxSize {
  const configured = (process.env.EXECUTION_SIZE ?? "").trim().toLowerCase();
  if (configured === "small" || configured === "large") return configured;
  return "medium";
}

/**
 * Egress.
 *
 * `restricted` is the default because an install is the whole point of a run and
 * `off` cannot reach a registry. Under `restricted`, `allowDomains` **replaces**
 * the platform's own default list, so the enumerated list in `commands.ts` is
 * sent with every create: the hosts an install may reach are the ones this
 * repository can read, not the platform's current defaults. `open` is for an
 * operator who wants arbitrary egress and understands why that is a different
 * product.
 */
export function executionNetworkMode(): NetworkMode {
  const configured = (process.env.EXEC_NETWORK_MODE ?? "").trim().toLowerCase();
  if (configured === "off" || configured === "open") return configured;
  return "restricted";
}

/** The one place the allowlist is attached, so `off`/`open` never send it. */
function allowDomainsOption(): { allowDomains?: string[] } {
  return executionNetworkMode() === "restricted"
    ? { allowDomains: [...EXEC_ALLOWED_DOMAINS] }
    : {};
}

/**
 * Credentials, per call.
 *
 * Passed explicitly rather than through `setDefaultClient`, so a process that
 * also runs the orkestr CLI or an agent never inherits a different client. The
 * token is `ORKESTR_API_KEY` and should be scoped to `sandboxes:read` and
 * `sandboxes:write`: a sandbox-scoped token cannot reach the rest of the account
 * if it leaks out of a stack trace.
 */
function clientOptions(): { apiKey?: string; baseUrl?: string } {
  const apiKey = process.env.ORKESTR_API_KEY?.trim() ?? "";
  const baseUrl = process.env.ORKESTR_API_URL?.trim() ?? "";

  return {
    ...(apiKey.length > 0 ? { apiKey } : {}),
    ...(baseUrl.length > 0 ? { baseUrl } : {}),
  };
}

function regionOption(): { region?: string } {
  const region = process.env.ORKESTR_REGION?.trim() ?? "";
  return region.length > 0 ? { region } : {};
}

/**
 * The workspace root every template has, and the parent of every path below.
 * Absolute because the file API writes only under a writable root and exec's
 * default directory is not ours to assume.
 */
const WORKSPACE_ROOT = "/workspace";

/**
 * The callers above name workspace paths the way a shell sees them — `openmi-workspace`,
 * `.openmi/env.json`, `.` — because that is what `mkdir` and `cd` take. The file
 * API wants an absolute path under a writable root, so this is the one place the
 * two vocabularies meet. An absolute path is passed through untouched.
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
 * orkestr caps `timeoutSeconds` by plan: 30 minutes on a key without a card,
 * 24 hours with one. Sending a two-day chat TTL to a free key fails the create
 * outright, so the ceiling is clamped to the paid maximum and the free-tier
 * constant is what a retry falls back to.
 */
function boundedTimeoutSeconds(seconds: number): number {
  return Math.min(
    EXEC_MAX_TIMEOUT_SECONDS,
    Math.max(60, Math.trunc(seconds))
  );
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
 * orkestr's statuses (`starting | running | pausing | paused | resuming |
 * terminated | failed`) read into the vocabulary the rest of the codebase was
 * written against. `terminated` becomes `deleted` because that is what it means
 * here: the disk is gone, so the row cannot be resumed.
 */
function normalizeState(value: unknown): SandboxState {
  const state = typeof value === "string" ? value.trim().toLowerCase() : "";

  switch (state) {
    case "starting":
    case "pausing":
    case "paused":
    case "resuming":
      return state;
    case "running":
      return "started";
    case "terminated":
    case "deleted":
      return "deleted";
    case "failed":
    case "error":
      return "error";
    case "creating":
    case "pending":
    case "pending_build":
    case "building_snapshot":
    case "pulling_snapshot":
    case "restoring":
      // Not ready yet, but not broken: the caller should wait, not destroy.
      return "pending";
    default:
      // A state this build has never heard of is never read as "gone".
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
  /**
   * Boots a paused box; a no-op for a running one. The timeout argument is kept
   * for the callers that pass one; orkestr's resume has no timeout knob, and the
   * wall-clock ceiling is `setTtl`.
   */
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

  const status =
    caught instanceof OrkestrError && typeof caught.statusCode === "number"
      ? caught.statusCode
      : typeof (caught as { statusCode?: unknown } | null)?.statusCode === "number"
        ? (caught as { statusCode: number }).statusCode
        : null;

  if (
    context === "attach" &&
    (caught instanceof SandboxNotFound ||
      status === 404 ||
      status === 410 ||
      /not found|no such sandbox|does not exist|already deleted|has been deleted|terminated/i.test(
        message
      ))
  ) {
    return new SandboxStartError("missing", message);
  }

  if (
    caught instanceof RateLimitError ||
    caught instanceof PlanLimitError ||
    caught instanceof FleetFull ||
    status === 429 ||
    status === 503 ||
    /429|rate.?limit|quota|too many requests|fleet is full|plan limit/i.test(message)
  ) {
    return new SandboxStartError("quota", message);
  }

  if (
    caught instanceof AuthError ||
    status === 401 ||
    status === 403 ||
    /401|403|unauthor|forbidden|api.?key|missing_?scope|scope/i.test(message)
  ) {
    return new SandboxStartError(
      "not_configured",
      `Orkestr rejected the configured key: ${message}`
    );
  }

  return new SandboxStartError("refused", message);
}

/**
 * The operations a run needs, over any sandbox — freshly created or reattached.
 * A mission reattaches on every tick; a verification run never does, and neither
 * difference is visible above this function.
 *
 * `current` is mutable on purpose: resuming may hand back a box on a different
 * host, so every later call has to go through the newest instance.
 */
function handleFor(initial: Sandbox, id: string): SandboxHandle {
  let current = initial;

  return {
    id,
    async exec(command, cwd, timeoutMs) {
      const startedAt = Date.now();
      const limitSeconds = Math.max(
        5,
        Math.ceil((timeoutMs ?? EXEC_STEP_TIMEOUT_MS) / 1000)
      );

      // The provider runs the string through a shell, which is why the callers
      // above can send `a && b` chains. No `bash -c` wrapper: the image is ours
      // to pick and the shell is the platform's.
      try {
        const response = await current.exec(command, {
          cwd: absolutePath(cwd ?? EXEC_WORKDIR),
          timeoutSeconds: limitSeconds,
        });

        const combined =
          response.stderr.length === 0
            ? response.stdout
            : response.stdout.length === 0 || response.stdout.endsWith("\n")
              ? `${response.stdout}${response.stderr}`
              : `${response.stdout}\n${response.stderr}`;

        const tail = tailOf(combined);

        return {
          command,
          exitCode: response.exitCode,
          output: tail.text,
          truncated: tail.truncated,
          durationMs:
            typeof response.durationMs === "number"
              ? response.durationMs
              : Date.now() - startedAt,
          timedOut: false,
        };
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : "The command could not run.";
        const timedOut =
          caught instanceof ExecTimeout || /timeout|timed out|deadline/i.test(message);

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
      await current.files.writeBytes(absolutePath(remotePath), new Uint8Array(bytes));
    },
    async readText(remotePath, maxBytes = 200_000) {
      // `stat` first: a 16 MiB read is a lot of base64 to throw away, and the
      // cap is a refusal, not a truncation.
      const stat = await current.files.stat(absolutePath(remotePath));

      if (!stat.exists) {
        throw new Error(`${remotePath} is not in the sandbox`);
      }

      if (stat.size > maxBytes) {
        throw new Error(
          `${remotePath} is ${stat.size} bytes, over the ${maxBytes} byte cap`
        );
      }

      return current.files.read(absolutePath(remotePath));
    },
    async readBytes(remotePath, maxBytes = 200_000) {
      const stat = await current.files.stat(absolutePath(remotePath));

      if (!stat.exists) {
        throw new Error(`${remotePath} is not in the sandbox`);
      }

      if (stat.size > maxBytes) {
        throw new Error(
          `${remotePath} is ${stat.size} bytes, over the ${maxBytes} byte cap`
        );
      }

      return Buffer.from(await current.files.readBytes(absolutePath(remotePath)));
    },
    async state() {
      try {
        await current.refresh();
      } catch {
        // A transient refresh failure reports the last known state. Turning it
        // into "missing" would make a healthy box look wipeable.
      }

      return normalizeState(current.status);
    },
    async start() {
      try {
        await current.refresh();

        const state = normalizeState(current.status);
        if (state === "started" || state === "starting" || state === "resuming") {
          return;
        }

        current = await Sandbox.resume(id, clientOptions());
      } catch (caught) {
        throw classifyStartError(caught, "attach");
      }
    },
    async stop() {
      try {
        await current.refresh();

        // Parked or gone already: the disk is where it was, which is the goal.
        const state = normalizeState(current.status);
        if (state === "paused" || state === "deleted") return;

        await current.pause();
      } catch (caught) {
        // A box that is mid-transition refuses the pause. The sweep retries on
        // the next pass; turning that into a failed stop would mark a healthy
        // row failed for no reason.
        if (caught instanceof SandboxNotReady) return;
        throw caught;
      }
    },
    async setTtl(minutes) {
      await current.setTimeout(boundedTimeoutSeconds(minutes * 60));
    },
    async destroy() {
      try {
        await current.terminate();
      } catch {
        // The deadline and the snapshot retention cap are the backstop. A failed
        // terminate must not fail the run that already has a real result
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
      size: executionSize(),
      network: executionNetworkMode(),
      timeoutSeconds: boundedTimeoutSeconds(ttl * 60),
      // One run, one box: the deadline terminates it. This is the whole of the
      // old `ephemeral: true` contract in orkestr's vocabulary.
      onTimeout: "kill",
      autoResume: false,
      metadata: { app: "openmi", run: runId, ...(options.labels ?? {}) },
      ...regionOption(),
      ...allowDomainsOption(),
      ...clientOptions(),
    });
  } catch (caught) {
    throw classifyStartError(caught, "create");
  }

  return handleFor(sandbox, sandbox.id);
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
   * Kept so the env contract does not change. orkestr has no archive tier: a
   * parked box holds a snapshot, not a disk, so there is nothing to archive and
   * the value is not sent.
   */
  archiveMinutes?: number;
};

/**
 * Creates the one long-lived sandbox a chat owns.
 *
 * It must survive going quiet: the box parks at the deadline instead of dying,
 * and the next command wakes it, so every installed package and every
 * uncommitted file is still there after a night of silence.
 *
 *   - `onTimeout: "pause"` snapshots at the wall-clock ceiling instead of
 *     terminating, which is the provider-side backstop for a crashed process;
 *   - `autoResume: true` means a message that arrives after the park does not
 *     have to know the box was parked — the first exec wakes it;
 *   - the ceiling itself is refreshed on open and close, and clamped to what the
 *     plan accepts.
 *
 * Deletion is ours: `deleteAfter` in the row plus the sweep. The provider's
 * backstop for a row nobody ever looks at again is the paused-snapshot retention
 * cap (7 days free, 30 with a card), not an interval we set.
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
  const requested = boundedTimeoutSeconds(ttl * 60);

  const create = (timeoutSeconds: number) =>
    Sandbox.create({
      template: executionTemplate(),
      size: executionSize(),
      network: executionNetworkMode(),
      timeoutSeconds,
      onTimeout: "pause",
      autoResume: true,
      metadata: {
        app: "openmi",
        kind: "chat",
        chat: options.chatId,
        owner: options.owner.slice(0, 8),
      },
      ...regionOption(),
      ...allowDomainsOption(),
      ...clientOptions(),
    });

  let sandbox: Sandbox;
  try {
    sandbox = await create(requested);
  } catch (caught) {
    const failure = classifyStartError(caught, "create");

    // A key without a card caps a sandbox at 30 minutes. Asking for two days is
    // still the right default for everyone else, so a plan refusal that names the
    // lifetime is retried once at the ceiling every tier accepts rather than
    // leaving chat workspaces unusable on a fresh account.
    if (failure.failure !== "quota" || requested <= EXEC_FREE_TIER_TIMEOUT_SECONDS) {
      throw failure;
    }

    try {
      sandbox = await create(EXEC_FREE_TIER_TIMEOUT_SECONDS);
    } catch (retried) {
      throw classifyStartError(retried, "create");
    }
  }

  return handleFor(sandbox, sandbox.id);
}

/**
 * Reattaches to a sandbox a previous tick created.
 *
 * This is what makes a mission longer than one request: the row holds the id,
 * the workspace lives in the sandbox, and every tick gets a fresh handle to the
 * same box. A sandbox terminated by its deadline makes this throw, which the
 * caller records as `sandbox_expired` rather than retrying forever.
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
    sandbox = await Sandbox.get(sandboxId, clientOptions());
  } catch (caught) {
    throw classifyStartError(caught, "attach");
  }

  return handleFor(sandbox, sandbox.id ?? sandboxId);
}

/**
 * Destroys a recorded sandbox and says what the provider confirmed.
 *
 * The ordinary `destroy()` swallows failures because a run that already has a
 * result must not fail on teardown. The sweep needs the opposite: a row is only
 * deleted once the provider says the box is gone (or never existed), so a failed
 * terminate stays visible and is retried instead of leaking a snapshot.
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
    sandbox = await Sandbox.get(sandboxId, clientOptions());
  } catch (caught) {
    const error = classifyStartError(caught, "attach");
    if (error.failure === "missing") return "missing";
    throw error;
  }

  try {
    await sandbox.terminate();
  } catch (caught) {
    const error = classifyStartError(caught, "attach");
    if (error.failure === "missing") return "missing";

    // A refused terminate can mean "already gone" as easily as "not now". Ask
    // the provider which one it is before failing a wipe that may have worked.
    try {
      await Sandbox.get(sandboxId, clientOptions());
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
    const found = await Sandbox.list({
      metadata: { app: "openmi", kind: "chat" },
      maxResults: limit,
      ...clientOptions(),
    });

    return found.slice(0, limit).map((sandbox) => ({
      id: sandbox.id,
      labels: sandbox.metadata ?? {},
      createdAt:
        sandbox.createdAt instanceof Date
          ? sandbox.createdAt.toISOString()
          : null,
    }));
  } catch (caught) {
    throw classifyStartError(caught, "attach");
  }
}
