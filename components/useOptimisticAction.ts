"use client";

import { useCallback, useEffect, useOptimistic, useRef, useState, useTransition } from "react";

/** What an action reports when it has something to say about the outcome. */
export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

export type Settled = void | ActionResult;

/**
 * The nudge a control gets when the work it started was undone.
 *
 * A rolled-back result that flickers back with no sign is a result the reader
 * will press again. One animation, 700ms later forgotten, is enough to say "that
 * did not take" without a toast or a second error area.
 */
export function useSnapBack(): { snapped: boolean; snap: () => void } {
  const [snapped, setSnapped] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );

  const snap = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setSnapped(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setSnapped(false);
    }, 700);
  }, []);

  return { snapped, snap };
}

/**
 * One press, one request, no waiting.
 *
 * A control that waits for its server before it changes anything looks broken
 * on a slow connection, and that is exactly when the reader presses it again —
 * which is how one action becomes two. This hook splits the press in two:
 *
 * 1. `run()` paints the optimistic value in the same frame as the click, inside
 *    a transition, so nothing on screen is waiting for the network.
 * 2. The control stays locked (`pending`) for the whole request, so a second
 *    press cannot start a second one.
 * 3. When the work settles the guess is discarded and the confirmed value is
 *    painted again — that is the snap back. A failure also raises `snapped`
 *    for a moment, so the revert is visible rather than silent.
 *
 * Both halves matter: optimistic alone lets a burst of clicks through, a lock
 * alone leaves the old waiting state on screen. React's `useOptimistic` and
 * TanStack's `onMutate`/`onError` pair settle on the same shape — apply the
 * guess now, keep the request single, replace the guess with the truth.
 */
export function useOptimisticAction<T>({
  value,
  optimistic,
  action,
  onSettled,
}: {
  /** The value the server last confirmed. */
  value: T;
  /** What the reader should see from the moment they press. */
  optimistic: T;
  action: () => Settled | Promise<Settled>;
  /** Receives what the action reported, so the caller can show its error. */
  onSettled?: (result: Settled) => void;
}): {
  state: T;
  pending: boolean;
  snapped: boolean;
  run: () => void;
} {
  const [pending, startTransition] = useTransition();
  const [state, applyOptimistic] = useOptimistic(
    value,
    (_current, next: T) => next
  );
  const inFlight = useRef(false);
  const { snapped, snap: snapBack } = useSnapBack();

  const run = useCallback(() => {
    // `disabled` is the visible guard; this one holds even when a pointer event
    // lands between two renders.
    if (inFlight.current) return;
    inFlight.current = true;

    startTransition(async () => {
      applyOptimistic(optimistic);

      try {
        const result = await action();
        if (result && result.ok === false) snapBack();
        onSettled?.(result);
      } catch {
        // The caller owns its message, already set inside its own try/catch.
        // What the hook owes it is the revert.
        snapBack();
      } finally {
        inFlight.current = false;
      }
    });
  }, [action, applyOptimistic, onSettled, optimistic, snapBack]);

  return { state, pending, snapped, run };
}
