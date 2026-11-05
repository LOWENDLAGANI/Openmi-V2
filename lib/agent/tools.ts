import { MAX_EDITS_PER_CALL, validateEdits, type EditRequest } from "../changesets";
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

export type ToolName = "list_files" | "read_file" | "search_code" | "propose_edits";

export type ToolDefinition = {
  name: ToolName;
  description: string;
  parameters: Record<string, unknown>;
};

export const TOOL_SPECS: ToolDefinition[] = [
  {
    name: "list_files",
    description:
      "List repository file paths, optionally filtered by directory prefix. Returns at most 200 paths.",
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
      "Propose edits for the user to review. Nothing is written to GitHub. A call carries one to six edits; each is a whole-file write or an exact string replacement at the pinned commit.",
    parameters: {
      type: "object",
      properties: {
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
];

export type ToolContext = {
  token: string;
  fullName: string;
  sha: string;
  paths: string[];
  /** Absent when this turn cannot persist a proposal (no pin or no signing key). */
  propose?: (edits: EditRequest[]) => Promise<ToolResult>;
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
    return `propose ${args.edits.length} file(s)`;
  }
  if (name === "search_code" && typeof args.query === "string") return `search ${JSON.stringify(args.query)}`;
  if (name === "list_files" && typeof args.prefix === "string") return `list ${args.prefix}`;
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
    const prefix = args.prefix;
    if (prefix !== undefined && typeof prefix !== "string") {
      return badInput("prefix must be a string");
    }

    const matching = context.paths.filter(
      (path) => typeof prefix !== "string" || prefix.length === 0 || path.startsWith(prefix)
    );
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
    if (!onlyKeys(args, ["edits"])) return badInput("unexpected argument");

    const validated = validateEdits(args.edits);
    if (!validated.ok) return badInput(validated.error);

    if (!context.propose) {
      return {
        ok: false,
        error:
          "unavailable: proposing edits needs a pinned repository and GITHUB_TOKEN_KEY",
      };
    }

    return context.propose(validated.edits);
  }

  return badInput(`unknown tool: ${name}`);
}
