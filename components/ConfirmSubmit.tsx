"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

/**
 * A submit button that asks before doing something irreversible, and then
 * serves the press immediately. Deliberately a native confirm: the destructive
 * actions are rare, and a custom dialog would be more code than the risk
 * justifies. The lock matters more than the prompt — a second click on
 * "Delete forever" must not be possible while the first is running — and the
 * optimistic label plus the settle-back means the click is answered before the
 * server is. A confirmation the reader cancels changes nothing at all.
 */
export function ConfirmSubmit({
  message,
  children,
  className,
  optimisticText,
  pendingText = "Working…",
}: {
  message: string;
  children: React.ReactNode;
  className?: string;
  /** The outcome, shown the instant this button is pressed. */
  optimisticText?: string;
  /** Fallback label when no optimistic one is given. */
  pendingText?: string;
}) {
  const { pending } = useFormStatus();
  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    if (!pending) setPressed(false);
  }, [pending]);

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`${className ?? ""} disabled:cursor-not-allowed`}
      onClick={(event) => {
        if (pending) {
          event.preventDefault();
          return;
        }
        if (!window.confirm(message)) {
          event.preventDefault();
          return;
        }
        setPressed(true);
      }}
    >
      {pending && pressed && (optimisticText ?? pendingText)
        ? (optimisticText ?? pendingText)
        : children}
    </button>
  );
}
