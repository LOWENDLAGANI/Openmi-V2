/**
 * What publishing may claim, decided without calling anyone.
 *
 * The rule this file exists to enforce: a deployment has a URL when, and only
 * when, the provider said `READY`. Everything else — queued, building, error,
 * cancelled, or a state this app does not recognise — has no link, because a
 * link that 404s is worse than a sentence saying the build failed.
 */

export type PublishState =
  | "queued"
  | "building"
  | "ready"
  | "error"
  | "cancelled"
  | "unknown";

/** States that will change on their own; a panel may poll only these. */
export const LIVE_PUBLISH_STATES: readonly PublishState[] = [
  "queued",
  "building",
];

export function isLivePublishState(state: PublishState): boolean {
  return LIVE_PUBLISH_STATES.includes(state);
}

/**
 * Vercel's `readyState` in this app's vocabulary.
 *
 * An unrecognised value becomes `unknown`, not `ready` and not `error`: the
 * provider may add a state, and guessing either way would put a false claim on
 * the card. `CANCELED` is Vercel's spelling; both are accepted.
 */
export function mapProviderState(value: unknown): PublishState {
  const state = typeof value === "string" ? value.trim().toUpperCase() : "";

  switch (state) {
    case "QUEUED":
    case "INITIALIZING":
      return "queued";
    case "BUILDING":
      return "building";
    case "READY":
      return "ready";
    case "ERROR":
      return "error";
    case "CANCELED":
    case "CANCELLED":
      return "cancelled";
    default:
      return "unknown";
  }
}

/**
 * The link the panel may render, or null.
 *
 * The provider returns a hostname such as `app-abc123.vercel.app`. The scheme is
 * added once, here, so no component has to decide whether a stored value is a
 * host or a URL.
 */
export function deploymentUrl(
  state: PublishState,
  host: string | null
): string | null {
  if (state !== "ready") return null;

  const value = (host ?? "").trim();
  if (value.length === 0) return null;

  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

/** Publishing needs the operator's provider token; there is no anonymous path. */
export function publishEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return (env.VERCEL_TOKEN ?? "").trim().length > 0;
}

/** The provider's project name: a slug derived from the repository's name. */
export function projectNameFor(repoFullName: string | null): string {
  const repo = (repoFullName ?? "").split("/").filter(Boolean).pop() ?? "";
  const slug = repo
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 52);

  return slug.length > 0 ? slug : "openmi-app";
}

/** A commit the provider is allowed to build: the same sha rule as everywhere. */
export function isPublishableSha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{7,40}$/.test(value);
}

/** A branch name safe to hand to a provider as a ref. */
export function isPublishableBranch(value: unknown): value is string {
  if (typeof value !== "string") return false;

  const branch = value.trim();
  if (branch.length === 0 || branch.length > 100) return false;
  if (!/^[A-Za-z0-9._\/-]+$/.test(branch)) return false;

  return (
    !branch.startsWith("-") &&
    !branch.startsWith("/") &&
    !branch.endsWith("/") &&
    !branch.includes("..") &&
    !branch.includes("//")
  );
}
