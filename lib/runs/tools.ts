import type { AgentToolDefinition } from "@/lib/providers";
import type { SandboxHandle } from "@/lib/execution/provider";

import {
  RUN_COMMAND_MAX_CHARS,
  RUN_COMMAND_TIMEOUT_MS,
  RUN_EDIT_MAX_BYTES,
  RUN_LIST_MAX,
  RUN_READ_MAX_BYTES,
  RUN_READ_MAX_LINES,
  RUN_SEARCH_MAX_HITS,
  RUN_TOOL_OUTPUT_BYTES,
  RUN_WRITE_MAX_CHARS,
} from "./limits";
import { previewText, redactSecrets, tailBytes } from "./redact";

/**
 * The six tools a run may call.
 *
 * Everything happens in the run's own sandbox, in one workspace directory. The
 * names are deliberately plain — read, write, edit, search, command, todo —
 * because each one is a single observable action the transcript can report,
 * rather than a menu of variants a model has to choose between.
 *
 * All caps are enforced here rather than in the prompt: a model that asks for a
 * four-megabyte file gets a typed refusal it can read, not a quiet truncation.
 */

export const RUN_WORKDIR = "work";

export type RunToolName =
  | "read_file"
  | "write_file"
  | "edit_file"
  | "search_code"
  | "run_command"
  | "todo";

export const RUN_TOOL_NAMES: readonly RunToolName[] = [
  "read_file",
  "write_file",
  "edit_file",
  "search_code",
  "run_command",
  "todo",
];

export const RUN_TOOL_SPECS: AgentToolDefinition[] = [
  {
    name: "read_file",
    description:
      "Read a text file from the workspace with line numbers. Paths are relative to the workspace root. Refuses files over 200,000 bytes and caps a read at 400 lines; use offset to continue.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative path, e.g. src/app/page.tsx." },
        offset: { type: "integer", description: "First line to read, 1-based. Default 1." },
        limit: { type: "integer", description: "How many lines to read. Default 400, max 400." },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "write_file",
    description:
      "Create or replace one whole text file in the workspace, creating parent directories. Files over 200,000 characters are refused. Nothing is committed or pushed from inside the sandbox.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative path." },
        content: { type: "string", description: "The complete new contents of the file." },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "edit_file",
    description:
      "Replace one exact, unique piece of text in a file. The find string must appear exactly once, or the edit is refused rather than applied to the wrong place. Use write_file to replace a whole file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative path." },
        find: { type: "string", description: "The exact text to replace. Must occur exactly once." },
        replace: { type: "string", description: "The text that takes its place." },
      },
      required: ["path", "find", "replace"],
      additionalProperties: false,
    },
  },
  {
    name: "search_code",
    description:
      "Search the workspace with ripgrep. Returns matching paths with line numbers, at most 40 hits. Omit path to search everywhere.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Literal text to look for, at least two characters." },
        path: { type: "string", description: "Optional directory or file to search." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "run_command",
    description:
      "Run one shell command in the workspace and wait for it. Returns the exit code, duration and the tail of stdout/stderr. Commands that touch loopback, private or cloud metadata addresses are refused. Give a short purpose so the reader can follow what is happening.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command to run." },
        purpose: { type: "string", description: "A few words describing why, shown in the UI." },
        cwd: { type: "string", description: "Optional workspace-relative working directory." },
        timeout_ms: { type: "integer", description: "Timeout, up to 120000 ms." },
      },
      required: ["command", "purpose"],
      additionalProperties: false,
    },
  },
  {
    name: "todo",
    description:
      "Record or update the run's plan as a short list of steps. This is the plan the reader sees; it changes nothing in the workspace.",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          maxItems: 20,
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              status: { type: "string", enum: ["pending", "in_progress", "done"] },
            },
            required: ["text", "status"],
            additionalProperties: false,
          },
        },
      },
      required: ["items"],
      additionalProperties: false,
    },
  },
];

export function isRunTool(name: string): name is RunToolName {
  return (RUN_TOOL_NAMES as readonly string[]).includes(name);
}

/**
 * A path inside the workspace, or null.
 *
 * Rejects absolute paths, traversal, backslashes and URLs before anything
 * reaches a shell: `../../etc/passwd` is not a file the run may read, and it
 * must not become a string a shell is asked about.
 */
export function safeRunPath(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim().replace(/^\.\//, "");

  if (trimmed.length === 0 || trimmed.length > 400) return null;
  if (trimmed.startsWith("/") || trimmed.startsWith("~")) return null;
  if (trimmed.includes("..") || trimmed.includes("\\")) return null;
  if (trimmed.includes("://")) return null;
  if (trimmed.includes("\0")) return null;
  if (!/^[A-Za-z0-9._@+/ -]+$/.test(trimmed)) return null;

  return trimmed;
}

/**
 * Addresses a run may not reach from inside its sandbox.
 *
 * The sandbox owns the network policy — this is a second layer for the one tool
 * that takes a shell string, so a command that names the cloud metadata service
 * is refused before it runs. A hostname is not resolved here: the network
 * policy and the provider are what stop a DNS name that points inward.
 */
const INTERNAL_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "cloud metadata address", pattern: /\b169\.254\.169\.254\b/ },
  { label: "link-local address", pattern: /\b169\.254\.\d{1,3}\.\d{1,3}\b/ },
  { label: "loopback address", pattern: /\b(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost)\b/i },
  { label: "private address", pattern: /\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/ },
  { label: "private address", pattern: /\b172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/ },
  { label: "unix socket", pattern: /--unix-socket/i },
  {
    label: "host network file",
    pattern: /\/proc\/(?:(?:[0-9]+|self|thread-self)\/)?(?:environ|cmdline|net|mounts)/,
  },
];

export function internalTargetIn(command: string): string | null {
  for (const { label, pattern } of INTERNAL_PATTERNS) {
    if (pattern.test(command)) return label;
  }
  return null;
}

export type RunToolResult = {
  ok: boolean;
  isError: boolean;
  /** The text the model reads back. Redacted and capped. */
  text: string;
  /** A short line for the event stream. */
  preview: string;
};

function failure(message: string): RunToolResult {
  const text = redactSecrets(message);
  return { ok: false, isError: true, text, preview: previewText(text, 400) };
}

function success(text: string, preview?: string): RunToolResult {
  const clean = redactSecrets(text);
  return {
    ok: true,
    isError: false,
    text: clean,
    preview: preview ?? previewText(clean, 400),
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function onlyKeys(args: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(args).every((key) => allowed.includes(key));
}

function positiveInt(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(value)));
}

async function exec(
  sandbox: SandboxHandle,
  command: string,
  cwd: string,
  timeoutMs: number
) {
  return sandbox.exec(command, cwd, timeoutMs);
}

export async function executeRunTool(input: {
  name: string;
  args: Record<string, unknown> | null;
  sandbox: SandboxHandle;
}): Promise<RunToolResult> {
  const { name, args, sandbox } = input;

  if (!isRunTool(name)) return failure(`unknown tool: ${name}`);
  if (args === null) return failure("bad-input: arguments were not a JSON object");

  if (name === "todo") {
    if (!onlyKeys(args, ["items"])) return failure("bad-input: unexpected argument");
    if (!Array.isArray(args.items) || args.items.length === 0) {
      return failure("bad-input: items must be a non-empty array");
    }

    const items = args.items.slice(0, 20).map((item) => {
      const value = (item ?? {}) as Record<string, unknown>;
      const text = typeof value.text === "string" ? value.text.trim() : "";
      const status =
        value.status === "done" || value.status === "in_progress"
          ? value.status
          : "pending";
      return { text: text.slice(0, 300), status };
    });

    const rendered = items
      .map((item) => `${item.status === "done" ? "[x]" : item.status === "in_progress" ? "[~]" : "[ ]"} ${item.text}`)
      .join("\n");

    const done = items.filter((item) => item.status === "done").length;

    return success(
      `Plan updated: ${done}/${items.length} done.\n${rendered}`,
      `plan ${done}/${items.length}`
    );
  }

  if (name === "read_file") {
    if (!onlyKeys(args, ["path", "offset", "limit"])) {
      return failure("bad-input: unexpected argument");
    }

    const path = safeRunPath(args.path);
    if (!path) return failure("bad-input: path must be a file inside the workspace");

    const offset = positiveInt(args.offset, 1, 1_000_000);
    const limit = positiveInt(args.limit, RUN_READ_MAX_LINES, RUN_READ_MAX_LINES);

    try {
      const text = await sandbox.readText(`${RUN_WORKDIR}/${path}`, RUN_READ_MAX_BYTES);
      const lines = text.split("\n");
      const slice = lines.slice(offset - 1, offset - 1 + limit);

      if (slice.length === 0) {
        return success(`${path} has ${lines.length} line(s); there is nothing at line ${offset}.`);
      }

      const numbered = slice
        .map((line, index) => `${offset + index}: ${line}`)
        .join("\n");

      return success(
        `${path} (lines ${offset}-${offset + slice.length - 1} of ${lines.length})\n\n${numbered}`,
        `read ${path}`
      );
    } catch (caught) {
      return failure(
        caught instanceof Error ? caught.message : `${path} could not be read`
      );
    }
  }

  if (name === "write_file") {
    if (!onlyKeys(args, ["path", "content"])) return failure("bad-input: unexpected argument");

    const path = safeRunPath(args.path);
    if (!path) return failure("bad-input: path must be a file inside the workspace");
    if (typeof args.content !== "string") return failure("bad-input: content is required");
    if (args.content.length > RUN_WRITE_MAX_CHARS) {
      return failure(
        `bad-input: content is ${args.content.length} characters; the cap is ${RUN_WRITE_MAX_CHARS}`
      );
    }

    const directory = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

    if (directory.length > 0) {
      const made = await exec(
        sandbox,
        `mkdir -p ${shellQuote(directory)}`,
        RUN_WORKDIR,
        30_000
      );

      if (made.exitCode !== 0) {
        return failure(`The directory could not be created.\n${made.output}`);
      }
    }

    try {
      await sandbox.upload(Buffer.from(args.content, "utf8"), `${RUN_WORKDIR}/${path}`);
    } catch (caught) {
      return failure(caught instanceof Error ? caught.message : `${path} could not be written`);
    }

    return success(
      `${path} written (${args.content.length} characters). Nothing is committed or pushed.`,
      `wrote ${path}`
    );
  }

  if (name === "edit_file") {
    if (!onlyKeys(args, ["path", "find", "replace"])) {
      return failure("bad-input: unexpected argument");
    }

    const path = safeRunPath(args.path);
    if (!path) return failure("bad-input: path must be a file inside the workspace");
    if (typeof args.find !== "string" || args.find.length === 0) {
      return failure("bad-input: find must be a non-empty string");
    }
    if (typeof args.replace !== "string") {
      return failure("bad-input: replace must be a string");
    }

    let current: string;
    try {
      current = await sandbox.readText(`${RUN_WORKDIR}/${path}`, RUN_EDIT_MAX_BYTES);
    } catch (caught) {
      return failure(caught instanceof Error ? caught.message : `${path} could not be read`);
    }

    const occurrences = current.split(args.find).length - 1;

    if (occurrences === 0) {
      return failure(
        `${path} does not contain that text. Read the file and copy the exact text, or use write_file.`
      );
    }

    if (occurrences > 1) {
      return failure(
        `That text appears ${occurrences} times in ${path}. Include more surrounding text so the edit is unambiguous.`
      );
    }

    const next = current.replace(args.find, args.replace);
    if (next.length > RUN_WRITE_MAX_CHARS) {
      return failure(`bad-input: the edited file would exceed ${RUN_WRITE_MAX_CHARS} characters`);
    }

    try {
      await sandbox.upload(Buffer.from(next, "utf8"), `${RUN_WORKDIR}/${path}`);
    } catch (caught) {
      return failure(caught instanceof Error ? caught.message : `${path} could not be written`);
    }

    return success(`${path} edited. One occurrence replaced.`, `edited ${path}`);
  }

  if (name === "search_code") {
    if (!onlyKeys(args, ["query", "path"])) return failure("bad-input: unexpected argument");

    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (query.length < 2) return failure("bad-input: query must be at least two characters");
    if (query.length > 300) return failure("bad-input: query is over the 300 character cap");

    const path = args.path === undefined ? "" : safeRunPath(args.path);
    if (path === null) return failure("bad-input: path must be a directory inside the workspace");

    const target = path.length > 0 ? ` ${shellQuote(path)}` : "";
    const result = await exec(
      sandbox,
      `rg -n --no-heading --max-count ${RUN_SEARCH_MAX_HITS} -F ${shellQuote(query)}${target}`,
      RUN_WORKDIR,
      60_000
    );

    // rg exits 1 for "nothing matched", which is an answer, and 127 for "not
    // installed", which is a fact about the image rather than about the code.
    if (result.exitCode === 127) {
      return failure("ripgrep is not installed in this sandbox, so search is unavailable.");
    }

    const text = result.output.trim();

    if (text.length === 0) {
      return success("No matches.", `no matches for ${JSON.stringify(query)}`);
    }

    const lines = text.split("\n").slice(0, RUN_SEARCH_MAX_HITS);
    return success(
      `${lines.length} match(es)\n\n${lines.join("\n")}`,
      `${lines.length} match(es) for ${JSON.stringify(query)}`
    );
  }

  // run_command
  if (!onlyKeys(args, ["command", "purpose", "cwd", "timeout_ms"])) {
    return failure("bad-input: unexpected argument");
  }

  const command = typeof args.command === "string" ? args.command.trim() : "";
  const purpose = typeof args.purpose === "string" ? args.purpose.trim() : "";

  if (command.length === 0) return failure("bad-input: command is required");
  if (purpose.length === 0) {
    return failure("bad-input: purpose is required, so the reader knows why this ran");
  }
  if (command.length > RUN_COMMAND_MAX_CHARS) {
    return failure(`bad-input: command is over the ${RUN_COMMAND_MAX_CHARS} character cap`);
  }

  const blocked = internalTargetIn(command);
  if (blocked) {
    return failure(
      `refused: the command names a ${blocked}. This sandbox may not reach loopback, private networks or cloud metadata services.`
    );
  }

  const directory =
    args.cwd === undefined ? "" : safeRunPath(args.cwd);
  if (directory === null) return failure("bad-input: cwd must be inside the workspace");

  const timeoutMs = positiveInt(args.timeout_ms, RUN_COMMAND_TIMEOUT_MS, RUN_COMMAND_TIMEOUT_MS);
  const cwd = directory.length > 0 ? `${RUN_WORKDIR}/${directory}` : RUN_WORKDIR;

  const startedAt = Date.now();
  const result = await exec(sandbox, command, cwd, timeoutMs);
  const output = tailBytes(result.output, RUN_TOOL_OUTPUT_BYTES);

  const status = `exit ${result.exitCode}${result.timedOut ? " (timed out)" : ""} in ${
    Date.now() - startedAt
  }ms`;
  const body = output.text.length > 0 ? output.text : "(no output)";
  const text = `${status}\n${body}`;

  // A non-zero exit is information the model must read, not a tool failure to
  // retry blindly, so it is a successful observation that says it failed.
  const clean = redactSecrets(text);

  return {
    ok: true,
    isError: result.exitCode !== 0,
    text: clean,
    preview: previewText(`${purpose}: ${status}`, 400),
  };
}

/** The list a prompt may show the reader: workspace paths, capped. */
export async function listWorkspaceFiles(
  sandbox: SandboxHandle,
  maxPaths = RUN_LIST_MAX
): Promise<string[]> {
  const listed = await exec(
    sandbox,
    `git ls-files | head -n ${maxPaths}`,
    RUN_WORKDIR,
    30_000
  );

  if (listed.exitCode === 0 && listed.output.trim().length > 0) {
    return listed.output.trim().split("\n").slice(0, maxPaths);
  }

  const fallback = await exec(
    sandbox,
    `find . -type f -not -path './.git/*' -not -path './node_modules/*' | sed 's|^\\./||' | head -n ${maxPaths}`,
    RUN_WORKDIR,
    30_000
  );

  return fallback.exitCode === 0
    ? fallback.output.trim().split("\n").filter(Boolean).slice(0, maxPaths)
    : [];
}
