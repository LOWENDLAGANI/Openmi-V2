"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import { MOTION_EASE, useReducedMotion } from "@/components/Motion";
import { gsap } from "gsap";
import { formatDew } from "@/lib/dew";

export type ChargeMode = "hour" | "request";

/**
 * The choice a new chat's first message asks for: one hour, or this message.
 *
 * It is a question about money, so it shows the two prices, the balance it will
 * spend, and — when the daily balance cannot cover a price but the wallet can —
 * that the two will be combined. When neither covers either price, no charge
 * button is rendered at all: there is nothing to choose, and a disabled button
 * would only invite a click that cannot work.
 */
export function ChargeDialog({
  open,
  balance,
  wallet,
  hourPrice,
  requestPrice,
  pending,
  onChoose,
  onCancel,
}: {
  open: boolean;
  balance: number;
  wallet: number;
  hourPrice: number;
  requestPrice: number;
  pending: boolean;
  onChoose: (mode: ChargeMode) => void;
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
  const canHour = total >= hourPrice;
  const canRequest = total >= requestPrice;
  const anything = canHour || canRequest;

  const combined = (price: number) => balance < price && total >= price;

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
        <p className="eyebrow">how to pay</p>
        <h2
          id="charge-heading"
          className="mt-1 text-[17px] font-semibold tracking-[-0.02em] text-hi"
        >
          One hour, or this message?
        </h2>

        <p className="mt-2 text-[11.5px] leading-relaxed text-mid">
          {formatDew(balance)} Dew balance
          {wallet > 0 ? ` · ${formatDew(wallet)} Dew wallet` : ""}. An hour covers
          every message in this chat until it ends; a single request covers only
          this one.
        </p>

        {anything ? (
          <div className="mt-4 space-y-2">
            {canHour && (
              <button
                type="button"
                disabled={pending}
                onClick={() => onChoose("hour")}
                className="lift flex w-full items-center justify-between rounded-2xl border border-accent/40 bg-accent-soft px-4 py-3 text-left disabled:opacity-60"
              >
                <span>
                  <span className="block text-[12.5px] font-semibold text-hi">
                    1 hour session
                  </span>
                  <span className="mt-0.5 block text-[10.5px] text-mid">
                    every message in this chat for an hour
                    {combined(hourPrice) ? " · wallet covers the rest" : ""}
                  </span>
                </span>
                <span className="font-mono text-[12px] text-accent-text">
                  {formatDew(hourPrice)} Dew
                </span>
              </button>
            )}

            {canRequest && (
              <button
                type="button"
                disabled={pending}
                onClick={() => onChoose("request")}
                className="lift flex w-full items-center justify-between rounded-2xl border border-line-strong bg-raised px-4 py-3 text-left disabled:opacity-60"
              >
                <span>
                  <span className="block text-[12.5px] font-semibold text-hi">
                    This message only
                  </span>
                  <span className="mt-0.5 block text-[10.5px] text-mid">
                    cheapest for one question
                    {combined(requestPrice) ? " · wallet covers the rest" : ""}
                  </span>
                </span>
                <span className="font-mono text-[12px] text-hi">
                  {formatDew(requestPrice)} Dew
                </span>
              </button>
            )}
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-warn/30 bg-warn/8 px-4 py-3">
            <p className="text-[11.5px] leading-relaxed text-warn">
              Not enough Dew for either option. Redeem a code or wait for the
              daily refill.
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
