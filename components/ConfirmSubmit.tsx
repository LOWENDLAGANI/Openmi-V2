"use client";

import { useFormStatus } from "react-dom";

import { Spinner } from "@/components/Loading";

/**
 * A submit button that asks before doing something irreversible, and then
 * disables itself while the action is in flight. Deliberately a native confirm:
 * the destructive actions are rare, and a custom dialog would be more code than
 * the risk justifies. The pending state matters more than the prompt — a second
 * click on "Delete forever" must not be possible while the first is running.
 */
export function ConfirmSubmit({
  message,
  children,
  className,
  pendingText = "Working…",
}: {
  message: string;
  children: React.ReactNode;
  className?: string;
  pendingText?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`${className ?? ""} disabled:cursor-not-allowed disabled:opacity-60`}
      onClick={(event) => {
        if (pending) {
          event.preventDefault();
          return;
        }
        if (!window.confirm(message)) event.preventDefault();
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
