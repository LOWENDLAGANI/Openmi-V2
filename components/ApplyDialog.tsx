"use client";

import { useEffect, useRef, useState } from "react";

import { applyNow, markReviewed, rejectChangeset } from "@/app/chat/actions";
import { useOptimisticAction } from "@/components/useOptimisticAction";

/**
 * The question an AI change asks before it touches the code.
 *
 * The card decides whether the question is needed at all: a clean, reviewed,
 * small change on the commit it was suggested against applies with one click. A
 * change against a moved head, one touching more than five files, one touching
 * configuration, credentials or the schema, or one nobody has looked at yet
 * stops here first.
 *
 * Every option says what it actually does. "Review first" changes nothing but
 * the review flag, "Cancel" only discards the suggestion, and "Apply now" says
 * that the change is brought up to date when the code has moved — because that
 * is what happens, and a failure to do it is reported as a failure rather than
 * as an apply.
 */

type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

type Choice = "apply" | "review" | "cancel";

export function ApplyDialog({
  open,
  changesetId,
  remember = false,
  onClose,
}: {
  open: boolean;
  changesetId: string;
  /** The card's "don't ask again" choice, carried through the dialog. */
  remember?: boolean;
  onClose: () => void;
}) {
  const [pending, setPending] = useState<Choice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const applyRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    applyRef.current?.focus();
  }, [open]);

  if (!open) return null;

  // The chosen option answers the click at once — its label says what it was
  // asked to do — and the dialog only closes when the action confirmed it. A
  // failure re-enables every option with the server's sentence beside them.
  async function choose(choice: Choice) {
    if (pending !== null) return;

    setPending(choice);
    setError(null);

    let result: ActionResult;

    try {
      if (choice === "apply") {
        result = await applyNow(changesetId, remember);
      } else if (choice === "review") {
        result = await markReviewed(changesetId);
      } else {
        result = await rejectChangeset(changesetId);
      }
    } catch {
      setPending(null);
      setError("That did not reach the server. Try again.");
      return;
    }

    setPending(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="apply-heading"
        className="w-full max-w-md rounded-3xl border border-line bg-card p-5 shadow-[0_28px_60px_-30px_rgba(0,0,0,0.65)]"
      >
        <p className="eyebrow">one question</p>
        <h2
          id="apply-heading"
          className="mt-1 text-[17px] font-semibold tracking-[-0.02em] text-hi"
        >
          Apply this change?
        </h2>

        {error && (
          <p
            role="alert"
            className="mt-3 rounded-2xl border border-danger/25 bg-danger/8 px-3 py-2 text-[11px] leading-relaxed text-danger"
          >
            {error}
          </p>
        )}

        <div className="mt-4 space-y-2">
          <button
            ref={applyRef}
            type="button"
            autoFocus
            disabled={pending !== null}
            onClick={() => void choose("apply")}
            className="lift w-full rounded-2xl border border-accent/40 bg-accent-soft px-4 py-3 text-left disabled:opacity-60"
          >
            <span className="block text-[12.5px] font-semibold text-hi">
              {pending === "apply" ? "Applied" : "Apply now"}
            </span>
            <span className="mt-1 block text-[11px] leading-relaxed text-mid">
              Adds the change to your code. If your code has changed since the
              suggestion, Openmi updates the change first.
            </span>
          </button>

          <button
            type="button"
            disabled={pending !== null}
            onClick={() => void choose("review")}
            className="w-full rounded-2xl border border-line bg-raised px-4 py-3 text-left hover:bg-hover disabled:opacity-60"
          >
            <span className="block text-[12.5px] font-semibold text-hi">
              {pending === "review" ? "Showing" : "Review first"}
            </span>
            <span className="mt-1 block text-[11px] leading-relaxed text-mid">
              Shows the change again so you can look it over. Nothing is applied
              yet.
            </span>
          </button>

          <button
            type="button"
            disabled={pending !== null}
            onClick={() => void choose("cancel")}
            className="w-full rounded-2xl border border-line bg-card px-4 py-3 text-left hover:bg-hover disabled:opacity-60"
          >
            <span className="block text-[12.5px] font-semibold text-hi">
              {pending === "cancel" ? "Discarded" : "Cancel"}
            </span>
            <span className="mt-1 block text-[11px] leading-relaxed text-mid">
              Discards this suggestion. The AI can propose again later.
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The card's apply button.
 *
 * When the change needs a second look it opens the dialog; otherwise the click
 * applies the change immediately, which is the whole point of asking only when
 * something about the change warrants it.
 */
export function ApplyControl({
  changesetId,
  acceptedCount,
  chatBranch,
  confirmFirst,
}: {
  changesetId: string;
  acceptedCount: number;
  chatBranch: string | null;
  confirmFirst: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The click paints "Applied" and takes the lock in the same frame. The card
  // itself changes when the action revalidates; if the write is refused, the
  // label snaps back to "Apply changes" next to the reason it was refused.
  const apply = useOptimisticAction<"idle" | "applied">({
    value: "idle",
    optimistic: "applied",
    action: async () => {
      const result = await applyNow(changesetId, remember);
      if (!result.ok) setError(result.error);
      return result;
    },
  });

  function start() {
    setError(null);

    if (confirmFirst) {
      setOpen(true);
      return;
    }

    apply.run();
  }

  return (
    <div className="space-y-3 border-t border-line pt-3">
      <label className="flex items-start gap-2 text-[11px] leading-relaxed text-body">
        <input
          type="checkbox"
          name="remember"
          value="1"
          checked={remember}
          onChange={(event) => setRemember(event.target.checked)}
          className="mt-0.5 size-3 accent-current"
        />
        <span>
          Apply and don&apos;t ask again for{" "}
          <span className="font-mono">{chatBranch ?? "main"}</span>. Future
          suggestions here are applied without this step.
        </span>
      </label>

      {error && (
        <p
          role="alert"
          className="rounded-2xl border border-danger/25 bg-danger/8 px-4 py-2.5 text-[11px] leading-relaxed text-danger"
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-md text-[11px] leading-relaxed text-low">
          {acceptedCount === 0
            ? "No files accepted."
            : `${acceptedCount} file(s) accepted.`}
        </p>

        {acceptedCount > 0 && (
          <button
            type="button"
            disabled={apply.pending}
            aria-busy={apply.pending}
            onClick={start}
            className={`btn btn-primary px-4 py-1.5 text-[11.5px] disabled:cursor-not-allowed ${apply.snapped ? "snap-back" : ""}`}
          >
            {apply.state === "applied" ? "Applied" : "Apply changes"}
          </button>
        )}
      </div>

      <ApplyDialog
        open={open}
        changesetId={changesetId}
        remember={remember}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
