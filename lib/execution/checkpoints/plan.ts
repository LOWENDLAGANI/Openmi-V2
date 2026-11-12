/**
 * What a checkpoint is, without a sandbox or a database.
 *
 * Pure on purpose: the sha rule and the changed-file count are the parts a
 * caller gets wrong, and both are decidable from a string. The session module
 * does the git work; the tests read these rules.
 */

/** How many versions the panel asks for. Not a retention policy. */
export const CHECKPOINT_LIST_LIMIT = 20;

/** One label is a line in a list, not a paragraph. */
export const CHECKPOINT_MAX_LABEL_CHARS = 80;

/**
 * A commit sha, as git prints it. Seven is the shortest unambiguous prefix;
 * forty is the full hash. Anything else is not interpolated into a shell.
 */
export function isCheckpointSha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{7,40}$/.test(value);
}

/**
 * How many files `git status --porcelain` reports.
 *
 * One line per path, including untracked files, because a file the turn created
 * is a change the reader should be able to go back before. A rename prints two
 * lines for one file, which over-counts slightly; the number is a label, not
 * accounting.
 */
export function changedFileCount(porcelain: string): number {
  return porcelain
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;
}

/** The sha on the last line of a `rev-parse` that also ran `add` and `commit`. */
export function shaFromOutput(output: string): string | null {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (isCheckpointSha(lines[index])) return lines[index];
  }

  return null;
}

/**
 * A label a reader can tell apart without opening it.
 *
 * The time is UTC and fixed-width so the list reads as a timeline on every
 * device, and so a test can assert the shape rather than a locale.
 */
export function defaultCheckpointLabel(now: number = Date.now()): string {
  return `${new Date(now).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * Whether versions are on.
 *
 * On when a sandbox can exist, because a version is a commit in that box. Off
 * by name removes the surface; turning execution off takes it with it.
 */
export function checkpointsEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const flag = (env.OPENMI_CHECKPOINTS ?? "").trim().toLowerCase();
  if (flag === "off" || flag === "false" || flag === "0") return false;

  const execution = (env.EXECUTION_ENABLED ?? "on").trim().toLowerCase();
  if (execution === "off" || execution === "false" || execution === "0") {
    return false;
  }

  return (env.E2B_API_KEY ?? "").trim().length > 0;
}
