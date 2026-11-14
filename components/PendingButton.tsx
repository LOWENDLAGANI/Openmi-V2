"use client";

import { useOptimisticAction } from "@/components/useOptimisticAction";

/**
 * A button for an action that is not a form submit.
 *
 * `SubmitButton` covers server actions through `useFormStatus`; a click handler
 * has no form status to read, so it gets the same treatment by hand.
 *
 * The press is optimistic: the label becomes `optimisticText` in the same frame
 * as the click, so the control never looks like it is waiting for the server.
 * It is locked for the whole request — a second click lands on a disabled
 * button, not on a second request — and when the request fails the label snaps
 * back to the one it had before, with a short nudge so the revert is visible.
 */
export function PendingButton({
  children,
  optimisticText,
  pendingText = "Working…",
  className = "btn",
  disabled = false,
  title,
  ariaLabel,
  onAction,
  onError,
}: {
  children: React.ReactNode;
  /** Seen the instant the button is pressed; the result, not the wait. */
  optimisticText?: string;
  /** Fallback label when no optimistic one is given. */
  pendingText?: string;
  className?: string;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  onAction: () => void | Promise<void>;
  /** Called when the action reported a failure, for a caller with an error slot. */
  onError?: (error: string) => void;
}) {
  const { pending, snapped, run } = useOptimisticAction({
    value: false,
    optimistic: true,
    action: onAction,
    onSettled: (result) => {
      if (result && result.ok === false) onError?.(result.error);
    },
  });

  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel}
      disabled={pending || disabled}
      aria-busy={pending}
      className={`${className} ${snapped ? "snap-back" : ""} disabled:cursor-not-allowed`}
      onClick={run}
    >
      {pending ? (optimisticText ?? pendingText) : children}
    </button>
  );
}
