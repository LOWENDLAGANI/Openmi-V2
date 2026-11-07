/**
 * The branch namespace Openmi may write to.
 *
 * Kept in its own module so a page can display the policy without importing
 * the GitHub write client. The write client is still the only thing that
 * enforces it; this is the name, not the permission.
 */

export const AGENT_BRANCH_PREFIX = "openmi/agent/";

/**
 * The branch a chat's sandbox clone is checked out on.
 *
 * Only the copy inside the sandbox carries this name: nothing is pushed from
 * there. It exists so an edit is a change on a branch of its own rather than a
 * change on top of a detached copy of the default branch.
 */
export const WORK_BRANCH_PREFIX = "openmi/work/";

export const AGENT_BRANCH_PATTERN = /^openmi\/agent\/[a-z0-9][a-z0-9-]{0,63}$/;

/** Git's own ceiling for a branch name. */
export const BRANCH_NAME_MAX = 100;

/**
 * Whether this is a branch name git would accept.
 *
 * Direct commits let the reader name a branch, so the name is checked before
 * any request is made. The rules are git's: no whitespace or `~^:?*[\`, no
 * `..`, no control characters, no leading `-` or `.`, no trailing slash or
 * `.lock`, and nothing that is a ref path rather than a branch.
 */
export function isSafeBranchName(branch: string): boolean {
  const name = branch.trim();

  if (name.length === 0 || name.length > BRANCH_NAME_MAX) return false;
  if (name.startsWith("-") || name.startsWith(".") || name.startsWith("/")) return false;
  if (name.endsWith("/") || name.endsWith(".")) return false;
  if (name.toLowerCase().endsWith(".lock")) return false;
  if (name.includes("..") || name.includes("//") || name.includes("@{")) return false;
  if (name === "HEAD" || name === "@" || name.startsWith("refs/")) return false;
  if (/[\s~^:?*\[\\\x00-\x1f\x7f]/.test(name)) return false;

  return true;
}

/** The branch for one changeset. Lower case, within GitHub's branch rules. */
export function agentBranchName(changesetId: string): string {
  return `${AGENT_BRANCH_PREFIX}${branchSlug(changesetId)}`;
}

/** The branch one chat's sandbox clone is checked out on. */
export function workBranchName(chatId: string): string {
  return `${WORK_BRANCH_PREFIX}${branchSlug(chatId)}`;
}

/** Lower case, no separators git dislikes, short enough for GitHub. */
function branchSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 48);

  return slug.length > 0 ? slug : "chat";
}
