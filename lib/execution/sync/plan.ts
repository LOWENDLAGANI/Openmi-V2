/**
 * Whether a chat's workspace should follow its branch, decided without a sandbox.
 *
 * Pure on purpose: the order of the refusals is the product rule, and it is
 * easier to read here than inside a route. The order is deliberate —
 *
 *   1. nothing pinned          → nothing to follow
 *   2. already at the head     → nothing to do
 *   3. a turn holds the box    → wait; the turn would lose its files
 *   4. uncommitted work        → refuse; a reseed would discard it
 *   5. otherwise               → pull
 *
 * A dirty workspace is checked after the lease because a running turn is also
 * the thing most likely to be dirty; naming the turn is the more useful answer.
 */

export type SyncVerdict =
  | "no-repository"
  | "up-to-date"
  | "busy"
  | "uncommitted"
  | "pull";

export function syncVerdict(input: {
  pinnedSha: string | null;
  headSha: string;
  leaseLive: boolean;
  provisioning: boolean;
  dirtyFiles: number;
}): SyncVerdict {
  if (!input.pinnedSha) return "no-repository";
  if (input.pinnedSha === input.headSha) return "up-to-date";
  if (input.leaseLive || input.provisioning) return "busy";
  if (input.dirtyFiles > 0) return "uncommitted";

  return "pull";
}

/**
 * What pulling costs, said before it happens.
 *
 * A pull changes the chat's pin, and the next workspace open reseeds from the
 * new commit — the old box and every version inside it are gone. GitHub is the
 * record that survives, which is why the confirmation says so rather than
 * implying the versions stay.
 */
export const PULL_CONFIRMATION =
  "Pull the latest commit? The workspace is reseeded from the branch, so versions made inside the old sandbox are lost. GitHub is not changed.";

/** A sha the pin may hold. Anything else is not compared or sent to GitHub. */
export function isPinnableSha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{7,40}$/.test(value);
}
