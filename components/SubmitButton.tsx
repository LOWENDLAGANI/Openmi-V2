"use client";

import { useFormStatus } from "react-dom";

import { Spinner } from "@/components/Loading";

/**
 * A submit button that tells the truth while its form is in flight.
 *
 * Server actions redirect, and on a slow network the browser keeps the old page
 * on screen for a second or two with no sign that anything happened. That is
 * exactly when people click again — and a second submit is a second receipt, a
 * second folder, a second approval. `useFormStatus` disables the button the
 * moment the form is submitted and swaps the label for a pending one, so the
 * click is visibly taken and cannot be repeated.
 *
 * It must be rendered inside the `<form>` it belongs to; that is what
 * `useFormStatus` reads.
 */
export function SubmitButton({
  children,
  pendingText = "Working…",
  className = "btn",
  name,
  value,
  disabled = false,
  title,
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
  title?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      name={name}
      value={value}
      title={title}
      disabled={pending || disabled}
      aria-busy={pending}
      className={`${className} disabled:cursor-not-allowed disabled:opacity-60`}
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
