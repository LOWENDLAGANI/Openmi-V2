import { cookies, headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AdBanner } from "@/components/AdBanner";
import { Brand } from "@/components/Brand";
import { CountryHint } from "@/components/CountryHint";
import { StatusPill, type StatusTone } from "@/components/StatusPill";
import { SubmitButton } from "@/components/SubmitButton";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import {
  COUNTRY_COOKIE,
  countryFromRequest,
  currencyForCountry,
  formatMoney,
  isConverted,
} from "@/lib/billing/currency";
import { getMyrRates, withLiveRate } from "@/lib/billing/rates";
import {
  PAID_BENEFITS,
  PLANS,
  TOPUP_PAUSED,
  paymentLink,
  planById,
} from "@/lib/billing/plans";
import { DAILY_FREE_DEW, formatDew, formatPassRemaining } from "@/lib/dew";
import { readDewProfile, refillDailyDew } from "@/lib/dew/store";
import { getSession } from "@/lib/session";
import { submitReceipt } from "./actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Plans & receipts — Openmi",
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
  dew_granted: number | null;
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
  searchParams: Promise<{ error?: string; submitted?: string; dew?: string }>;
}) {
  const params = await searchParams;
  const session = await getSession();

  if (session.state === "unconfigured") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
        <p className="eyebrow">unavailable</p>
        <h1 className="mt-2 text-[24px] font-semibold tracking-[-0.02em] text-hi">
          Openmi is unavailable right now
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          We can&apos;t load plans and receipts at the moment. Try again in a few
          minutes.
        </p>
      </main>
    );
  }

  if (session.state === "signed-out") redirect("/login?next=%2Fpay");

  const { supabase, user } = session;

  // Settle the local day before reading the balance the next turn will use.
  await refillDailyDew(supabase);

  const [profile, requestsResult] = await Promise.all([
    readDewProfile(supabase, user.id),
    supabase
      .from("payment_requests")
      .select(
        "id, plan, amount, reference, note, receipt_path, receipt_name, status, dew_granted, decision_note, created_at, decided_at"
      )
      .eq("owner", user.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const requests = (requestsResult.data ?? []) as RequestRow[];
  const pending = requests.filter((row) => row.status === "pending").length;

  // Signed links only for this account's own objects; the storage policy allows
  // the owner to read them, so no service role is involved on this page.
  const receipts = new Map<string, string>();
  await Promise.all(
    requests.slice(0, 10).map(async (row) => {
      const { data } = await supabase.storage
        .from("receipts")
        .createSignedUrl(row.receipt_path, 300);
      if (data?.signedUrl) receipts.set(row.id, data.signedUrl);
    })
  );

  // Country detection, in order: the host's geo header, the browser region the
  // hint cookie remembered, then the request's own language tag. The client hint
  // is written only when all three are absent, so a real IP lookup always wins.
  const requestHeaders = await headers();
  const cookieStore = await cookies();
  const country = countryFromRequest(
    requestHeaders,
    cookieStore.get(COUNTRY_COOKIE)?.value
  );
  const base = currencyForCountry(country);
  const currency = withLiveRate(base, await getMyrRates());
  const live = currency !== base;
  const localPrices = isConverted(currency);
  const link = paymentLink();

  return (
    <main className="animate-enter mx-auto w-full max-w-4xl px-5 py-8 sm:px-8">
      <CountryHint needed={country === null} />

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/chat" aria-label="Back to chats">
            <Brand compact />
          </Link>
          <span aria-hidden="true" className="h-4 w-px bg-line-strong" />
          <div>
            <p className="eyebrow">plans</p>
            <h1 className="text-[17px] font-semibold tracking-[-0.02em] text-hi">
              Plans
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ThemeSwitcher />
          <Link href="/chat" className="btn px-3.5 py-1.5 text-[12px]">
            Back to chats
          </Link>
        </div>
      </header>

      {params.error && (
        <p
          role="alert"
          className="mt-5 rounded-2xl border border-danger/25 bg-danger/8 px-4 py-2.5 text-[12px] text-danger"
        >
          {params.error}
        </p>
      )}

      {params.submitted === "1" && (
        <p
          role="status"
          className="mt-5 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-2.5 text-[12px] text-accent-text"
        >
          Receipt received. It is pending until we review it; the status below
          updates in place.
        </p>
      )}

      {params.dew && (
        <p
          role="status"
          className="mt-5 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-2.5 text-[12px] text-accent-text"
        >
          {params.dew}
        </p>
      )}

      <section className="mt-6 rounded-3xl border border-line bg-card px-5 py-6 sm:px-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">balance</p>
            <p className="mt-1 text-[clamp(2rem,5vw,2.7rem)] font-semibold leading-none tracking-[-0.04em] tabular-nums text-hi">
              {formatDew(profile?.balance ?? 0)}{" "}
              <span className="text-[0.42em] font-medium uppercase tracking-[0.08em] text-low">
                dew
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
                ? `paid until ${profile.paidUntil.slice(0, 10)}`
                : "free tier"}
            </StatusPill>
          </div>
        </div>

        <p className="mt-3 max-w-xl text-[12px] leading-relaxed text-mid">
          {TOPUP_PAUSED
            ? "Checkout is paused while the payment path is tested, so no new payment is accepted and the upload form is closed. The plans below are the ones that exist; a redeem code still adds Dew."
            : "Payment happens on Sociabuzz, not here. Pay, keep the receipt, then upload it below. Approval adds the pass's Dew and starts or extends the paid daily allowance."}
        </p>

        {profile?.paidUntil && (
          <p className="mt-2 max-w-xl text-[11.5px] leading-relaxed text-low">
            {profile.paidActive
              ? `Your pass ends ${profile.paidUntil.slice(0, 10)} — ${formatPassRemaining(profile.paidUntil)}.`
              : `Your last pass ended ${profile.paidUntil.slice(0, 10)}. The daily allowance is back to ${DAILY_FREE_DEW} Dew.`}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-raised px-4 py-3">
          <div>
            <p className="eyebrow">wallet credit</p>
            <p className="mt-0.5 font-mono text-[16px] leading-none tabular-nums text-hi">
              {formatDew(profile?.wallet ?? 0)}{" "}
              <span className="text-[10px] uppercase tracking-[0.1em] text-low">
                dew
              </span>
            </p>
          </div>
          <p className="max-w-xs text-[10.5px] leading-relaxed text-low">
            Spent only after the daily balance cannot cover a charge, and only
            when the two together can.
          </p>
        </div>

        <ul className="mt-4 grid gap-1.5 sm:grid-cols-2">
          {PAID_BENEFITS.map((benefit) => (
            <li
              key={benefit}
              className="flex items-center gap-2 text-[11.5px] leading-relaxed text-mid"
            >
              <span aria-hidden="true" className="size-1 rounded-full bg-accent" />
              {benefit}
            </li>
          ))}
        </ul>
      </section>

      <AdBanner className="mt-6" />

      <section aria-labelledby="plans-heading" className="mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id="plans-heading"
            className="text-[15px] font-semibold tracking-[-0.02em] text-hi"
          >
            Plans
          </h2>
          {TOPUP_PAUSED ? (
            <span className="rounded-full border border-line-strong px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-low">
              checkout paused
            </span>
          ) : (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary px-3.5 py-1.5 text-[12px]"
            >
              Pay on Sociabuzz ↗
            </a>
          )}
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className="rounded-3xl border border-line bg-raised px-4 py-4"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[13px] font-semibold text-hi">{plan.name}</p>
                <p
                  className="font-mono text-[11px] tabular-nums text-low"
                  title={`Charged as RM ${plan.price} on the payment page`}
                >
                  {localPrices
                    ? `≈ ${formatMoney(plan.price, currency)}`
                    : `RM ${plan.price}`}
                </p>
              </div>
              <p className="mt-2 font-mono text-[20px] leading-none tabular-nums text-accent-text">
                {plan.dew}
                <span className="ml-1 text-[10px] uppercase tracking-[0.12em] text-low">
                  dew
                </span>
              </p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-low">
                {plan.days} days
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-mid">
                {plan.blurb}
              </p>
            </div>
          ))}
        </div>

        <p className="mt-2 text-[10.5px] leading-relaxed text-low">
          {localPrices
            ? `Prices above are an estimate in ${currency.name} at ${live ? "today's exchange rate" : "an indicative rate"}. The hosted page charges ringgit, and the ringgit amount on your receipt is the one that counts. `
            : ""}
          The hosted page is the only place money changes hands. This app never
          asks for card details.
        </p>
      </section>


      {/* Checkout is paused in this build, so the upload form is not shown at
          all: a form the reader can fill in and never submit is a dead end
          dressed as a feature. Past requests stay listed below either way. */}
      {!TOPUP_PAUSED && (
      <section aria-labelledby="receipt-heading" className="panel mt-6 p-5">
        <h2
          id="receipt-heading"
          className="text-[15px] font-semibold tracking-[-0.02em] text-hi"
        >
          Upload a receipt
        </h2>
        <p className="mt-1 text-[11.5px] leading-relaxed text-mid">
          One request per payment. It stays here with a pending, approved or
          rejected status, so you can follow it from submission to approval.
        </p>

        <form action={submitReceipt} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="eyebrow block px-1 pb-1.5">Plan</span>
            <select
              name="plan"
              defaultValue={PLANS[0]?.id}
              className="field py-2 text-[12px]"
            >
              {PLANS.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name} — {plan.dew} Dew
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="eyebrow block px-1 pb-1.5">
              Amount paid (RM)
            </span>
            <input
              name="amount"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              placeholder={String(PLANS[0]?.price ?? "")}
              className="field py-2 font-mono text-[12px]"
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="eyebrow block px-1 pb-1.5">
              Transaction reference
            </span>
            <input
              name="reference"
              required
              maxLength={120}
              autoComplete="off"
              spellCheck={false}
              placeholder="The reference or sender name from the payment page"
              className="field py-2 text-[12px]"
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="eyebrow block px-1 pb-1.5">
              Note (optional)
            </span>
            <input
              name="note"
              maxLength={500}
              className="field py-2 text-[12px]"
              placeholder="Anything we should know"
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="eyebrow block px-1 pb-1.5">Receipt</span>
            <input
              name="receipt"
              type="file"
              required
              accept="image/png,image/jpeg,image/webp,application/pdf"
              className="field w-full max-w-full cursor-pointer py-1.5 text-[11.5px] file:mr-3 file:max-w-[45%] file:truncate file:rounded-full file:border-0 file:bg-chip file:px-3 file:py-1 file:font-mono file:text-[10px] file:uppercase file:tracking-[0.12em] file:text-mid"
            />
            <span className="mt-1 block px-1 text-[10px] text-low">
              PNG, JPEG, WebP or PDF, up to 5 MB.
            </span>
          </label>

          <SubmitButton
            className="btn btn-primary py-2.5 text-[12.5px] sm:col-span-2"
            pendingText="Uploading the receipt…"
          >
            Submit receipt
          </SubmitButton>
        </form>
      </section>
      )}

      <section aria-labelledby="requests-heading" className="panel mt-5 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id="requests-heading"
            className="text-[15px] font-semibold tracking-[-0.02em] text-hi"
          >
            Your requests
          </h2>
          <p className="text-[10.5px] text-low">
            {requests.length} total · newest first
          </p>
        </div>

        {requests.length === 0 ? (
          <p className="mt-3 text-[12px] leading-relaxed text-mid">
            {TOPUP_PAUSED
              ? "No receipts yet. Uploads are paused while checkout is being tested, so nothing is waiting for review."
              : "No receipts yet. Pay on Sociabuzz, then upload the proof above."}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {requests.map((row) => {
              const plan = planById(row.plan);
              const state = STATUS[row.status] ?? STATUS.pending;
              const receipt = receipts.get(row.id);

              return (
                <li key={row.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[12.5px] font-semibold text-hi">
                        {plan?.name ?? row.plan}
                      </p>
                      <span className="font-mono text-[10.5px] text-low">
                        RM {Number(row.amount).toFixed(2)} · {utc(row.created_at)}
                      </span>
                    </div>
                    <StatusPill tone={state.tone}>{state.label}</StatusPill>
                  </div>

                  <p className="mt-1 break-all font-mono text-[10.5px] text-low">
                    ref {row.reference}
                  </p>

                  {row.status === "approved" && row.dew_granted !== null && (
                    <p className="mt-1 text-[11px] text-accent-text">
                      +{row.dew_granted} Dew granted
                    </p>
                  )}

                  {row.decision_note && (
                    <p className="mt-1 text-[11px] leading-relaxed text-mid">
                      Operator: {row.decision_note}
                    </p>
                  )}

                  {receipt ? (
                    <a
                      href={receipt}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="eyebrow mt-1 inline-block hover:text-hi"
                    >
                      view receipt ↗
                    </a>
                  ) : (
                    <p className="mt-1 break-all text-[10.5px] text-low">
                      {row.receipt_name ?? "receipt"}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="mt-8 max-w-2xl text-[10.5px] leading-relaxed text-low">
        Approval is recorded against your receipt, and the Dew moves through the
        same ledger as every other balance change. A rejected receipt
        keeps its note and can be resubmitted with a corrected reference.
      </p>
    </main>
  );
}
