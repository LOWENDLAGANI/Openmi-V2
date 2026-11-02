"use client";

/**
 * A submit button that asks before doing something irreversible. Deliberately
 * a native confirm: the destructive actions are rare, and a custom dialog would
 * be more code than the risk justifies.
 */
export function ConfirmSubmit({
  message,
  children,
  className,
}: {
  message: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
