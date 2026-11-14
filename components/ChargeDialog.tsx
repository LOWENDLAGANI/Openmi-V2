"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import { MOTION_EASE, useReducedMotion } from "@/components/Motion";
import { gsap } from "gsap";
import { formatDew } from "@/lib/dew";

/**
 * The confirmation a new chat's first message asks for: one hour, charged once.
 *
 * It is a question about money, so it shows the price, the balance it will
 * spend, and — when the daily balance cannot cover the price but the wallet can
 * — that the two will be combined. When neither covers it, no charge button is
 * rendered at all: there is nothing to confirm, and a disabled button would only
 * invite a click that cannot work.
 */
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
  // Hooks run before the early return so the dialog animates on open and the
  // refs stay stable across a close.
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
        { autoAlpha: 0, y: 14, scale: 0.98 },
        {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          duration: 0.26,
          ease: MOTION_EASE,
          clearProps: "transform,visibility,opacity",
        },
        0.06
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
      className="fixed inset-0 z-50 grid place-items-center bg-black/45 px-4"
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="charge-heading"
        className="w-full max-w-sm rounded-3xl border border-line bg-card p-5 shadow-[0_28px_60px_-30px_rgba(0,0,0,0.65)]"
      >
        <h2
          id="charge-heading"
          className="mt-1 text-[17px] font-semibold tracking-[-0.02em] text-hi"
        >
          Start an hour of chat?
        </h2>

        <p className="mt-2 text-[11.5px] leading-relaxed text-mid">
          {formatDew(balance)} Dew balance
          {wallet > 0 ? ` · ${formatDew(wallet)} Dew wallet` : ""}
        </p>

        {canStart ? (
          <div className="mt-4 space-y-2">
            <button
              type="button"
              disabled={pending}
              onClick={onConfirm}
              className="lift flex w-full items-center justify-between rounded-2xl border border-accent/40 bg-accent-soft px-4 py-3 text-left disabled:opacity-60"
            >
              <span>
                <span className="block text-[12.5px] font-semibold text-hi">
                  1 hour session
                </span>
                {combined && (
                  <span className="mt-0.5 block text-[10.5px] text-mid">
                    wallet covers the rest
                  </span>
                )}
              </span>
              <span className="font-mono text-[12px] text-accent-text">
                {formatDew(hourPrice)} Dew
              </span>
            </button>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-warn/30 bg-warn/8 px-4 py-3">
            <p className="text-[11.5px] leading-relaxed text-warn">
              Not enough Dew.
            </p>
            <Link
              href="/pay"
              className="btn mt-2 px-3 py-1.5 text-[11.5px]"
            >
              Dew wallet
            </Link>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-2">
          <p className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-low">
            charged once
          </p>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="text-[11.5px] text-mid hover:text-hi disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
