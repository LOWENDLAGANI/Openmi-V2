/**
 * What the file editor may open and save.
 *
 * Pure on purpose, and deliberately reusing the guard a mission's tools already
 * use: a second path rule is how one surface ends up allowing what another
 * refuses. `sanitiseWorkspacePath` rejects absolute paths, `..`, URLs, `.git`
 * and a path that starts with the workspace name; everything here is relative
 * to the repository inside the sandbox.
 */

import { sanitiseWorkspacePath } from "@/lib/execution/mission/tools";

/** One edited file, as bytes of UTF-8. Larger than this is a viewer's problem. */
export const EDITOR_MAX_BYTES = 200_000;

/** The listing cap, shared with the shell tool so the two cannot disagree. */
export const EDITOR_MAX_FILES = 300;

/**
 * Whether a repository-relative path may be read or written.
 *
 * A leading `./` is normalised rather than refused: a caller pasting a path from
 * a terminal should not have to know that this one function dislikes it.
 */
export function editorPath(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim().replace(/^\.\/+/, "");
  if (trimmed.length === 0) return null;

  return sanitiseWorkspacePath(trimmed);
}

/** Whether the text fits the editor's byte cap. */
export function textFitsWorkspaceFile(text: string): boolean {
  return Buffer.byteLength(text, "utf8") <= EDITOR_MAX_BYTES;
}

/**
 * A NUL byte means the file is not text.
 *
 * The check is on the decoded content rather than an extension list: a `.json`
 * can be a binary and a `.dat` can be a source list, and the bytes know.
 */
export function isProbablyBinary(text: string): boolean {
  return text.includes("\u0000");
}

/**
 * A listing line as a repository-relative path.
 *
 * `find` runs inside the home directory and prints `openmi-workspace/app/…`;
 * the editor shows what git would call the file.
 */
export function relativeToWorkspace(
  line: string,
  root: string = "openmi-workspace"
): string | null {
  const value = line.trim();
  if (value.length === 0) return null;

  if (value === root) return null;
  if (!value.startsWith(`${root}/`)) return value;

  const relative = value.slice(root.length + 1);
  return relative.length > 0 ? relative : null;
}

/**
 * Whether the editor surface exists: a workspace has to be possible first.
 *
 * No separate flag. The editor is not a product bet like previews or publishing;
 * it is a view of a box that either exists or does not.
 */
export function filesEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const execution = (env.EXECUTION_ENABLED ?? "on").trim().toLowerCase();
  if (execution === "off" || execution === "false" || execution === "0") {
    return false;
  }

  return (env.E2B_API_KEY ?? "").trim().length > 0;
}
