import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { cookies, headers } from "next/headers";
import Link from "next/link";

import { Brand } from "@/components/Brand";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import {
  COUNTRY_COOKIE,
  COUNTRY_OPTIONS,
  countryFromRequest,
  currencyForCountry,
  formatMoney,
  isConverted,
} from "@/lib/billing/currency";
import { PLANS } from "@/lib/billing/plans";
import { getMyrRates, withLiveRate } from "@/lib/billing/rates";
import {
  CREDIT_PER_HOUR,
  DAILY_FREE_CREDIT,
  INVITE_REWARD_CREDIT,
  PAID_DAILY_FREE_CREDIT,
  TRIAL_CREDIT,
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
  const dailyFreeHours = Math.floor(DAILY_FREE_CREDIT / CREDIT_PER_HOUR);
  const paidDailyHours = Math.floor(PAID_DAILY_FREE_CREDIT / CREDIT_PER_HOUR);

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
    <div className="min-h-dvh">
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
      <header className="border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-5 sm:px-8">
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-3">
            <Link href={ref ? `/?ref=${encodeURIComponent(ref)}` : "/"} aria-label="Openmi home">
              <Brand compact />
            </Link>
            <span aria-hidden="true" className="text-line-strong">
              /
            </span>
            <span
              aria-current="page"
              className="truncate text-[14px] font-semibold tracking-[-0.02em] text-hi"
            >
              Pricing
            </span>
          </nav>

          <div className="flex items-center gap-2">
            <ThemeSwitcher variant="icon" />
            <Link
              href={signedIn ? "/chat" : ref ? `/?ref=${encodeURIComponent(ref)}` : "/"}
              className="btn gap-1.5 px-3 py-1.5 text-[12px]"
            >
              <ArrowLeft aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
              <span>{signedIn ? "Workspace" : "Home"}</span>
            </Link>
            <Link
              href={startHref}
              className="btn btn-primary px-3.5 py-1.5 text-[12px]"
            >
              {signedIn ? "Open chat" : "Start free"}
            </Link>
          </div>
        </div>
      </header>

      <main className="animate-enter mx-auto w-full max-w-5xl px-5 py-10 sm:px-8">
        {ref && !signedIn && (
          <div
            role="status"
            className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-2.5 text-[13px] text-accent-text"
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
              className="btn btn-primary px-3 py-1.5 text-[12px]"
            >
              Sign up
            </Link>
          </div>
        )}

        <div className="flex flex-col justify-between gap-6 border-b border-line pb-7 md:flex-row md:items-end">
          <div>
            <h1 className="text-balance text-[clamp(1.9rem,4.2vw,2.75rem)] font-semibold leading-[1.06] tracking-[-0.03em] text-hi">
              Openmi pricing: {CREDIT_PER_HOUR} Credit/hr, zero subscriptions.
            </h1>
            <p className="mt-2.5 text-[14px] text-mid">
              Unlimited follow-ups per active hour · auto-refund on failure · no
              auto-renewal.
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
              className="field w-auto py-1.5 text-[12.5px]"
            >
              <option value="">Currency (MYR)</option>
              {COUNTRY_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.name} ({option.currency})
                </option>
              ))}
            </select>
            <button type="submit" className="btn px-3 py-1.5 text-[12.5px]">
              Update
            </button>
          </form>
        </div>

        {/* ── Plans ──────────────────────────────────────────────────────── */}
        <section aria-label="Plans" className="mt-8 grid gap-5 lg:grid-cols-3">
          <div className="flex flex-col justify-between rounded-xl border border-line bg-card p-6 shadow-[var(--card-shadow)]">
            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[14px] font-semibold text-hi">Free</p>
                <span className="rounded-md border border-line bg-raised px-2 py-0.5 font-mono text-[10.5px] font-medium text-mid">
                  Ad-supported
                </span>
              </div>

              <p className="mt-4 font-mono text-[32px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-hi">
                {formatMoney(0, currency)}
              </p>
              <p className="mt-2 text-[12.5px] text-low">
                {DAILY_FREE_CREDIT} Credit/day ({dailyFreeHours} hrs) ·
                worldwide
              </p>

              <ul className="mt-5 space-y-2 border-t border-line pt-4 text-[13px] text-mid">
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                  <span>{TRIAL_CREDIT} Credit trial</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                  <span>DeepSeek V4.1 Flash &amp; GPT-OSS 120B</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                  <span>Sandbox, previews &amp; GitHub PRs</span>
                </li>
              </ul>
            </div>

            <Link
              href={startHref}
              className="btn mt-6 w-full justify-center py-2 text-[13px]"
            >
              {signedIn ? "Open workspace" : "Start free"}
            </Link>
          </div>

          {PLANS.map((plan, index) => {
            const featured = index === 1;
            return (
              <div
                key={plan.id}
                className={`flex flex-col justify-between rounded-xl border bg-card p-6 shadow-[var(--card-shadow)] ${
                  featured ? "border-accent/45" : "border-line"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <p
                      className={`text-[14px] font-semibold ${
                        featured ? "text-accent-text" : "text-hi"
                      }`}
                    >
                      {plan.name}
                    </p>
                    <span className="rounded-md bg-accent-soft px-2 py-0.5 font-mono text-[10.5px] font-medium text-accent-text">
                      No auto-renew
                    </span>
                  </div>

                  <p className="mt-4 font-mono text-[32px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-hi">
                    {converted ? `~${formatMoney(plan.price, currency)}` : `RM ${plan.price}`}
                  </p>
                  <p className="mt-2 text-[12.5px] text-low">
                    {converted ? `RM ${plan.price} · ` : ""}+{plan.credit}{" "}
                    wallet Credit · {plan.days} days
                  </p>

                  <ul className="mt-5 space-y-2 border-t border-line pt-4 text-[13px] text-mid">
                    <li className="flex items-center gap-2">
                      <Check className="size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                      <span>
                        {PAID_DAILY_FREE_CREDIT} Credit/day ({paidDailyHours}{" "}
                        hrs)
                      </span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                      <span>+{plan.credit} upfront wallet Credit</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                      <span>Unlocks Claude Haiku 4.5</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                      <span>Stackable · ends cleanly</span>
                    </li>
                  </ul>
                </div>

                <Link
                  href={passCtaHref}
                  className={`btn mt-6 w-full justify-center py-2 text-[13px] ${
                    featured ? "btn-primary" : ""
                  }`}
                >
                  {signedIn ? `Get ${plan.name}` : `Sign in for ${plan.name}`}
                  <ArrowRight aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
                </Link>
              </div>
            );
          })}
        </section>

        {converted && (
          <p className="mt-4 text-[12px] text-low">
            {currency.name} estimate ({live ? "live" : "indicative"}). Checkout
            settles in RM.
          </p>
        )}

        {/* ── Models ─────────────────────────────────────────────────────── */}
        <section className="mt-10">
          <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-hi">
            Models and hourly Credit rates
          </h2>
          <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-card shadow-[var(--card-shadow)]">
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-line bg-raised text-[12px] text-low">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Model</th>
                  <th className="px-4 py-2.5 font-medium">Rate</th>
                  <th className="px-4 py-2.5 font-medium">Tier</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {publicModels.map((model) => (
                  <tr key={model.id}>
                    <td className="px-4 py-3 font-medium text-hi">
                      {model.name}
                    </td>
                    <td className="px-4 py-3 font-mono text-[12.5px] tabular-nums text-hi">
                      {model.creditPerHour} Credit / hr
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-md px-2 py-0.5 font-mono text-[11px] font-medium ${
                          model.paidOnly
                            ? "bg-accent-soft text-accent-text"
                            : "border border-line bg-raised text-mid"
                        }`}
                      >
                        {model.paidOnly ? "Pass" : "Free & pass"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Pricing FAQ ────────────────────────────────────────────────── */}
        <section className="mt-10 border-t border-line pt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-hi">
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
                className="rounded-xl border border-line bg-card p-5 shadow-[var(--card-shadow)]"
              >
                <dt className="text-[13.5px] font-semibold tracking-[-0.015em] text-hi">
                  {item.question}
                </dt>
                <dd className="mt-2 text-pretty text-[12.5px] leading-[1.6] text-mid">
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
            <a href={supportMailto("Pricing question")} className="hover:text-hi">
              Support
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}
