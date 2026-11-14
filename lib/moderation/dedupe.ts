/**
 * Deduplication for signals that can fire in a burst.
 *
 * A client that trips the rate limit a hundred times should produce one row, not
 * a hundred — a feed that scrolls itself is a feed nobody reads. The registry is
 * in-process on purpose: it is a convenience for the reader of the feed, not a
 * correctness guarantee, so a second instance recording a second row is fine.
 *
 * Pure and dependency-free, so it can be tested without a server environment.
 */

const DEFAULT_WINDOW_MS = 10 * 60_000;

const seen = new Map<string, number>();

/** True the first time a key is seen inside the window, false afterwards. */
export function firstSignalIn(key: string, windowMs = DEFAULT_WINDOW_MS): boolean {
  const now = Date.now();
  const last = seen.get(key);

  if (last !== undefined && now - last < windowMs) return false;

  seen.set(key, now);

  // A long-lived process should not accumulate keys forever: prune once the map
  // is large, which is cheaper than pruning on every call.
  if (seen.size > 500) {
    for (const [entry, at] of seen) {
      if (now - at > windowMs) seen.delete(entry);
    }
  }

  return true;
}

/** Test seam: forget what has been recorded in this process. */
export function resetSignalMemory(): void {
  seen.clear();
}
