import { safeRepoPath } from "../../changesets";

import {
  MISSION_FOREGROUND_MS,
  MISSION_MAX_COMMANDS,
  MISSION_MAX_OUTPUT_BYTES,
  MISSION_WORKDIR,
  type MissionAutonomy,
} from "./budget";

/**
 * The mission tool surface.
 *
 * Unlike `lib/agent/tools.ts` this file has a tool whose parameter is a shell
 * string. That is the point of mission mode, and the guarantee is a different
 * one: the command runs in an ephemeral sandbox that holds no platform secret
 * and has no remote. The caps below are what keep one mission from becoming a
 * bill, not a filter on what the model may ask for.
 *
 * Everything here is pure: the loop executes the command, this module decides
 * whether the request is well-formed and what the result means.
 */

export type MissionToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export const MAX_MISSION_READ_BYTES = 200_000;
export const MAX_MISSION_WRITE_BYTES = 200_000;
export const MAX_MISSION_LIST = 300;
export const MAX_MISSION_SEARCH = 40;
export const MAX_FINISH_CHECKS = 12;
export const MAX_COMMAND_CHARS = 4_000;
export const MAX_PURPOSE_CHARS = 200;

export const MISSION_TOOL_SPECS: MissionToolDefinition[] = [
  {
    name: "run_command",
    description:
      "Run one shell command in the sandbox and wait for it. Returns the exit code and the tail of stdout/stderr. Use start_process for anything that does not exit.",
    parameters: {
      type: "object",
      properties: {
        purpose: {
          type: "string",
          description:
            "One short line the user will read, e.g. 'install dependencies' or 'confirm the failing test'.",
        },
        command: {
          type: "string",
          description: "The exact shell command. It runs as the sandbox user.",
        },
        cwd: {
          type: "string",
          description: `Working directory, relative to ${MISSION_WORKDIR}. Defaults to the workspace root.`,
        },
        timeout_ms: {
          type: "integer",
          description: `Optional ceiling for this command, at most ${MISSION_FOREGROUND_MS}.`,
        },
      },
      required: ["purpose", "command"],
      additionalProperties: false,
    },
  },
  {
    name: "read_file",
    description: "Read a text file from the workspace. Refuses files over 200,000 bytes.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative path." },
        offset: { type: "integer", description: "First line, 1-based." },
        limit: { type: "integer", description: "Lines to return, at most 400." },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "write_file",
    description:
      "Write one whole text file in the workspace, creating parent directories. The diff is collected from the workspace at the end.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative path." },
        content: { type: "string", description: "The complete file content." },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "list_files",
    description: `List workspace paths, skipping node_modules and .git. At most ${MAX_MISSION_LIST}.`,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Optional subdirectory, relative." },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "search_files",
    description: `Search workspace text for a literal string. At most ${MAX_MISSION_SEARCH} matches.`,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Literal text, at least two characters." },
        path: { type: "string", description: "Optional subdirectory, relative." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "start_process",
    description:
      "Start a command in the background (dev server, watcher) and get an id. Use read_process to see its output and kill_process to stop it.",
    parameters: {
      type: "object",
      properties: {
        purpose: { type: "string", description: "One short line the user will read." },
        command: { type: "string", description: "The exact shell command." },
        cwd: { type: "string", description: "Working directory, relative." },
      },
      required: ["purpose", "command"],
      additionalProperties: false,
    },
  },
  {
    name: "read_process",
    description: "Read the tail of a background process started with start_process.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "The id start_process returned, e.g. p3." },
        lines: { type: "integer", description: "Lines to read, at most 200." },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "kill_process",
    description: "Stop a background process started with start_process.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "The id start_process returned." } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "finish",
    description:
      "End the mission. The summary is shown to the user. Every check you list must name a command that was actually run, and must have exited 0 if you claim it passed.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "What you did, and what you actually observed. No claims beyond the recorded output.",
        },
        checks: {
          type: "array",
          maxItems: MAX_FINISH_CHECKS,
          items: {
            type: "object",
            properties: {
              command: { type: "string", description: "A command that was run in this mission." },
              expect_exit_zero: {
                type: "boolean",
                description: "True when you are claiming this command passed.",
              },
            },
            required: ["command"],
            additionalProperties: false,
          },
        },
      },
      required: ["summary"],
      additionalProperties: false,
    },
  },
];

export type MissionToolCall = { name: string; args: Record<string, unknown> };

export type FinishClaim = { command: string; expectExitZero: boolean; exitCode: number };

export type RecordedCommand = {
  seq: number;
  command: string;
  exit_code: number | null;
};

/**
 * A workspace path, or null.
 *
 * The rejection happens before any filesystem call. `safeRepoPath` refuses
 * traversal, absolute paths, URLs and `.git`; this adds the one case a mission
 * needs and a repository diff does not: a path that starts with the workspace
 * name, which would otherwise land in `workspace/openmi-workspace`.
 */
export function sanitiseWorkspacePath(value: unknown): string | null {
  const path = safeRepoPath(value);
  if (!path) return null;
  if (path === MISSION_WORKDIR || path.startsWith(`${MISSION_WORKDIR}/`)) return null;
  return path;
}

export function normaliseCommand(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** Runs `purpose` and `command` through the checks the loop enforces. */
export function validateCommandArguments(
  args: Record<string, unknown>
): { ok: true; purpose: string; command: string; cwd: string; timeoutMs: number } | { ok: false; error: string } {
  const purpose = typeof args.purpose === "string" ? args.purpose.trim() : "";
  const command = typeof args.command === "string" ? args.command : "";

  if (purpose.length === 0) {
    return { ok: false, error: "purpose is required: one short line saying why" };
  }

  if (purpose.length > MAX_PURPOSE_CHARS) {
    return { ok: false, error: `purpose is longer than ${MAX_PURPOSE_CHARS} characters` };
  }

  if (command.trim().length === 0) {
    return { ok: false, error: "command is required" };
  }

  if (command.length > MAX_COMMAND_CHARS) {
    return { ok: false, error: `command is longer than ${MAX_COMMAND_CHARS} characters` };
  }

  const cwd = sanitiseWorkspacePath(args.cwd ?? "");

  if (args.cwd !== undefined && !cwd) {
    return { ok: false, error: "cwd must be a directory inside the workspace" };
  }

  const requested = typeof args.timeout_ms === "number" ? args.timeout_ms : 0;
  const timeoutMs =
    requested > 0 ? Math.min(MISSION_FOREGROUND_MS, Math.trunc(requested)) : MISSION_FOREGROUND_MS;

  return { ok: true, purpose, command, cwd: cwd ?? "", timeoutMs };
}

/**
 * `finish` is a request, not a truth.
 *
 * A claim is accepted only when a command row with the same text exists, and
 * when a claim of success matches a row whose exit code really is 0. A model
 * that skipped the check gets a typed refusal it can act on, and the ledger
 * still holds only what happened.
 */
export function validateFinish(
  args: Record<string, unknown>,
  recorded: RecordedCommand[]
): { ok: true; summary: string; checks: FinishClaim[] } | { ok: false; error: string } {
  const summary = typeof args.summary === "string" ? args.summary.trim() : "";

  if (summary.length === 0) return { ok: false, error: "summary is required" };
  if (summary.length > 2_000) {
    return { ok: false, error: "summary must be 2,000 characters or fewer" };
  }

  const raw = args.checks;
  if (raw === undefined) return { ok: true, summary, checks: [] };

  if (!Array.isArray(raw)) return { ok: false, error: "checks must be an array" };
  if (raw.length > MAX_FINISH_CHECKS) {
    return { ok: false, error: `at most ${MAX_FINISH_CHECKS} checks` };
  }

  const byCommand = new Map(
    recorded.map((row) => [normaliseCommand(row.command), row])
  );

  const checks: FinishClaim[] = [];

  for (const [index, entry] of raw.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, error: `check ${index + 1} is not an object` };
    }

    const record = entry as Record<string, unknown>;
    const command = typeof record.command === "string" ? record.command.trim() : "";

    if (command.length === 0) {
      return { ok: false, error: `check ${index + 1} needs a command` };
    }

    const row = byCommand.get(normaliseCommand(command));

    if (!row) {
      return {
        ok: false,
        error: `check ${index + 1} names a command that was not run in this mission: ${command}`,
      };
    }

    const expectExitZero = record.expect_exit_zero !== false;

    if (expectExitZero && row.exit_code !== 0) {
      return {
        ok: false,
        error: `check ${index + 1} claims ${command} passed, but it exited ${
          row.exit_code ?? "without a code"
        }`,
      };
    }

    checks.push({ command, expectExitZero, exitCode: row.exit_code ?? -1 });
  }

  return { ok: true, summary, checks };
}

/** Keeps the tail of one command's output, and says when it cut. */
export function missionOutput(
  text: string,
  maxBytes: number = MISSION_MAX_OUTPUT_BYTES
): { text: string; truncated: boolean } {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= maxBytes) return { text, truncated: false };

  const buffer = Buffer.from(text, "utf8");
  const tail = buffer.subarray(buffer.length - maxBytes).toString("utf8");
  const firstBreak = tail.indexOf("\n");
  const cleaned = firstBreak >= 0 && firstBreak < 200 ? tail.slice(firstBreak + 1) : tail;

  return {
    text: `… output truncated; showing the last ${maxBytes} bytes\n${cleaned}`,
    truncated: true,
  };
}

/**
 * Single-quote a string for `bash -c` or `/bin/sh -c`, so a command stays one
 * argument. The result is safe inside a quoted shell command string.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function processLogPath(id: string): string {
  return `${MISSION_WORKDIR}/.openmi/process-${id}.log`;
}

export function processPidPath(id: string): string {
  return `${MISSION_WORKDIR}/.openmi/process-${id}.pid`;
}

export function isProcessId(value: unknown): value is string {
  return typeof value === "string" && /^p[1-9][0-9]{0,2}$/.test(value);
}

export function describeMissionToolCall(
  name: string,
  args: Record<string, unknown>
): string {
  if (name === "run_command" && typeof args.command === "string") {
    return args.command.length > 120 ? `${args.command.slice(0, 120)}…` : args.command;
  }
  if (name === "read_file" || name === "write_file") {
    return typeof args.path === "string" ? `${name} ${args.path}` : name;
  }
  if (name === "search_files" && typeof args.query === "string") {
    return `search ${JSON.stringify(args.query)}`;
  }
  if (name === "finish") return "finish";
  return name;
}

/** Plan mode offers no writing tool; the loop enforces the rest. */
export function toolsForAutonomy(autonomy: MissionAutonomy): MissionToolDefinition[] {
  if (autonomy === "plan") {
    return MISSION_TOOL_SPECS.filter(
      (tool) => tool.name !== "write_file" && tool.name !== "start_process"
    );
  }

  return MISSION_TOOL_SPECS;
}

export { MISSION_MAX_COMMANDS };
