import "server-only";

import { Daytona } from "@daytona/sdk";

import { executionConfigured } from "@/lib/env";

import {
  DEFAULT_SNAPSHOT,
  EXEC_ALLOWED_DOMAINS,
  EXEC_STEP_TIMEOUT_MS,
  EXEC_WORKDIR,
  shellQuote,
  tailOf,
} from "./commands";
import { EXEC_MAX_MINUTES } from "./cost";

/**
 * The only module that imports the sandbox SDK.
 *
 * Everything the product knows about Daytona goes through the small handle
 * below, so the rest of the codebase is testable without the dependency and a
 * provider swap is one file. Nothing here is reached unless
 * `executionConfigured()` is true, which is what keeps a deployment without a
 * key behaving exactly as it did before this phase existed.
 *
 * Two callers now: a verification run (create, use, destroy inside one
 * function) and a mission (create once, `attachSandbox` on every later tick).
 * The handle is identical, so the tools cannot tell which one they are in.
 */

export { executionConfigured };

export function executionSnapshot(): string {
  const configured = process.env.EXECUTION_SNAPSHOT?.trim() ?? "";
  return configured.length > 0 ? configured : DEFAULT_SNAPSHOT;
}

/**
 * Whether the sandbox should carry an explicit egress list.
 *
 * Off by default, on purpose. A restricted Daytona organisation rejects the
 * field outright — "network access is restricted and cannot be overridden at
 * the sandbox level" — and the rejection fails every run before a sandbox
 * exists. So the org's own network policy is the default authority, and the
 * enumerated list in `commands.ts` is only sent to a tier that accepts it.
 */
function networkAllowlistEnabled(): boolean {
  const flag = (process.env.EXEC_NETWORK_ALLOWLIST ?? "").trim().toLowerCase();
  return flag === "on" || flag === "true" || flag === "1";
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

export type SandboxHandle = {
  id: string;
  exec: (command: string, cwd?: string, timeoutMs?: number) => Promise<ExecResult>;
  upload: (bytes: Buffer, remotePath: string) => Promise<void>;
  /** Reads a workspace file for a repair pass or a mission's diff. */
  readText: (remotePath: string, maxBytes?: number) => Promise<string>;
  destroy: () => Promise<void>;
};

export class SandboxStartError extends Error {
  readonly failure: "quota" | "refused" | "not_configured";

  constructor(failure: "quota" | "refused" | "not_configured", message: string) {
    super(message);
    this.failure = failure;
    this.name = "SandboxStartError";
  }
}

/** A Daytona failure, classified once so callers do not parse English. */
function classifyStartError(caught: unknown): SandboxStartError {
  const message =
    caught instanceof Error ? caught.message : "The sandbox could not be started.";

  if (/429|rate.?limit|quota|too many requests/i.test(message)) {
    return new SandboxStartError("quota", message);
  }

  if (/401|403|unauthor|forbidden|api.?key/i.test(message)) {
    return new SandboxStartError(
      "not_configured",
      `Daytona rejected the configured key: ${message}`
    );
  }

  return new SandboxStartError("refused", message);
}

function client(): Daytona {
  return new Daytona({
    apiKey: process.env.DAYTONA_API_KEY?.trim(),
    ...(process.env.DAYTONA_API_URL?.trim()
      ? { apiUrl: process.env.DAYTONA_API_URL.trim() }
      : {}),
    ...(process.env.DAYTONA_TARGET?.trim()
      ? { target: process.env.DAYTONA_TARGET.trim() }
      : {}),
  });
}

type RemoteSandbox = Awaited<ReturnType<Daytona["get"]>>;

/**
 * The three operations a run needs, over any sandbox — freshly created or
 * reattached. A mission reattaches on every tick; a verification run never
 * does, and neither difference is visible above this function.
 */
function handleFor(sandbox: RemoteSandbox, id: string): SandboxHandle {
  return {
    id,
    async exec(command, cwd, timeoutMs) {
      const startedAt = Date.now();
      const limitSeconds = Math.max(
        5,
        Math.ceil((timeoutMs ?? EXEC_STEP_TIMEOUT_MS) / 1000)
      );

      // The sandbox runtime must have a working shell. Some Daytona images only
      // ship /bin/sh, so run everything through bash when present and fall back
      // to the POSIX shell instead of depending on the template default.
      const shellCommand = `bash -c ${shellQuote(command)}`;
      const fallbackCommand = `/bin/sh -c ${shellQuote(command)}`;

      let response: unknown;
      let timedOut = false;

      try {
        response = await sandbox.process.executeCommand(
          shellCommand,
          cwd ?? EXEC_WORKDIR,
          undefined,
          limitSeconds
        );
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : "The command could not run.";

        // If bash is missing, the sandbox template likely has no /usr/bin/zsh
        // either, so retry through the POSIX shell before reporting failure.
        if (/no such file|not found/i.test(message) && command !== fallbackCommand) {
          try {
            response = await sandbox.process.executeCommand(
              fallbackCommand,
              cwd ?? EXEC_WORKDIR,
              undefined,
              limitSeconds
            );
          } catch (fallbackCaught) {
            const fallbackMessage =
              fallbackCaught instanceof Error
                ? fallbackCaught.message
                : "The command could not run.";

            return {
              command,
              exitCode: 1,
              output: `Shell unavailable: ${message}\nFallback shell also failed: ${fallbackMessage}`,
              truncated: false,
              durationMs: Date.now() - startedAt,
              timedOut: false,
            };
          }
        } else {
          timedOut = /timeout|timed out|deadline/i.test(message);

          return {
            command,
            exitCode: timedOut ? 124 : 1,
            output: message,
            truncated: false,
            durationMs: Date.now() - startedAt,
            timedOut,
          };
        }
      }

      const wire = response as {
        exitCode?: number;
        exit_code?: number;
        result?: string;
        output?: string;
      };

      const raw = wire?.result ?? wire?.output ?? "";
      const exitCode =
        typeof wire?.exitCode === "number"
          ? wire.exitCode
          : typeof wire?.exit_code === "number"
            ? wire.exit_code
            : 1;

      const tail = tailOf(String(raw));

      return {
        command,
        exitCode,
        output: tail.text,
        truncated: tail.truncated,
        durationMs: Date.now() - startedAt,
        timedOut,
      };
    },
    async upload(bytes, remotePath) {
      await sandbox.fs.uploadFile(bytes, remotePath);
    },
    async readText(remotePath, maxBytes = 200_000) {
      const bytes = await sandbox.fs.downloadFile(remotePath);

      if (bytes.byteLength > maxBytes) {
        throw new Error(
          `${remotePath} is ${bytes.byteLength} bytes, over the ${maxBytes} byte cap`
        );
      }

      return bytes.toString("utf8");
    },
    async destroy() {
      try {
        await sandbox.delete(60, true);
      } catch {
        // The TTL is the backstop. A failed delete must not fail the run that
        // already has a real result recorded.
      }
    },
  };
}

/**
 * Creates one ephemeral sandbox. The TTL is not decoration: if this process
 * dies, the sandbox still destroys itself, so a crash cannot bill an account
 * indefinitely.
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

  let sandbox: RemoteSandbox;
  try {
    sandbox = await client().create(
      {
        snapshot: executionSnapshot(),
        ephemeral: true,
        ttlMinutes: ttl,
        autoStopInterval: Math.max(2, ttl - 3),
        labels: { app: "openmi", run: runId, ...(options.labels ?? {}) },
        public: false,
        // Sent only when the operator says this organisation is on a tier that
        // accepts it. A restricted org refuses the whole create call when the
        // field is present, so sending it unconditionally turned every run into
        // "The sandbox refused the request".
        ...(networkAllowlistEnabled()
          ? { domainAllowList: EXEC_ALLOWED_DOMAINS.join(",") }
          : {}),
      },
      { timeout: 120 }
    );
  } catch (caught) {
    throw classifyStartError(caught);
  }

  return handleFor(sandbox, String(sandbox.id));
}

/**
 * Reattaches to a sandbox a previous tick created.
 *
 * This is what makes a mission longer than one request: the row holds the id,
 * the workspace lives in the sandbox, and every tick gets a fresh handle to the
 * same box. A sandbox removed by its TTL makes this throw, which the caller
 * records as `sandbox_expired` rather than retrying forever.
 */
export async function attachSandbox(sandboxId: string): Promise<SandboxHandle> {
  if (!executionConfigured()) {
    throw new SandboxStartError(
      "not_configured",
      "Execution is not configured on this deployment."
    );
  }

  let sandbox: RemoteSandbox;
  try {
    sandbox = await client().get(sandboxId);
  } catch (caught) {
    throw classifyStartError(caught);
  }

  return handleFor(sandbox, String(sandbox.id ?? sandboxId));
}
