/**
 * The branch namespace Openmi may write to.
 *
 * Kept in its own module so a page can display the policy without importing
 * the GitHub write client. The write client is still the only thing that
 * enforces it; this is the name, not the permission.
 */

export const AGENT_BRANCH_PREFIX = "openmi/agent/";

export const AGENT_BRANCH_PATTERN = /^openmi\/agent\/[a-z0-9][a-z0-9-]{0,63}$/;

/** The branch for one changeset. Lower case, within GitHub's branch rules. */
export function agentBranchName(changesetId: string): string {
  const slug = changesetId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 48);

  return `${AGENT_BRANCH_PREFIX}${slug}`;
}
