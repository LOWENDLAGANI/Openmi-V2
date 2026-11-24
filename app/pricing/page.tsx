import { cookies, headers } from "next/headers";
import Link from "next/link";

import { GoogleOnePlanCards } from "@/components/GoogleOnePlanCards";
import { SiteHeader } from "@/components/SiteHeader";
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
    question: "How does hourly Credit billing work?",
    answer: `Each named model charges ${CREDIT_PER_HOUR} Credit when you start an hour, and all follow-up turns inside that 60-minute window are included. Auto routing is 0 Credit/hr.`,
  },
  {
    question: "Do paid passes auto-renew?",
    answer: `No. Both the ${PLANS[0].name} (RM ${PLANS[0].price}) and ${PLANS[1].name} (RM ${PLANS[1].price}) are one-time fixed-term passes. They stack if you buy another early and end cleanly without stored cards.`,
  },
  {
    question: "What happens if a model provider fails to answer?",
    answer:
      "If the upstream model provider returns no answer before the first token arrives, Openmi automatically releases the hour charge back to your Credit balance.",
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

      <SiteHeader
        currentPath="/pricing"
        loginHref={startHref}
        signedIn={signedIn}
      />

      <main id="main" className="lp-wrap pb-20 pt-28 sm:pt-32">
        <div className="flex flex-col justify-between gap-6 pb-10 md:flex-row md:items-end">
          <div>
            <h1 className="max-w-[20ch] text-balance text-[clamp(2.1rem,4vw,3.25rem)] font-medium leading-[1.06] tracking-[-0.032em] text-hi">
              {CREDIT_PER_HOUR} Credit per hour, zero subscriptions.
            </h1>
            <p className="mt-3 max-w-[54ch] text-[16px] leading-[1.6] text-mid">
              {converted
                ? `${currency.name} estimate (${live ? "live" : "indicative"}). Checkout settles in MYR.`
                : "Unlimited follow-ups inside every active hour. Fixed-term passes never auto-renew."}
            </p>
          </div>

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
              className="field h-10 w-auto px-3.5 py-0 text-[13.5px]"
            >
              <option value="">Currency (MYR)</option>
              {COUNTRY_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.name} ({option.currency})
                </option>
              ))}
            </select>
            <button type="submit" className="btn h-10 px-4 text-[13.5px]">
              Update currency
            </button>
          </form>
        </div>

        {ref && !signedIn && (
          <div
            role="status"
            className="mb-8 flex flex-wrap items-center justify-between gap-3 rounded-[var(--r-md)] border border-accent/30 bg-accent-soft px-4 py-3 text-[14px] text-accent-text"
          >
            <p>
              Invite{" "}
              <code className="rounded-[var(--r-sm)] bg-card px-1.5 py-0.5 font-mono text-[13px] text-hi">
                {ref}
              </code>{" "}
              active: +{INVITE_REWARD_CREDIT} Credit for both accounts on first paid pass.
            </p>
            <Link
              href={startHref}
              className="btn btn-primary h-9 px-3.5 text-[13px]"
            >
              Create account
            </Link>
          </div>
        )}

        <section aria-label="Plans">
          <GoogleOnePlanCards
            currency={currency}
            mode="pricing"
            signedIn={signedIn}
            startHref={startHref}
            passCtaHref={passCtaHref}
          />
        </section>

        {/* ── Models ─────────────────────────────────────────────────────── */}
        <section className="mt-16">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[22px] font-medium tracking-[-0.025em] text-hi">
              Models and hourly Credit rates
            </h2>
            <p className="text-[14px] text-mid">
              Auto routing is 0 Credit/hr on all plans.
            </p>
          </div>
          <div className="mt-4 overflow-x-auto rounded-[var(--r-lg)] border border-line bg-card">
            <table className="w-full text-left text-[15px]">
              <thead className="border-b border-line bg-raised text-[13px] text-low">
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
                    <td className="px-5 py-3.5 font-mono text-[14px] tabular-nums text-hi">
                      {model.creditPerHour} Credit / hr
                    </td>
                    <td className="px-5 py-3.5 font-mono text-[13px]">
                      <span
                        className={
                          model.paidOnly ? "text-accent-text" : "text-mid"
                        }
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
        <section className="mt-16 border-t border-line pt-12">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-[22px] font-medium tracking-[-0.025em] text-hi">
              Common questions
            </h2>
            <p className="text-[14px] text-mid">
              See{" "}
              <Link href="/about" className="t-link font-medium text-accent-text">
                sandbox limits &amp; PR workflow
              </Link>{" "}
              or{" "}
              <Link href="/refunds" className="t-link font-medium text-accent-text">
                refund terms
              </Link>
              .
            </p>
          </div>

          <dl className="mt-8 grid gap-x-10 gap-y-8 md:grid-cols-3">
            {PRICING_FAQS.map((item) => (
              <div key={item.question} className="border-t border-line pt-5">
                <dt className="text-[16px] font-medium tracking-[-0.015em] text-hi">
                  {item.question}
                </dt>
                <dd className="mt-2 text-[15px] leading-[1.6] text-mid">
                  {item.answer}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <footer className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-line py-8 text-[14px]">
          <p className="font-mono text-[13px] text-low">© 2026 Openmi</p>
          <div className="flex flex-wrap items-center gap-5 text-mid">
            <Link href="/about" className="t-link text-mid hover:text-hi">
              About
            </Link>
            <Link href="/report" className="t-link text-mid hover:text-hi">
              Report a problem
            </Link>
            <Link href="/suggestions" className="t-link text-mid hover:text-hi">
              Suggestions
            </Link>
            <Link href="/refunds" className="t-link text-mid hover:text-hi">
              Refunds
            </Link>
            <Link href="/terms" className="t-link text-mid hover:text-hi">
              Terms
            </Link>
            <a
              href={supportMailto("Pricing question")}
              className="t-link text-mid hover:text-hi"
            >
              Support
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}
