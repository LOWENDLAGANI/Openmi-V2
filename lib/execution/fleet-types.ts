/**
 * What the admin panel shows about the sandbox accounts.
 *
 * Kept apart from the query that builds it so a browser component can import the
 * types and the three formatting rules without pulling a server module — and,
 * more importantly, without the service role ever reaching the client bundle.
 * Nothing here holds key material: an account is its label, its state and times.
 */

export type SandboxFleetAccount = {
  /** The label from `E2B_ACCOUNTS` (or `default` for the legacy key). */
  id: string;
  /** False for a label the fleet remembers but this deployment no longer has. */
  configured: boolean;
  state: "active" | "cooling" | "disabled";
  setAsideUntil: string | null;
  lastTriedAt: string | null;
  lastOkAt: string | null;
  lastFailure: string | null;
  lastFailureAt: string | null;
  /** Live boxes this account holds, and the split by what owns them. */
  live: number;
  chat: number;
  runs: number;
  executions: number;
  /** `E2B_ACCOUNT_MAX_SANDBOXES`, or null when uncapped. */
  cap: number | null;
  /** Whether the choice rule would use this account for a new box right now. */
  acceptingNew: boolean;
};

export type SandboxFleetReport = {
  accounts: SandboxFleetAccount[];
  totals: {
    configured: number;
    live: number;
    cooling: number;
    disabled: number;
    acceptingNew: number;
  };
  /** When these numbers were read, so the panel can say how fresh they are. */
  checkedAt: string;
};

export type FleetTone = "ok" | "pending" | "missing" | "optional";

/** An account seen creating a box this recently counts as working. */
export const WORKING_WINDOW_MS = 10 * 60_000;

/**
 * Minutes a cooling account has left, rounded up so a 30-second wait is not
 * shown as "0m". Null for anything unreadable or already past.
 */
export function minutesLeft(
  until: string | null,
  now: number = Date.now()
): number | null {
  if (!until) return null;
  const at = Date.parse(until);
  if (!Number.isFinite(at)) return null;

  const remaining = at - now;
  return remaining <= 0 ? null : Math.ceil(remaining / 60_000);
}

/**
 * The one-word answer to "which one is working".
 *
 * Working means it has live boxes or created one in the last ten minutes — the
 * two pieces of evidence that it is actually doing something now. Ready is a
 * healthy account that happens to be idle; cooling is a limit with a timer; set
 * aside is a key that needs a person.
 */
export function fleetStatus(
  account: SandboxFleetAccount,
  now: number = Date.now()
): { label: string; tone: FleetTone } {
  if (!account.configured) return { label: "not configured", tone: "optional" };

  if (account.state === "disabled") return { label: "set aside", tone: "missing" };

  if (account.state === "cooling") {
    const left = minutesLeft(account.setAsideUntil, now);
    if (left !== null) return { label: `cooling ${left}m`, tone: "pending" };
  }

  if (account.live > 0) return { label: "working", tone: "ok" };

  const workedAt = account.lastOkAt ? Date.parse(account.lastOkAt) : NaN;
  if (Number.isFinite(workedAt) && now - workedAt < WORKING_WINDOW_MS) {
    return { label: "working", tone: "ok" };
  }

  return { label: "ready", tone: "optional" };
}

/** A short, human age. Deliberately coarse: the panel is not a stopwatch. */
export function agoLabel(value: string | null, now: number = Date.now()): string {
  if (!value) return "never";
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return "never";

  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return "just now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;

  return `${Math.round(hours / 24)}d ago`;
}
