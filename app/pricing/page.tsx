import { X } from "lucide-react";
import { cookies, headers } from "next/headers";
import Link from "next/link";

import { Brand } from "@/components/Brand";
import { GoogleOnePlanCards } from "@/components/GoogleOnePlanCards";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import {
  COUNTRY_COOKIE,
  COUNTRY_OPTIONS,
  countryFromRequest,
  currencyForCountry,
  isConverted,
} from "@/lib/billing/currency";
import { PLANS } from "@/lib/billing/plans";
import { getMyrRates, withLiveRate } from "@/lib/billing/rates";
import {
  CREDIT_PER_HOUR,
  DAILY_FREE_CREDIT,
  INVITE_REWARD_CREDIT,
  PAID_DAILY_FREE_CREDIT,
} from "@/lib/credits";
import { MODELS } from "@/lib/models";
import {
  breadcrumbJsonLd,
  faqJsonLd,
  pageMetadata,
  pricingOffersJsonLd,
  serializeJsonLd,
} from "@/lib/seo";
import { getSession } from "@/lib/session";
import { supportMailto } from "@/lib/support";

export const dynamic = "force-dynamic";

export const metadata = pageMetadata({
  path: "/pricing",
  title: "Openmi Pricing: Free Tier & Fixed-Term Passes",
  description: `Compare Openmi pricing: ${DAILY_FREE_CREDIT} free Credit daily at ${CREDIT_PER_HOUR} Credit/hr, or fixed-term 15-day (RM ${PLANS[0].price}) and 30-day (RM ${PLANS[1].price}) passes with ${PAID_DAILY_FREE_CREDIT} Credit/day and zero auto-renewal.`,
});

const PRICING_FAQS = [
  {
    question: "How does Openmi hourly Credit billing work?",
    answer: `Each named model charges ${CREDIT_PER_HOUR} Credit when you start an hour, and all follow-up turns inside that 60-minute window are included at no extra cost. Auto routing is 0 Credit/hr.`,
  },
  {
    question: "Do Openmi paid passes auto-renew?",
    answer: `No. Both the ${PLANS[0].name} (RM ${PLANS[0].price}) and ${PLANS[1].name} (RM ${PLANS[1].price}) are one-time fixed-term passes. They stack if you buy another early and end cleanly without recurring charges or stored cards.`,
  },
  {
    question: "What happens if a model provider fails to answer?",
    answer:
      "If the upstream model provider returns no answer before the first token arrives, Openmi automatically releases the hour charge back to your Credit balance in the append-only ledger.",
  },
] as const;

function cleanRef(raw: string | undefined): string | null {
  const value = (raw ?? "").trim();
  return /^[A-Za-z0-9_-]{3,32}$/.test(value) ? value : null;
}

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ country?: string; ref?: string }>;
}) {
  const params = await searchParams;
  const ref = cleanRef(params.ref);

  const [session, headerStore, cookieStore, rates] = await Promise.all([
    getSession(),
    headers(),
    cookies(),
    getMyrRates(),
  ]);

  const queryCountry = (params.country ?? "").trim().toUpperCase();
  const detectedCountry = countryFromRequest(
    headerStore,
    cookieStore.get(COUNTRY_COOKIE)?.value
  );
  const selectedCountry = /^[A-Z]{2}$/.test(queryCountry)
    ? queryCountry
    : detectedCountry;

  const baseCurrency = currencyForCountry(selectedCountry);
  const currency = withLiveRate(baseCurrency, rates);
  const live = currency !== baseCurrency;
  const converted = isConverted(currency);

  const signedIn = session.state === "signed-in";
  const publicModels = MODELS.filter(
    (model) => !model.adminOnly && model.id !== "auto"
  );
  const closeHref = signedIn
    ? "/chat"
    : ref
      ? `/?ref=${encodeURIComponent(ref)}`
      : "/";
  const startHref = signedIn
    ? "/chat"
    : ref
      ? `/login?ref=${encodeURIComponent(ref)}`
      : "/login";
  const passCtaHref = signedIn
    ? "/pay"
    : ref
      ? `/login?next=%2Fpay&ref=${encodeURIComponent(ref)}`
      : "/login?next=%2Fpay";

  return (
    <div className="min-h-dvh bg-canvas">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd([
            pricingOffersJsonLd(),
            breadcrumbJsonLd([
              { name: "Home", path: "/" },
              { name: "Pricing", path: "/pricing" },
            ]),
            faqJsonLd(PRICING_FAQS),
          ]),
        }}
      />

      {/* ── Minimal Google One-style Top Bar ───────────────────────────── */}
      <header className="sticky top-0 z-20 bg-canvas/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-8">
          <Link href={closeHref} aria-label="Openmi home">
            <Brand />
          </Link>

          <div className="flex items-center gap-2">
            <ThemeSwitcher variant="icon" />
            <Link
              href={closeHref}
              aria-label="Close pricing"
              className="grid size-10 place-items-center rounded-full text-hi transition-colors hover:bg-hover"
            >
              <X aria-hidden="true" className="size-6" strokeWidth={1.75} />
            </Link>
          </div>
        </div>
      </header>

      <main className="animate-enter mx-auto w-full max-w-6xl px-3 pb-14 pt-2 sm:px-8">
        <h1 className="sr-only">
          Openmi pricing: {CREDIT_PER_HOUR} Credit/hr, zero subscriptions
        </h1>

        {ref && !signedIn && (
          <div
            role="status"
            className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3 text-[13px] text-accent-text"
          >
            <p>
              Invite{" "}
              <code className="rounded bg-card px-1.5 py-0.5 font-mono text-[12px] text-hi">
                {ref}
              </code>{" "}
              active: +{INVITE_REWARD_CREDIT} Credit for both on first paid
              pass.
            </p>
            <Link
              href={startHref}
              className="inline-flex items-center justify-center rounded-full bg-accent px-4 py-1.5 text-[12px] font-medium text-on-accent transition-opacity hover:opacity-90"
            >
              Sign up
            </Link>
          </div>
        )}

        {/* ── 1:1 Google One Plan Cards ──────────────────────────────────── */}
        <section aria-label="Plans">
          <GoogleOnePlanCards
            currency={currency}
            mode="pricing"
            signedIn={signedIn}
            startHref={startHref}
            passCtaHref={passCtaHref}
          />
        </section>

        {/* ── Currency Selector ──────────────────────────────────────────── */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 px-1">
          <p className="text-[12.5px] text-low">
            {converted
              ? `${currency.name} estimate (${live ? "live" : "indicative"}). Checkout settles in MYR.`
              : `${CREDIT_PER_HOUR} Credit/hr per named model · unlimited follow-ups per active hour · auto-refund on failure.`}
          </p>

          <form
            method="GET"
            action="/pricing"
            className="flex flex-wrap items-center gap-2"
          >
            {ref && <input type="hidden" name="ref" value={ref} />}
            <label htmlFor="pricing-country" className="sr-only">
              Currency
            </label>
            <select
              id="pricing-country"
              name="country"
              defaultValue={selectedCountry ?? ""}
              className="field w-auto rounded-full px-3.5 py-1.5 text-[12.5px]"
            >
              <option value="">Currency (MYR)</option>
              {COUNTRY_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.name} ({option.currency})
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="inline-flex h-8 items-center justify-center rounded-full border border-line-strong bg-card px-3.5 text-[12px] font-medium text-hi transition-colors hover:bg-hover"
            >
              Update
            </button>
          </form>
        </div>

        {/* ── Models ─────────────────────────────────────────────────────── */}
        <section className="mt-12">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-hi">
              Models and hourly Credit rates
            </h2>
            <p className="text-[12.5px] text-mid">
              Auto routing is 0 Credit/hr on all plans.
            </p>
          </div>
          <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-card">
            <table className="w-full text-left text-[13.5px]">
              <thead className="border-b border-line bg-raised text-[12px] text-low">
                <tr>
                  <th className="px-5 py-3 font-medium">Model</th>
                  <th className="px-5 py-3 font-medium">Hourly rate</th>
                  <th className="px-5 py-3 font-medium">Access</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {publicModels.map((model) => (
                  <tr key={model.id}>
                    <td className="px-5 py-3.5 font-medium text-hi">
                      {model.name}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-[12.5px] tabular-nums text-hi">
                      {model.creditPerHour} Credit / hr
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 font-mono text-[11px] font-medium ${
                          model.paidOnly
                            ? "bg-accent-soft text-accent-text"
                            : "border border-line bg-raised text-mid"
                        }`}
                      >
                        {model.paidOnly ? "Pass only" : "Free & pass"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Pricing FAQ ────────────────────────────────────────────────── */}
        <section className="mt-12 border-t border-line pt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-hi">
              Common questions about Openmi pricing
            </h2>
            <p className="text-[12.5px] text-mid">
              See{" "}
              <Link
                href="/about"
                className="font-medium text-accent-text underline-offset-2 hover:underline"
              >
                sandbox limits &amp; PR workflow
              </Link>{" "}
              or{" "}
              <Link
                href="/refunds"
                className="font-medium text-accent-text underline-offset-2 hover:underline"
              >
                refund &amp; cancellation terms
              </Link>
              .
            </p>
          </div>

          <dl className="mt-4 grid gap-4 md:grid-cols-3">
            {PRICING_FAQS.map((item) => (
              <div
                key={item.question}
                className="rounded-2xl border border-line bg-card p-5"
              >
                <dt className="text-[14px] font-semibold tracking-[-0.015em] text-hi">
                  {item.question}
                </dt>
                <dd className="mt-2 text-pretty text-[13px] leading-[1.6] text-mid">
                  {item.answer}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-line py-6 text-[12.5px]">
          <p className="font-mono text-low">© 2026 Openmi</p>
          <div className="flex flex-wrap items-center gap-4 text-mid">
            <Link href="/about" className="hover:text-hi">
              About
            </Link>
            <Link href="/report" className="hover:text-hi">
              Report a problem
            </Link>
            <Link href="/suggestions" className="hover:text-hi">
              Suggestions
            </Link>
            <Link href="/refunds" className="hover:text-hi">
              Refunds
            </Link>
            <Link href="/terms" className="hover:text-hi">
              Terms
            </Link>
            <a
              href={supportMailto("Pricing question")}
              className="hover:text-hi"
            >
              Support
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}
