"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

/**
 * A submit button that answers the press immediately.
 *
 * Server actions redirect or revalidate, and on a slow network the browser
 * keeps the old page on screen for a second or two. That is exactly when people
 * click again — and a second submit is a second receipt, a second folder, a
 * second approval. `useFormStatus` disables the button the moment the form is
 * submitted, so the click is visibly taken and cannot be repeated.
 *
 * The press is optimistic: the label becomes `optimisticText` in the frame the
 * button was clicked, not after the response. Only the button that started the
 * submit says it — a form with two submit buttons does not get to claim both
 * outcomes. If the action settles without taking, the label snaps back to the
 * one it had before, so a failure is visible rather than a lie.
 *
 * It must be rendered inside the `<form>` it belongs to; that is what
 * `useFormStatus` reads.
 */
export function SubmitButton({
  children,
  optimisticText,
  pendingText = "Working…",
  className = "btn",
  name,
  value,
  disabled = false,
  title,
  ariaLabel,
}: {
  children: React.ReactNode;
  /** The outcome, shown the instant this button is pressed. */
  optimisticText?: string;
  /** Fallback label when no optimistic one is given. */
  pendingText?: string;
  className?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
  title?: string;
  /** For an icon-only submit, where the visible label is a glyph. */
  ariaLabel?: string;
}) {
  const { pending } = useFormStatus();
  const [pressed, setPressed] = useState(false);

  // The form settled — the label goes back to what the server rendered. This is
  // the snap back: a refused action leaves no success on screen.
  useEffect(() => {
    if (!pending) setPressed(false);
  }, [pending]);

  return (
    <button
      type="submit"
      name={name}
      value={value}
      title={title}
      aria-label={ariaLabel}
      disabled={pending || disabled}
      aria-busy={pending}
      className={`${className} disabled:cursor-not-allowed`}
      onClick={() => setPressed(true)}
    >
      {pending && pressed ? (optimisticText ?? pendingText) : children}
    </button>
  );
}
