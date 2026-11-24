import {
  ArrowLeft,
  Check,
  Layers,
  ShieldCheck,
  Terminal,
  Zap,
} from "lucide-react";
import { cookies, headers } from "next/headers";
import Link from "next/link";

import { Brand } from "@/components/Brand";
import { OpenmiMark } from "@/components/OpenmiMark";
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

type PlanFeature = {
  title: string;
  description: string;
};

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
  const dailyMultiplier = Number(
    (PAID_DAILY_FREE_CREDIT / DAILY_FREE_CREDIT).toFixed(1)
  );

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

  const freeFeatures: PlanFeature[] = [
    {
      title: `${DAILY_FREE_CREDIT} Credit daily allowance`,
      description: `Get ${dailyFreeHours} full hours of named model chat every day, worldwide`,
    },
    {
      title: `${TRIAL_CREDIT} Credit welcome trial`,
      description:
        "Extra upfront Credit on your first request to try models right away",
    },
    {
      title: "DeepSeek V4.1 Flash & GPT-OSS 120B",
      description:
        "Plus 0 Credit/hr Auto routing across available free models",
    },
  ];

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

      <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-5 sm:px-8">
          <nav
            aria-label="Breadcrumb"
            className="flex min-w-0 items-center gap-3"
          >
            <Link
              href={ref ? `/?ref=${encodeURIComponent(ref)}` : "/"}
              aria-label="Openmi home"
            >
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
              href={
                signedIn
                  ? "/chat"
                  : ref
                    ? `/?ref=${encodeURIComponent(ref)}`
                    : "/"
              }
              className="btn gap-1.5 px-3 py-1.5 text-[12px]"
            >
              <ArrowLeft
                aria-hidden="true"
                className="size-3.5"
                strokeWidth={1.75}
              />
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

      <main className="animate-enter mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-12">
        {ref && !signedIn && (
          <div
            role="status"
            className="mb-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent/30 bg-accent-soft px-5 py-3 text-[13px] text-accent-text"
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

        {/* ── Hero + Currency Controls ───────────────────────────────────── */}
        <div className="flex flex-col justify-between gap-6 pb-8 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <h1 className="text-balance text-[clamp(2rem,4.4vw,2.85rem)] font-semibold leading-[1.08] tracking-[-0.035em] text-hi">
              Choose your Openmi plan
            </h1>
            <p className="mt-3 text-[15px] leading-[1.55] text-mid">
              {CREDIT_PER_HOUR} Credit/hr per named model with unlimited
              follow-ups inside each 60-minute window. Auto-refund on provider
              failure and zero auto-renewal.
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
              className="field w-auto rounded-full px-3.5 py-2 text-[12.5px]"
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
              className="inline-flex h-9 items-center justify-center rounded-full border border-line-strong bg-card px-4 text-[12.5px] font-medium text-hi transition-colors hover:bg-hover"
            >
              Update
            </button>
          </form>
        </div>

        {/* ── Plan Cards ─────────────────────────────────────────────────── */}
        <section
          aria-label="Plans"
          className="grid items-stretch gap-6 lg:grid-cols-3"
        >
          {/* Free Tier Card */}
          <article className="flex flex-col rounded-[24px] border border-line-strong bg-card p-6 shadow-[var(--card-shadow)] sm:p-7">
            <p className="text-[11px] font-semibold tracking-[0.08em] text-low uppercase">
              Free tier
            </p>

            <h2 className="mt-2 text-[26px] font-semibold leading-tight tracking-[-0.03em] text-hi">
              Openmi <span className="font-medium text-mid">Free</span>
            </h2>

            <div className="mt-3">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-raised px-3 py-1 text-[12.5px] font-medium text-hi">
                <Zap
                  aria-hidden="true"
                  className="size-3.5 text-mid"
                  strokeWidth={2}
                />
                <span>
                  {DAILY_FREE_CREDIT} Credit/day · {dailyFreeHours} hrs
                </span>
              </span>
            </div>

            <div className="mt-6">
              <p className="text-[13px] text-mid">Always free</p>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-[36px] font-semibold leading-none tracking-[-0.035em] tabular-nums text-hi sm:text-[38px]">
                  {formatMoney(0, currency)}
                </span>
                <span className="text-[15px] font-normal text-mid">
                  /forever
                </span>
              </div>
              <p className="mt-2 text-[12px] text-low">
                Ad-supported · no card required
              </p>
            </div>

            <Link
              href={startHref}
              className="mt-6 flex h-12 w-full items-center justify-center rounded-full border border-line-strong bg-raised px-5 text-[14px] font-medium text-hi transition-colors hover:bg-hover"
            >
              {signedIn ? "Open workspace" : "Get Openmi Free"}
            </Link>

            <div className="mt-7 flex-1">
              <div className="flex items-center gap-2.5">
                <OpenmiMark size={20} />
                <span className="text-[15px] font-semibold tracking-[-0.015em] text-hi">
                  Openmi AI
                </span>
              </div>

              <ul className="mt-4 space-y-4">
                {freeFeatures.map((feature) => (
                  <li key={feature.title} className="flex items-start gap-3">
                    <Check
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0 text-hi"
                      strokeWidth={2.2}
                    />
                    <div>
                      <p className="text-[13.5px] font-semibold leading-snug text-hi">
                        {feature.title}
                      </p>
                      <p className="mt-0.5 text-[13px] leading-[1.45] text-mid">
                        {feature.description}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <hr className="my-6 border-line" />

            <div>
              <p className="text-[13.5px] font-semibold leading-snug text-hi">
                Includes full coding workspace &amp; failure protection
              </p>

              <ul className="mt-4 space-y-3.5">
                <li className="flex items-start gap-3">
                  <Terminal
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-mid"
                    strokeWidth={1.9}
                  />
                  <div>
                    <p className="text-[13px] font-semibold leading-snug text-hi">
                      Sandbox, live previews &amp; GitHub PRs
                    </p>
                    <p className="mt-0.5 text-[12.5px] leading-[1.45] text-mid">
                      Edit files, run builds, and open pull requests from chat
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <ShieldCheck
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-mid"
                    strokeWidth={1.9}
                  />
                  <div>
                    <p className="text-[13px] font-semibold leading-snug text-hi">
                      Automatic failure refunds
                    </p>
                    <p className="mt-0.5 text-[12.5px] leading-[1.45] text-mid">
                      Hour charge releases automatically if a provider drops
                    </p>
                  </div>
                </li>
              </ul>
            </div>
          </article>

          {/* Paid Pass Cards */}
          {PLANS.map((plan, index) => {
            const recommended = index === 1;
            const tierLabel = plan.days === 30 ? "30-day" : "15-day";
            const planFeatures: PlanFeature[] = [
              {
                title: `${dailyMultiplier}x higher daily limits than Free`,
                description: `Get ${PAID_DAILY_FREE_CREDIT} Credit/day (${paidDailyHours} full hours) instead of ${DAILY_FREE_CREDIT} Credit/day`,
              },
              {
                title: "Access to Claude Haiku 4.5",
                description:
                  "Unlock Anthropic's fast coding model alongside DeepSeek V4.1 & GPT-OSS 120B",
              },
              {
                title: `+${plan.credit} upfront wallet Credit`,
                description: recommended
                  ? `Banked immediately in your ledger — over 2x the upfront Credit of the 15-day pass`
                  : "Banked immediately in your ledger on top of your daily allowance",
              },
            ];

            return (
              <article
                key={plan.id}
                className={`flex flex-col rounded-[24px] bg-card p-6 shadow-[var(--card-shadow)] sm:p-7 ${
                  recommended
                    ? "border-2 border-accent"
                    : "border border-line-strong"
                }`}
              >
                <p
                  className={`text-[11px] font-semibold tracking-[0.08em] uppercase ${
                    recommended ? "text-accent-text" : "text-low"
                  }`}
                >
                  {recommended ? "Recommended" : "Fixed-term pass"}
                </p>

                <h2 className="mt-2 text-[26px] font-semibold leading-tight tracking-[-0.03em] text-hi">
                  Openmi{" "}
                  <span className="text-accent-text">{tierLabel}</span>
                </h2>

                <div className="mt-3">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-raised px-3 py-1 text-[12.5px] font-medium text-hi">
                    <Zap
                      aria-hidden="true"
                      className="size-3.5 text-accent-text"
                      strokeWidth={2}
                    />
                    <span>
                      {PAID_DAILY_FREE_CREDIT} Credit/day + {plan.credit} Credit
                    </span>
                  </span>
                </div>

                <div className="mt-6">
                  <p className="text-[13px] text-mid">One-time pass</p>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-[36px] font-semibold leading-none tracking-[-0.035em] tabular-nums text-hi sm:text-[38px]">
                      {converted
                        ? `~${formatMoney(plan.price, currency)}`
                        : `MYR ${plan.price}`}
                    </span>
                    <span className="text-[15px] font-normal text-mid">
                      /{plan.days} days
                    </span>
                  </div>
                  <p className="mt-2 text-[12px] text-low">
                    {converted ? `Settled as RM ${plan.price} · ` : ""}No
                    auto-renewal · no stored card
                  </p>
                </div>

                <Link
                  href={passCtaHref}
                  className={`mt-6 flex h-12 w-full items-center justify-center rounded-full px-5 text-[14px] font-medium transition-colors ${
                    recommended
                      ? "bg-accent text-on-accent hover:opacity-90"
                      : "border border-accent/40 bg-accent-soft text-accent-text hover:bg-accent hover:text-on-accent"
                  }`}
                >
                  Get Openmi {tierLabel}
                </Link>

                <div className="mt-7 flex-1">
                  <div className="flex items-center gap-2.5">
                    <OpenmiMark size={20} />
                    <span className="text-[15px] font-semibold tracking-[-0.015em] text-hi">
                      Openmi AI
                    </span>
                  </div>

                  <ul className="mt-4 space-y-4">
                    {planFeatures.map((feature) => (
                      <li key={feature.title} className="flex items-start gap-3">
                        <Check
                          aria-hidden="true"
                          className="mt-0.5 size-4 shrink-0 text-hi"
                          strokeWidth={2.2}
                        />
                        <div>
                          <p className="text-[13.5px] font-semibold leading-snug text-hi">
                            {feature.title}
                          </p>
                          <p className="mt-0.5 text-[13px] leading-[1.45] text-mid">
                            {feature.description}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>

                <hr className="my-6 border-line" />

                <div>
                  <p className="text-[13.5px] font-semibold leading-snug text-hi">
                    Includes full coding workspace &amp; stackable passes
                  </p>

                  <ul className="mt-4 space-y-3.5">
                    <li className="flex items-start gap-3">
                      <Terminal
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0 text-mid"
                        strokeWidth={1.9}
                      />
                      <div>
                        <p className="text-[13px] font-semibold leading-snug text-hi">
                          Sandbox, live previews &amp; GitHub PRs
                        </p>
                        <p className="mt-0.5 text-[12.5px] leading-[1.45] text-mid">
                          Everything in Free with ad-free workspace access
                        </p>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <Layers
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0 text-mid"
                        strokeWidth={1.9}
                      />
                      <div>
                        <p className="text-[13px] font-semibold leading-snug text-hi">
                          Stackable {plan.days}-day window
                        </p>
                        <p className="mt-0.5 text-[12.5px] leading-[1.45] text-mid">
                          Extends from your current end date and ends cleanly
                        </p>
                      </div>
                    </li>
                  </ul>
                </div>
              </article>
            );
          })}
        </section>

        {converted && (
          <p className="mt-4 text-[12.5px] text-low">
            {currency.name} estimate ({live ? "live" : "indicative"}). Checkout
            settles in Malaysian ringgit (RM).
          </p>
        )}

        {/* ── Models ─────────────────────────────────────────────────────── */}
        <section className="mt-14">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-hi">
              Models and hourly Credit rates
            </h2>
            <p className="text-[13px] text-mid">
              Auto routing is 0 Credit/hr on all plans.
            </p>
          </div>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-card shadow-[var(--card-shadow)]">
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
        <section className="mt-14 border-t border-line pt-10">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-hi">
              Common questions about Openmi pricing
            </h2>
            <p className="text-[13px] text-mid">
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

          <dl className="mt-5 grid gap-5 md:grid-cols-3">
            {PRICING_FAQS.map((item) => (
              <div
                key={item.question}
                className="rounded-2xl border border-line bg-card p-6 shadow-[var(--card-shadow)]"
              >
                <dt className="text-[14px] font-semibold tracking-[-0.015em] text-hi">
                  {item.question}
                </dt>
                <dd className="mt-2.5 text-pretty text-[13px] leading-[1.6] text-mid">
                  {item.answer}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <footer className="mt-14 flex flex-wrap items-center justify-between gap-3 border-t border-line py-6 text-[12.5px]">
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
