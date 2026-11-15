/**
 * The worker fleet's rules, as pure functions.
 *
 * A worker is a long-lived process on a host that may sleep, restart or
 * disappear. Two decisions follow from that, and both are made here so they can
 * be tested without a database or a network:
 *
 *   - **Who to wake.** Prefer a member that is awake and has a free slot; wake a
 *     second one only when the first looks asleep, because two cold boots are
 *     better than one that never happened. Never broadcast.
 *   - **When to retry.** A run whose worker stopped reporting goes back in the
 *     queue exactly once, and a cancelled run never does.
 *
 * Everything here reads the clock as an argument, so a test can move it.
 */

export type WorkerState = "active" | "draining" | "disabled";

export type WorkerMember = {
  id: string;
  healthUrl: string | null;
  pool: string | null;
  concurrency: number;
  state: WorkerState;
  activeRuns: number;
  lastSeenAt: string | null;
  lastWokenAt: string | null;
};

/** A member seen less recently than this is gone, not asleep. */
export const WORKER_STALE_MS = 5 * 60_000;

/** A member seen less recently than this might be asleep and worth backing up. */
export const WORKER_AWAKE_MS = 2 * 60_000;

/** A queued run waits this long before it asks for a second machine. */
export const RUN_WAKE_ESCALATE_MS = 45_000;

/** No run asks for a second machine more often than this. */
export const RUN_WAKE_FLOOR_MS = 2 * 60_000;

/** Escalations per run. A run fails on its own twenty-minute rule anyway. */
export const RUN_WAKE_MAX_ATTEMPTS = 5;

export type WorkerTarget = { id: string | null; url: string };

/** `RUN_WORKER_ID` and friends, trimmed, with empty values read as unset. */
export function workerIdentity(
  env: Record<string, string | undefined> = process.env
): { id: string | null; label: string | null; healthUrl: string | null; pool: string | null } {
  const text = (value: string | undefined) => {
    const trimmed = (value ?? "").trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  return {
    id: text(env.RUN_WORKER_ID),
    label: text(env.RUN_WORKER_LABEL),
    healthUrl: text(env.RUN_WORKER_HEALTH_URL),
    pool: text(env.RUN_WORKER_POOL),
  };
}

function seenAt(member: WorkerMember): number | null {
  if (!member.lastSeenAt) return null;
  const at = Date.parse(member.lastSeenAt);
  return Number.isFinite(at) ? at : null;
}

function wokenAt(member: WorkerMember): number | null {
  if (!member.lastWokenAt) return null;
  const at = Date.parse(member.lastWokenAt);
  return Number.isFinite(at) ? at : null;
}

/** Free slots, never negative. A member at its concurrency is full. */
export function freeSlots(member: WorkerMember): number {
  return Math.max(0, member.concurrency - member.activeRuns);
}

export function workerIsAwake(member: WorkerMember, now: number = Date.now()): boolean {
  const at = seenAt(member);
  return at !== null && now - at <= WORKER_AWAKE_MS;
}

export function workerIsKnown(member: WorkerMember, now: number = Date.now()): boolean {
  const at = seenAt(member);
  return at !== null && now - at <= WORKER_STALE_MS;
}

/**
 * Members that may take work now: active, recently seen, and with a free slot.
 *
 * A member that has never reported is not eligible — it has no health URL to
 * ping and no evidence it exists. A draining or disabled member is out even if
 * it is still running its own work.
 */
export function eligibleWorkers(
  members: WorkerMember[],
  now: number = Date.now()
): WorkerMember[] {
  return members.filter(
    (member) =>
      member.state === "active" &&
      member.healthUrl !== null &&
      workerIsKnown(member, now) &&
      freeSlots(member) > 0
  );
}

/**
 * The best member to wake, in the order the waker should try them.
 *
 * Most free slots first; ties go to the member woken longest ago (a member never
 * woken counts as oldest), then to the id, so the answer is stable.
 */
export function rankWorkers(
  members: WorkerMember[],
  now: number = Date.now()
): WorkerMember[] {
  return [...eligibleWorkers(members, now)].sort((a, b) => {
    const slots = freeSlots(b) - freeSlots(a);
    if (slots !== 0) return slots;

    const aWoken = wokenAt(a) ?? -Infinity;
    const bWoken = wokenAt(b) ?? -Infinity;
    if (aWoken !== bWoken) return aWoken - bWoken;

    return a.id.localeCompare(b.id);
  });
}

/**
 * One or two members to wake.
 *
 * A second request only when the best candidate looks asleep: it is known (so it
 * is not dead) but was last seen longer ago than the awake window. Two requests,
 * never a broadcast — waking four machines to run one job is how a free tier
 * runs out of instances.
 */
export function pickWakes(
  members: WorkerMember[],
  now: number = Date.now()
): WorkerMember[] {
  const ranked = rankWorkers(members, now);
  const best = ranked[0];
  if (!best) return [];

  const wakes = [best];

  if (!workerIsAwake(best, now)) {
    const second = ranked[1];
    if (second) wakes.push(second);
  }

  return wakes;
}

/** The member a run's escalation should try: the one woken longest ago. */
export function pickNextWake(
  members: WorkerMember[],
  now: number = Date.now()
): WorkerMember | null {
  return rankWorkers(members, now)[0] ?? null;
}

/**
 * Where to ping when the fleet table has nothing usable.
 *
 * A fresh deployment has no registered worker yet, so the first queued run still
 * has to be able to wake one. `RUN_WORKERS` is a comma-separated list for a
 * deployment that runs several members before any has registered;
 * `RUN_WORKER_URL` and the blueprint's own default stay as they were.
 */
export function staticWorkerTargets(
  defaultUrl: string,
  env: Record<string, string | undefined> = process.env
): WorkerTarget[] {
  const list = (env.RUN_WORKERS ?? "").trim();

  if (list.length > 0) {
    const targets = list
      .split(/[,;\s]+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .map((entry) => withHealthPath(entry))
      .filter((entry): entry is string => entry !== null)
      .map((url) => ({ id: null, url }));

    if (targets.length > 0) return targets;
  }

  const base = (env.RUN_WORKER_URL ?? "").trim();
  if (base.length > 0) {
    const url = withHealthPath(base);
    if (url) return [{ id: null, url }];
  }

  return [{ id: null, url: defaultUrl }];
}

/** Accepts a base URL or a full `/healthz` URL, and rejects anything else. */
function withHealthPath(value: string): string | null {
  const trimmed = value.replace(/\/+$/, "");

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return /\/healthz$/.test(trimmed) ? url.toString() : `${trimmed}/healthz`;
  } catch {
    return null;
  }
}

/**
 * Whether a queued run should ask for another machine.
 *
 * Its own status read calls this on every poll, so it has to be cheap and
 * quiet: only after the run has waited, only once per floor, and only a bounded
 * number of times.
 */
export function shouldEscalate(
  input: {
    status: string;
    queuedAt: string | null;
    lastWakeAt: string | null;
    wakeAttempts: number;
  },
  now: number = Date.now()
): boolean {
  if (input.status !== "queued") return false;
  if (input.wakeAttempts >= RUN_WAKE_MAX_ATTEMPTS) return false;

  const queued = input.queuedAt ? Date.parse(input.queuedAt) : NaN;
  if (!Number.isFinite(queued) || now - queued < RUN_WAKE_ESCALATE_MS) return false;

  if (input.lastWakeAt) {
    const woken = Date.parse(input.lastWakeAt);
    if (Number.isFinite(woken) && now - woken < RUN_WAKE_FLOOR_MS) return false;
  }

  return true;
}

/**
 * Whether a run's worker has gone quiet long enough to hand the run to someone
 * else.
 *
 * One retry, ever: `retryCount` is the guard, and it is read from the row and
 * written back in the same compare-and-set, so two servers cannot both requeue.
 * A cancelled run is never retried — the reader asked for it to stop.
 */
export function shouldRequeueRun(
  input: {
    status: string;
    cancelRequested: boolean;
    retryCount: number;
    heartbeatAt: string | null;
    startedAt: string | null;
    createdAt: string;
  },
  now: number = Date.now(),
  staleMs: number
): boolean {
  if (input.status !== "running") return false;
  if (input.cancelRequested) return false;
  if (input.retryCount > 0) return false;

  const last =
    Date.parse(input.heartbeatAt ?? input.startedAt ?? input.createdAt) || 0;

  return now - last >= staleMs;
}
