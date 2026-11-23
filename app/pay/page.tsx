import { ArrowLeft, ArrowUpRight, Check, Receipt } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AdBanner } from "@/components/AdBanner";
import { Brand } from "@/components/Brand";
import { ReceiptWave } from "@/components/ReceiptWave";
import { StatusPill, type StatusTone } from "@/components/StatusPill";
import { SubmitButton } from "@/components/SubmitButton";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import {
  COUNTRY_COOKIE,
  COUNTRY_OPTIONS,
  currencyForCountry,
  formatMoney,
  isConverted,
} from "@/lib/billing/currency";
import {
  PAID_BENEFITS,
  PLANS,
  TOPUP_PAUSED,
  paymentLink,
  planById,
} from "@/lib/billing/plans";
import { getMyrRates, withLiveRate } from "@/lib/billing/rates";
import {
  DAILY_FREE_CREDIT,
  formatCredit,
  formatPassDate,
  formatPassRemaining,
} from "@/lib/credits";
import { readCreditProfile, refillDailyCredit } from "@/lib/credits/store";
import { getSession } from "@/lib/session";
import { setCountry, submitReceipt } from "./actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Plans & billing — Openmi",
};

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  pending: { label: "pending", tone: "pending" },
  approved: { label: "approved", tone: "ok" },
  rejected: { label: "rejected", tone: "missing" },
};

type RequestRow = {
  id: string;
  plan: string;
  amount: number | string;
  reference: string;
  note: string | null;
  receipt_path: string;
  receipt_name: string | null;
  status: string;
  credit_granted: number | null;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
};

function utc(value: string | null): string {
  if (!value) return "—";
  return value.slice(0, 16).replace("T", " ");
}

export default async function PayPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    submitted?: string;
    credit?: string;
    country?: string;
  }>;
}) {
  const params = await searchParams;
  const session = await getSession();

  if (session.state === "unconfigured") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
        <div className="panel p-6">
          <p className="text-[12px] font-medium text-low">Unavailable</p>
          <h1 className="mt-1.5 text-[22px] font-semibold tracking-[-0.02em] text-hi">
            Openmi is unavailable right now
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-mid">
            We can&apos;t load plans and receipts at the moment. Try again in a
            few minutes.
          </p>
        </div>
      </main>
    );
  }

  if (session.state === "signed-out") redirect("/login?next=%2Fpay");
  if (session.state === "banned") redirect("/banned");

  const { supabase, user } = session;

  await refillDailyCredit(supabase);

  const [profile, requestsResult] = await Promise.all([
    readCreditProfile(supabase, user.id),
    supabase
      .from("payment_requests")
      .select(
        "id, plan, amount, reference, note, receipt_path, receipt_name, status, credit_granted, decision_note, created_at, decided_at"
      )
      .eq("owner", user.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const requests = (requestsResult.data ?? []) as RequestRow[];
  const pending = requests.filter((row) => row.status === "pending").length;

  const receipts = new Map<string, string>();
  await Promise.all(
    requests.slice(0, 10).map(async (row) => {
      const { data } = await supabase.storage
        .from("receipts")
        .createSignedUrl(row.receipt_path, 300);
      if (data?.signedUrl) receipts.set(row.id, data.signedUrl);
    })
  );

  const cookieStore = await cookies();
  const country = cookieStore.get(COUNTRY_COOKIE)?.value ?? null;
  const base = currencyForCountry(country);
  const currency = withLiveRate(base, await getMyrRates());
  const live = currency !== base;
  const localPrices = isConverted(currency);
  const link = paymentLink();

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-4xl items-center justify-between gap-3 px-5 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/chat" aria-label="Back to chats">
              <Brand compact />
            </Link>
            <span aria-hidden="true" className="text-line-strong">
              /
            </span>
            <h1 className="truncate text-[14px] font-semibold tracking-[-0.02em] text-hi">
              Plans &amp; billing
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <ThemeSwitcher variant="icon" />
            <Link href="/chat" className="btn gap-1.5 px-3 py-1.5 text-[12px]">
              <ArrowLeft aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
              <span>Workspace</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="animate-enter mx-auto w-full max-w-4xl px-5 py-8 sm:px-8">
        {params.error && (
          <p
            role="alert"
            className="mb-5 rounded-lg border border-danger/30 bg-danger/8 px-4 py-2.5 text-[12.5px] text-danger"
          >
            {params.error}
          </p>
        )}

        {params.submitted === "1" && (
          <p
            role="status"
            className="mb-5 rounded-lg border border-accent/30 bg-accent-soft px-4 py-2.5 text-[12.5px] text-accent-text"
          >
            Receipt received. It is pending until we review it; the status below
            updates in place.
          </p>
        )}

        {params.credit && (
          <p
            role="status"
            className="mb-5 rounded-lg border border-accent/30 bg-accent-soft px-4 py-2.5 text-[12.5px] text-accent-text"
          >
            {params.credit}
          </p>
        )}

        <section className="panel p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[12px] font-medium text-low">Current balance</p>
              <p className="mt-1.5 font-mono text-[clamp(2rem,4.5vw,2.6rem)] font-semibold leading-none tracking-[-0.03em] tabular-nums text-hi">
                {formatCredit(profile?.balance ?? 0)}{" "}
                <span className="font-sans text-[14px] font-medium text-low">
                  Credit
                </span>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {pending > 0 && (
                <StatusPill tone="pending">
                  {pending} receipt{pending === 1 ? "" : "s"} pending
                </StatusPill>
              )}
              <StatusPill tone={profile?.paidActive ? "ok" : "optional"}>
                {profile?.paidActive && profile.paidUntil
                  ? `Pass active until ${formatPassDate(profile.paidUntil, profile.timezone) ?? "—"}`
                  : "Free tier"}
              </StatusPill>
            </div>
          </div>

          <p className="mt-4 max-w-2xl text-[13px] leading-relaxed text-mid">
            {TOPUP_PAUSED
              ? "Checkout is paused while the payment path is tested. No payment is accepted and the upload form is closed; a redeem code still adds Credit."
              : "Payment happens on Sociabuzz, outside this app. Complete payment, keep your receipt, and upload it below. Approval credits your balance and activates or extends your pass."}
          </p>

          {profile?.paidUntil && (
            <p className="mt-2 text-[12px] leading-relaxed text-low">
              {profile.paidActive
                ? `Your pass ends ${formatPassDate(profile.paidUntil, profile.timezone) ?? "—"} (${formatPassRemaining(profile.paidUntil)}).`
                : `Your last pass ended ${formatPassDate(profile.paidUntil, profile.timezone) ?? "—"}. The daily allowance is back to ${DAILY_FREE_CREDIT} Credit.`}
            </p>
          )}

          <div className="mt-5 grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
            <div className="rounded-lg border border-line bg-raised px-4 py-3">
              <p className="text-[11.5px] font-medium text-low">Wallet Credit</p>
              <p className="mt-1 font-mono text-[18px] font-semibold leading-none tabular-nums text-hi">
                {formatCredit(profile?.wallet ?? 0)}{" "}
                <span className="font-sans text-[12px] font-normal text-low">
                  Credit
                </span>
              </p>
            </div>

            <ul className="space-y-2 text-[12.5px] text-mid">
              {PAID_BENEFITS.map((benefit) => (
                <li key={benefit} className="flex items-start gap-2">
                  <Check
                    aria-hidden="true"
                    className="mt-0.5 size-3.5 shrink-0 text-accent-text"
                    strokeWidth={2}
                  />
                  <span>{benefit}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <AdBanner className="mt-6" />

        <section aria-labelledby="plans-heading" className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2
                id="plans-heading"
                className="text-[17px] font-semibold tracking-[-0.02em] text-hi"
              >
                Passes
              </h2>
              <p className="mt-0.5 text-[12.5px] text-mid">
                Fixed-term passes that never auto-renew.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <form action={setCountry} className="flex items-center gap-1.5">
                <select
                  name="country"
                  defaultValue={country ?? ""}
                  className="field w-auto py-1.5 text-[12px]"
                  aria-label="Choose your country for the price estimate"
                >
                  <option value="">Currency (MYR)</option>
                  {COUNTRY_OPTIONS.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.name} ({option.currency})
                    </option>
                  ))}
                </select>
                <button type="submit" className="btn px-3 py-1.5 text-[12px]">
                  Update
                </button>
              </form>

              {TOPUP_PAUSED ? (
                <span className="rounded-lg border border-line bg-raised px-3 py-1.5 text-[12px] font-medium text-low">
                  Checkout paused
                </span>
              ) : (
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary gap-1.5 px-3.5 py-1.5 text-[12.5px]"
                >
                  <span>Pay on Sociabuzz</span>
                  <ArrowUpRight aria-hidden="true" className="size-3.5" strokeWidth={2} />
                </a>
              )}
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {PLANS.map((plan) => (
              <div
                key={plan.id}
                className="panel flex flex-col justify-between p-5"
              >
                <div>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-[15px] font-semibold text-hi">{plan.name}</p>
                    <p
                      className="font-mono text-[13px] font-medium tabular-nums text-mid"
                      title={`Charged as RM ${plan.price} on the payment page`}
                    >
                      {localPrices
                        ? `≈ ${formatMoney(plan.price, currency)}`
                        : `RM ${plan.price}`}
                    </p>
                  </div>

                  <p className="mt-3 font-mono text-[26px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-accent-text">
                    {plan.credit}
                    <span className="ml-1.5 font-sans text-[13px] font-medium text-low">
                      Credit · {plan.days} days
                    </span>
                  </p>
                </div>
              </div>
            ))}
          </div>

          {localPrices && (
            <p className="mt-3 text-[12px] leading-relaxed text-low">
              {`≈ ${currency.name} at ${live ? "today's exchange rate" : "an indicative rate"}. The hosted page charges Malaysian ringgit.`}
            </p>
          )}
        </section>

        {!TOPUP_PAUSED && (
          <section aria-labelledby="receipt-heading" className="panel mt-8 p-6">
            <div className="flex items-center gap-2">
              <Receipt aria-hidden="true" className="size-4 text-accent-text" strokeWidth={1.75} />
              <h2
                id="receipt-heading"
                className="text-[16px] font-semibold tracking-[-0.02em] text-hi"
              >
                Upload a receipt
              </h2>
            </div>

            <form action={submitReceipt} className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-body">
                  Plan
                </span>
                <select
                  name="plan"
                  defaultValue={PLANS[0]?.id}
                  className="field py-2 text-[12.5px]"
                >
                  {PLANS.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name} — {plan.credit} Credit
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-body">
                  Amount paid (RM)
                </span>
                <input
                  name="amount"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder={String(PLANS[0]?.price ?? "")}
                  className="field py-2 font-mono text-[12.5px]"
                />
              </label>

              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-[12px] font-medium text-body">
                  Transaction reference
                </span>
                <input
                  name="reference"
                  required
                  maxLength={120}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Reference ID or sender name from the payment page"
                  className="field py-2 text-[12.5px]"
                />
              </label>

              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-[12px] font-medium text-body">
                  Note <span className="font-normal text-low">(optional)</span>
                </span>
                <input
                  name="note"
                  maxLength={500}
                  className="field py-2 text-[12.5px]"
                  placeholder="Anything we should know"
                />
              </label>

              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-[12px] font-medium text-body">
                  Receipt file
                </span>
                <input
                  name="receipt"
                  type="file"
                  required
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  className="field w-full max-w-full cursor-pointer py-1.5 text-[12px] file:mr-3 file:max-w-[45%] file:truncate file:rounded-md file:border file:border-line file:bg-raised file:px-2.5 file:py-1 file:text-[11.5px] file:font-medium file:text-body"
                />
                <span className="mt-1.5 block text-[11px] text-low">
                  PNG, JPEG, WebP, or PDF up to 5 MB.
                </span>
              </label>

              <ReceiptWave>
                <SubmitButton
                  className="btn btn-primary py-2.5 text-[13px] sm:col-span-2"
                  optimisticText="Sent for review"
                  pendingText="Uploading the receipt…"
                >
                  Submit receipt
                </SubmitButton>
              </ReceiptWave>
            </form>
          </section>
        )}

        <section aria-labelledby="requests-heading" className="panel mt-6 overflow-hidden">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-raised px-5 py-3.5">
            <h2
              id="requests-heading"
              className="text-[14.5px] font-semibold tracking-[-0.015em] text-hi"
            >
              Your requests
            </h2>
            <p className="font-mono text-[11.5px] tabular-nums text-low">
              {requests.length} total · newest first
            </p>
          </div>

          {requests.length === 0 ? (
            <p className="px-5 py-5 text-[12.5px] leading-relaxed text-mid">
              {TOPUP_PAUSED
                ? "No receipts yet. Uploads are paused while checkout is being tested, so nothing is waiting for review."
                : "No receipts yet. Pay on Sociabuzz, then upload your proof above."}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {requests.map((row) => {
                const plan = planById(row.plan);
                const state = STATUS[row.status] ?? STATUS.pending;
                const receipt = receipts.get(row.id);

                return (
                  <li key={row.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <p className="text-[13.5px] font-semibold text-hi">
                          {plan?.name ?? row.plan}
                        </p>
                        <span className="font-mono text-[11.5px] tabular-nums text-low">
                          RM {Number(row.amount).toFixed(2)} · {utc(row.created_at)}
                        </span>
                      </div>
                      <StatusPill tone={state.tone}>{state.label}</StatusPill>
                    </div>

                    <p className="mt-1.5 break-all font-mono text-[11.5px] text-low">
                      ref {row.reference}
                    </p>

                    {row.status === "approved" && row.credit_granted !== null && (
                      <p className="mt-1.5 font-mono text-[12px] font-medium text-accent-text">
                        +{row.credit_granted} Credit granted
                      </p>
                    )}

                    {row.decision_note && (
                      <p className="mt-1.5 text-[12px] leading-relaxed text-mid">
                        Operator: {row.decision_note}
                      </p>
                    )}

                    {receipt ? (
                      <a
                        href={receipt}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-accent-text hover:underline"
                      >
                        <span>View receipt</span>
                        <ArrowUpRight aria-hidden="true" className="size-3" strokeWidth={1.75} />
                      </a>
                    ) : (
                      <p className="mt-1.5 break-all text-[11.5px] text-low">
                        {row.receipt_name ?? "receipt"}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <p className="mt-6 max-w-2xl text-[12px] leading-relaxed text-low">
          Approval is recorded against your receipt and Credit moves through the
          same append-only ledger as every other balance change. A rejected
          receipt retains its operator note and can be resubmitted with a
          corrected reference.
        </p>
      </main>
    </div>
  );
}
