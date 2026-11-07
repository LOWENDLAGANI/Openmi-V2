/**
 * Whether a ready diff is written to GitHub without an approval click.
 *
 * This is the "the agent just opens the pull request" switch. It is on by
 * default because the write is already bounded structurally, not by the click:
 * one new `openmi/agent/` branch, one commit, one pull request, never the
 * default branch, never a forced ref. The click was a second confirmation of a
 * decision the write client already enforces.
 *
 * Set `OPENMI_AUTO_WRITE=off` to bring the approval card back. The runner, the
 * chat route and the review card read the same answer, so a card cannot offer an
 * approval the route has already performed.
 *
 * Pure on purpose: no `server-only`, no request context, testable by inspection.
 */

/** The flag, read the same way as every other kill switch in the app. */
export function autoWriteEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const flag = (env.OPENMI_AUTO_WRITE ?? "on").trim().toLowerCase();
  return flag !== "off" && flag !== "false" && flag !== "0" && flag !== "no";
}

/**
 * Whether a reader who names the default branch may write straight to it.
 *
 * Off by default, and deliberately a separate switch from auto-write: skipping
 * the click and rewriting the branch everyone deploys from are different
 * decisions. Even when this is on, the assistant only uses the default branch
 * when the change was sent to it by name — the derived destination is still a
 * new `openmi/agent/` branch.
 *
 * This is the switch for writes nobody asked about by name. A reader who asks
 * for a branch ("push it to main", or typing one on the review card) has
 * already authorized that branch, so `lib/changesets/commit.ts` does not consult
 * this flag for those writes.
 */
export function defaultBranchWritesAllowed(
  env: Record<string, string | undefined> = process.env
): boolean {
  const flag = (env.OPENMI_ALLOW_DEFAULT_BRANCH ?? "off").trim().toLowerCase();
  return flag === "on" || flag === "true" || flag === "1" || flag === "yes";
}
