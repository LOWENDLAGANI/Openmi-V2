import { MAX_EDITS_PER_CALL, validateEdits, type EditRequest } from "../changesets";
import { safeBranchName } from "../github/branch-request";
import { getFile, searchCode } from "../github/read";

/**
 * The agent's tool surface.
 *
 * Three reads, all of them GETs, all of them already rate-limited by GitHub.
 * There is no `url` parameter on any tool and no way to pass one: every request
 * is built from the token plus a path inside the repository the turn is pinned
 * to. A model cannot use these to fetch an internal address.
 *
 * Caps are here, not in the prompt: a model that asks for a 4MB file is refused
 * by code with a message it can read, rather than by hoping it complies.
 */

export const MAX_LIST_FILES = 200;
export const MAX_READ_FILE_BYTES = 200_000;
export const MAX_SEARCH_CANDIDATES = 10;

export type ToolName =
  | "list_files"
  | "read_file"
  | "search_code"
  | "propose_edits"
  | "git";

export type ToolDefinition = {
  name: ToolName;
  description: string;
  parameters: Record<string, unknown>;
};

export const TOOL_SPECS: ToolDefinition[] = [
  {
    name: "list_files",
    description:
      "List repository file paths, optionally filtered to one directory. Returns at most 200 paths. Omit prefix, or pass '/', to list from the repository root.",
    parameters: {
      type: "object",
      properties: {
        prefix: {
          type: "string",
          description: "Optional directory prefix, for example 'lib/'.",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "read_file",
    description:
      "Read one text file at the pinned commit, with line numbers. Refuses files over 200,000 bytes and binary files.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Repository-relative path, for example 'lib/context.ts'.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "search_code",
    description:
      "Search the repository for literal text. Returns at most 10 candidate paths with the first matching line.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Literal text to look for." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_edits",
    description:
      "Propose edits. A call carries one to six edits; each is a whole-file write or an exact string replacement at the pinned commit. Pass destination when the reader named a branch to write; omit it to land on a new openmi/ agent branch and a pull request.",
    parameters: {
      type: "object",
      properties: {
        destination: {
          type: "string",
          description:
            "The branch the reader asked for, in their words, without a leading origin/ or refs/heads/. Only when they named one; the app writes it directly. Omit it otherwise.",
        },
        edits: {
          type: "array",
          maxItems: MAX_EDITS_PER_CALL,
          items: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Repository-relative path, for example 'lib/context.ts'.",
              },
              mode: {
                type: "string",
                enum: ["write", "replace"],
                description:
                  "write replaces the whole file; replace swaps one exact, unique piece of text.",
              },
              content: {
                type: "string",
                description: "The complete new file for mode write.",
              },
              find: {
                type: "string",
                description:
                  "For mode replace: the exact text at the base commit. It must appear exactly once.",
              },
              replace: {
                type: "string",
                description: "For mode replace: the text that takes its place.",
              },
            },
            required: ["path", "mode"],
            additionalProperties: false,
          },
        },
      },
      required: ["edits"],
      additionalProperties: false,
    },
  },
  {
    name: "git",
    description:
      "Read this chat's git state or move its pin to the branch head. Nothing on GitHub is changed by either action, and a pull is refused while the workspace holds uncommitted files.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["status", "pull"],
          description:
            "status reports the pinned commit against the branch head; pull moves the pin to that head, which reseeds the workspace on the next turn.",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
];

/**
 * Git, served by the app rather than by a terminal.
 *
 * The sandbox has no remote and no token, so the only way a turn can ask about
 * the branch or follow it is through these callbacks, which run with the sealed
 * token the request already opened. They are absent on a turn with no pinned
 * repository, and the tool then says `unavailable:` instead of guessing.
 */
export type GitActions = {
  status: () => Promise<ToolResult>;
  pull: () => Promise<ToolResult>;
};

export type ToolContext = {
  token: string;
  fullName: string;
  sha: string;
  paths: string[];
  /** Absent when this turn cannot persist a proposal (no pin or no signing key). */
  propose?: (edits: EditRequest[], destination: string | null) => Promise<ToolResult>;
  /** Absent when this turn has no repository or no sealed GitHub token. */
  git?: GitActions;
};

export type ToolResult =
  | {
      ok: true;
      text: string;
      /** A command that ran and exited non-zero: a fact for the reader, not a retry. */
      failed?: boolean;
      /** The output tail a step row can fold open. */
      tail?: string;
      /** A screenshot the turn should show the reader, not only describe. */
      image?: { mime: string; base64: string; caption: string };
    }
  | { ok: false; error: string; tail?: string };

function badInput(message: string): ToolResult {
  return { ok: false, error: `bad-input: ${message}` };
}

function onlyKeys(args: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(args).every((key) => allowed.includes(key));
}

/** Rejects traversal before any network call, not after. */
function safePath(value: string): string | null {
  if (value.length === 0 || value.length > 400) return null;
  if (value.startsWith("/") || value.includes("..") || value.includes("\\")) return null;
  if (value.includes("://")) return null;
  return value;
}

/**
 * The directory a `prefix` names, as a bare path prefix.
 *
 * "The root directory" arrives in a tool call as `/`, `.`, `./` or as no
 * argument at all, and every one of those means the whole repository. Matching
 * the raw string made all of them return nothing, which reads back as an empty
 * repository — a turn then tells the reader its tools are broken instead of
 * listing the tree it already had. A trailing slash is dropped for the same
 * reason: `lib/` and `lib` name one directory.
 */
export function listPrefix(value: unknown): string | null {
  if (value === undefined) return "";
  if (typeof value !== "string") return null;

  const trimmed = value
    .trim()
    .replace(/^(\.\/)+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  return trimmed === "." ? "" : trimmed;
}

export function parseArguments(raw: string): Record<string, unknown> | null {
  if (raw.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function describeToolCall(name: string, args: Record<string, unknown>): string {
  if (name === "read_file" && typeof args.path === "string") return `read ${args.path}`;
  if (name === "propose_edits" && Array.isArray(args.edits)) {
    const target = typeof args.destination === "string" ? ` to ${args.destination}` : "";
    return `propose ${args.edits.length} file(s)${target}`;
  }
  if (name === "search_code" && typeof args.query === "string") return `search ${JSON.stringify(args.query)}`;
  if (name === "list_files" && typeof args.prefix === "string") return `list ${args.prefix}`;
  if (name === "git" && typeof args.action === "string") return `git ${args.action}`;
  return name;
}

export async function runTool(
  name: string,
  args: Record<string, unknown> | null,
  context: ToolContext
): Promise<ToolResult> {
  if (args === null) return badInput("arguments were not a JSON object");

  if (name === "list_files") {
    if (!onlyKeys(args, ["prefix"])) return badInput("unexpected argument");
    const prefix = listPrefix(args.prefix);
    if (prefix === null) return badInput("prefix must be a string");

    const matching =
      prefix.length === 0
        ? context.paths
        : context.paths.filter(
            (path) => path === prefix || path.startsWith(`${prefix}/`)
          );

    // An empty answer for a directory that does exist would read back to the
    // model as an empty repository, so a miss says what was searched instead.
    if (matching.length === 0) {
      return {
        ok: true,
        text: `No path is under ${prefix} at ${context.sha.slice(
          0,
          7
        )}; ${context.paths.length} path(s) are available. Omit prefix to list from the repository root.`,
      };
    }

    const listed = matching.slice(0, MAX_LIST_FILES);
    const header = `${matching.length} path(s) match; showing ${listed.length} of at most ${MAX_LIST_FILES}.`;

    return {
      ok: true,
      text: `${header}\n\n${listed.join("\n")}`,
    };
  }

  if (name === "read_file") {
    if (!onlyKeys(args, ["path"])) return badInput("unexpected argument");
    if (typeof args.path !== "string") return badInput("path is required");

    const path = safePath(args.path);
    if (!path) return badInput("path must be repository-relative and cannot leave the repository");

    try {
      const file = await getFile(context.token, context.fullName, context.sha, path);

      if (file.bytes > MAX_READ_FILE_BYTES) {
        return {
          ok: false,
          error: `too-large: ${file.bytes} bytes exceeds the ${MAX_READ_FILE_BYTES} byte limit`,
        };
      }

      const numbered = file.text
        .split("\n")
        .map((line, index) => `${index + 1}: ${line}`)
        .join("\n");

      return {
        ok: true,
        text: `${file.path} at ${context.sha.slice(0, 7)} (${file.bytes} bytes)\n\n${numbered}`,
      };
    } catch (caught) {
      return {
        ok: false,
        error: caught instanceof Error ? caught.message : "the file could not be read",
      };
    }
  }

  if (name === "search_code") {
    if (!onlyKeys(args, ["query"])) return badInput("unexpected argument");
    if (typeof args.query !== "string" || args.query.trim().length < 2) {
      return badInput("query must be at least two characters");
    }

    try {
      const found = await searchCode(
        context.token,
        context.fullName,
        context.sha,
        args.query.trim()
      );

      const hits = found.hits.slice(0, MAX_SEARCH_CANDIDATES);
      const body = hits
        .map((hit) => (hit.line ? `${hit.path}:${hit.line}` : hit.path))
        .join("\n");

      return {
        ok: true,
        text: `${found.totalCount} match(es); ${hits.length} shown (cap ${MAX_SEARCH_CANDIDATES}).\n\n${body}`,
      };
    } catch (caught) {
      return {
        ok: false,
        error: caught instanceof Error ? caught.message : "the search failed",
      };
    }
  }

  if (name === "propose_edits") {
    if (!onlyKeys(args, ["edits", "destination"])) return badInput("unexpected argument");

    let destination: string | null = null;
    if (args.destination !== undefined) {
      destination = safeBranchName(args.destination);
      if (destination === null) {
        return badInput("destination must be a branch name, not a path or a sentence");
      }
    }

    const validated = validateEdits(args.edits);
    if (!validated.ok) return badInput(validated.error);

    if (!context.propose) {
      return {
        ok: false,
        error:
          "unavailable: proposing edits needs a pinned repository and GITHUB_TOKEN_KEY",
      };
    }

    return context.propose(validated.edits, destination);
  }

  if (name === "git") {
    if (!onlyKeys(args, ["action"])) return badInput("unexpected argument");
    if (args.action !== "status" && args.action !== "pull") {
      return badInput("action must be status or pull");
    }

    if (!context.git) {
      return {
        ok: false,
        error: "unavailable: git needs a pinned repository and a connected GitHub token",
      };
    }

    return args.action === "status" ? context.git.status() : context.git.pull();
  }

  return badInput(`unknown tool: ${name}`);
}
