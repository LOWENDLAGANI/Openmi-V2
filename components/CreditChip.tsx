"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { CREDIT_PER_HOUR, formatCredit, isLowBalance } from "@/lib/credits";

/** The balance the chat stream publishes the moment a charge lands. */
export const CREDIT_EVENT = "openmi:credit";

export type CreditUpdate = { balance: number; wallet?: number };

/**
 * The Credit chip in the header.
 *
 * The server renders the balance the page was built with, but a turn charges
 * before it answers, so waiting for a re-render leaves a stale number on screen
 * for the length of a model call. The chat stream publishes the balance the
 * charge produced as a window event and this chip shows it at once. The server
 * value still wins whenever it changes: the event is a hint, the profile row is
 * the truth.
 */
export function CreditChip({
  initialBalance,
  initialWallet,
}: {
  initialBalance: number;
  initialWallet: number;
}) {
  const [balance, setBalance] = useState(initialBalance);
  const [wallet, setWallet] = useState(initialWallet);

  // A refresh re-renders the server component with the read balance; adopt it
  // rather than keep a number the database has already moved past.
  useEffect(() => {
    setBalance(initialBalance);
    setWallet(initialWallet);
  }, [initialBalance, initialWallet]);

  useEffect(() => {
    const onCredit = (event: Event) => {
      const detail = (event as CustomEvent<Partial<CreditUpdate>>).detail;
      if (!detail) return;

      const next = Number(detail.balance);
      if (Number.isFinite(next)) setBalance(next);

      const nextWallet = Number(detail.wallet);
      if (Number.isFinite(nextWallet)) setWallet(nextWallet);
    };

    window.addEventListener(CREDIT_EVENT, onCredit);
    return () => window.removeEventListener(CREDIT_EVENT, onCredit);
  }, []);

  const low = isLowBalance(balance);

  return (
    <Link
      href="/activity"
      title={`${CREDIT_PER_HOUR} Credit per hour. Wallet ${formatCredit(wallet)}.`}
      className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[10.5px] ${
        low ? "border-warn/35 bg-warn/8 text-warn" : "border-line bg-card text-low"
      }`}
    >
      <span aria-hidden="true" className="size-1 rounded-full bg-current" />
      credit {formatCredit(balance)}
    </Link>
  );
}
