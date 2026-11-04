import "server-only";

import { Daytona } from "@daytona/sdk";

import {
  DEFAULT_SNAPSHOT,
  EXEC_ALLOWED_DOMAINS,
  EXEC_STEP_TIMEOUT_MS,
  EXEC_WORKDIR,
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
 */

/**
 * Off only when the operator says so, or when there is no key. A deployment
 * that adds `DAYTONA_API_KEY` gets execution; a deployment that wants it back
 * off sets `EXECUTION_ENABLED=off` without removing the key.
 */
export function executionConfigured(): boolean {
  const key = process.env.DAYTONA_API_KEY?.trim() ?? "";
  if (key.length === 0) return false;

  const flag = (process.env.EXECUTION_ENABLED ?? "on").trim().toLowerCase();
  return flag !== "off" && flag !== "false" && flag !== "0";
}

export function executionSnapshot(): string {
  const configured = process.env.EXECUTION_SNAPSHOT?.trim() ?? "";
  return configured.length > 0 ? configured : DEFAULT_SNAPSHOT;
}

export type ExecResult = {
  command: string;
  exitCode: number;
  output: string;
  truncated: boolean;
  durationMs: number;
};

export type SandboxHandle = {
  id: string;
  exec: (command: string, cwd?: string) => Promise<ExecResult>;
  upload: (bytes: Buffer, remotePath: string) => Promise<void>;
  /** Reads a workspace file for a repair pass. Bounded before it is decoded. */
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

/**
 * Creates one ephemeral sandbox and hands back the three operations a run
 * needs. The TTL is not decoration: if this process dies, the sandbox still
 * destroys itself, so a crash cannot bill an account indefinitely.
 */
export async function createSandbox(runId: string): Promise<SandboxHandle> {
  if (!executionConfigured()) {
    throw new SandboxStartError(
      "not_configured",
      "Execution is not configured on this deployment."
    );
  }

  const daytona = new Daytona({
    apiKey: process.env.DAYTONA_API_KEY?.trim(),
    ...(process.env.DAYTONA_API_URL?.trim()
      ? { apiUrl: process.env.DAYTONA_API_URL.trim() }
      : {}),
    ...(process.env.DAYTONA_TARGET?.trim()
      ? { target: process.env.DAYTONA_TARGET.trim() }
      : {}),
  });

  let sandbox: Awaited<ReturnType<typeof daytona.create>>;
  try {
    sandbox = await daytona.create(
      {
        snapshot: executionSnapshot(),
        ephemeral: true,
        ttlMinutes: EXEC_MAX_MINUTES + 5,
        autoStopInterval: EXEC_MAX_MINUTES + 2,
        labels: { app: "openmi", run: runId },
        public: false,
        // Deny-by-default. On a Tier 1/2 organisation Daytona's own policy
        // wins, which is a documented limit rather than a silent difference.
        domainAllowList: EXEC_ALLOWED_DOMAINS.join(","),
      },
      { timeout: 120 }
    );
  } catch (caught) {
    throw classifyStartError(caught);
  }

  const id = String(sandbox.id);

  return {
    id,
    async exec(command, cwd) {
      const startedAt = Date.now();

      const response = (await sandbox.process.executeCommand(
        command,
        cwd ?? EXEC_WORKDIR,
        undefined,
        Math.max(5, Math.ceil(EXEC_STEP_TIMEOUT_MS / 1000))
      )) as unknown as {
        exitCode?: number;
        exit_code?: number;
        result?: string;
        output?: string;
      };

      const raw = response?.result ?? response?.output ?? "";
      const exitCode =
        typeof response?.exitCode === "number"
          ? response.exitCode
          : typeof response?.exit_code === "number"
            ? response.exit_code
            : 1;

      const tail = tailOf(String(raw));

      return {
        command,
        exitCode,
        output: tail.text,
        truncated: tail.truncated,
        durationMs: Date.now() - startedAt,
      };
    },
    async upload(bytes, remotePath) {
      await sandbox.fs.uploadFile(bytes, remotePath);
    },
    async readText(remotePath, maxBytes = 200_000) {
      const bytes = await sandbox.fs.downloadFile(remotePath);

      if (bytes.byteLength > maxBytes) {
        throw new Error(`${remotePath} is ${bytes.byteLength} bytes, over the ${maxBytes} byte cap`);
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
