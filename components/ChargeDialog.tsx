"use client";

import { gsap } from "gsap";
import Link from "next/link";
import { useEffect, useRef } from "react";

import { MOTION_EASE, useReducedMotion } from "@/components/Motion";
import { formatCredit } from "@/lib/credits";

export function ChargeDialog({
  open,
  balance,
  wallet,
  hourPrice,
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  balance: number;
  wallet: number;
  hourPrice: number;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const backdrop = useRef<HTMLDivElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!open || reduced) return;

    const timeline = gsap.timeline();

    if (backdrop.current) {
      timeline.fromTo(
        backdrop.current,
        { autoAlpha: 0 },
        { autoAlpha: 1, duration: 0.18, ease: MOTION_EASE },
        0
      );
    }

    if (panel.current) {
      timeline.fromTo(
        panel.current,
        { autoAlpha: 0, y: 12, scale: 0.98 },
        {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          duration: 0.24,
          ease: MOTION_EASE,
          clearProps: "transform,visibility,opacity",
        },
        0.04
      );
    }

    return () => {
      timeline.kill();
    };
  }, [open, reduced]);

  if (!open) return null;

  const total = balance + wallet;
  const canStart = total >= hourPrice;
  const combined = balance < hourPrice && total >= hourPrice;

  return (
    <div
      ref={backdrop}
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-4 backdrop-blur-[2px]"
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="charge-heading"
        className="w-full max-w-sm rounded-xl border border-line-strong bg-card p-5 shadow-[0_28px_64px_-24px_rgba(0,0,0,0.65)]"
      >
        <h2
          id="charge-heading"
          className="text-[17px] font-semibold tracking-[-0.02em] text-hi"
        >
          Start an hour of chat?
        </h2>

        <p className="mt-1.5 font-mono text-[12px] tabular-nums text-mid">
          {formatCredit(balance)} Credit balance
          {wallet > 0 ? ` · ${formatCredit(wallet)} Credit wallet` : ""}
        </p>

        {canStart ? (
          <div className="mt-4 space-y-2">
            <button
              type="button"
              disabled={pending}
              onClick={onConfirm}
              className="flex w-full items-center justify-between rounded-lg border border-accent/40 bg-accent-soft px-4 py-3 text-left transition-colors hover:border-accent disabled:opacity-60"
            >
              <span>
                <span className="block text-[13px] font-semibold text-hi">
                  1 hour session
                </span>
                {combined && (
                  <span className="mt-0.5 block text-[11px] text-mid">
                    Wallet covers the remainder
                  </span>
                )}
              </span>
              <span className="font-mono text-[12.5px] font-semibold tabular-nums text-accent-text">
                {formatCredit(hourPrice)} Credit
              </span>
            </button>
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-warn/30 bg-warn/8 px-4 py-3">
            <p className="text-[12.5px] leading-relaxed text-warn">
              Not enough Credit to start this hour.
            </p>
            <Link
              href="/pay"
              className="btn mt-2.5 px-3 py-1.5 text-[12px]"
            >
              Top up Credit
            </Link>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3">
          <p className="text-[11.5px] text-low">Charged once per hour</p>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="btn btn-quiet px-2.5 py-1 text-[12px] disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
