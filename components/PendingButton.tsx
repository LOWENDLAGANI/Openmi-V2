"use client";

import { useState } from "react";

import { Spinner } from "@/components/Loading";

/**
 * A button for an action that is not a form submit.
 *
 * `SubmitButton` covers server actions through `useFormStatus`; a click handler
 * has no form status to read, so it gets the same treatment by hand: disable on
 * the first click, show that something is happening, and only then run the work.
 * Without it the click looks ignored for as long as the request takes, which is
 * when a second click lands and the action runs twice.
 *
 * The pending state is released when the work settles, so a failure can be
 * retried instead of leaving a dead control.
 */
export function PendingButton({
  children,
  pendingText = "Working…",
  className = "btn",
  disabled = false,
  title,
  ariaLabel,
  onAction,
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  onAction: () => void | Promise<void>;
}) {
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel}
      disabled={pending || disabled}
      aria-busy={pending}
      className={`${className} disabled:cursor-not-allowed disabled:opacity-60`}
      onClick={() => {
        if (pending) return;
        setPending(true);

        void Promise.resolve(onAction())
          .catch(() => {
            // The caller owns the error message; this only keeps the button
            // usable after a rejected promise.
          })
          .finally(() => setPending(false));
      }}
    >
      {pending ? (
        <>
          <Spinner size={13} />
          {pendingText}
        </>
      ) : (
        children
      )}
    </button>
  );
}
