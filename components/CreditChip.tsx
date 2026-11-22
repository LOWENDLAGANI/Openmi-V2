"use client";

import { Coins } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { CREDIT_PER_HOUR, formatCredit, isLowBalance } from "@/lib/credits";

/** The balance the chat stream publishes the moment a charge lands. */
export const CREDIT_EVENT = "openmi:credit";

export type CreditUpdate = { balance: number; wallet?: number };

export function CreditChip({
  initialBalance,
  initialWallet,
}: {
  initialBalance: number;
  initialWallet: number;
}) {
  const [balance, setBalance] = useState(initialBalance);
  const [wallet, setWallet] = useState(initialWallet);

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
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium tabular-nums transition-colors ${
        low
          ? "border-warn/35 bg-warn/10 text-warn hover:border-warn/60"
          : "border-line bg-card text-mid hover:border-line-strong hover:text-hi"
      }`}
    >
      <Coins aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.75} />
      <span>{formatCredit(balance)} Credit</span>
    </Link>
  );
}
