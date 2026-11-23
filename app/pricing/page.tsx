import { ArrowLeft, ArrowRight, Check, Clock, Globe, Layers } from "lucide-react";
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
import { PAID_BENEFITS, PLANS } from "@/lib/billing/plans";
import { getMyrRates, withLiveRate } from "@/lib/billing/rates";
import {
  CREDIT_PER_HOUR,
  DAILY_FREE_CREDIT,
  INVITE_REWARD_CREDIT,
  MAX_INVITES_PER_ACCOUNT,
  PAID_DAILY_FREE_CREDIT,
  TRIAL_CREDIT,
} from "@/lib/credits";
import { MODELS } from "@/lib/models";
import { getSession } from "@/lib/session";
import { supportMailto } from "@/lib/support";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Pricing & passes — Openmi",
  description: `Free on Auto, ${DAILY_FREE_CREDIT} free Credit every day worldwide, or fixed-term passes with ${PAID_DAILY_FREE_CREDIT} Credit/day and zero auto-renewal.`,
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

  const publicModels = MODELS.filter((model) => !model.adminOnly);
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
      <header className="border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-5 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Link href={ref ? `/?ref=${encodeURIComponent(ref)}` : "/"} aria-label="Openmi home">
              <Brand compact />
            </Link>
            <span aria-hidden="true" className="text-line-strong">
              /
            </span>
            <h1 className="truncate text-[14px] font-semibold tracking-[-0.02em] text-hi">
              Pricing &amp; passes
            </h1>
          </div>

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
            className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-[13px] text-accent-text"
          >
            <p>
              Invite code{" "}
              <code className="rounded bg-card px-1.5 py-0.5 font-mono text-[12px] text-hi">
                {ref}
              </code>{" "}
              is active — create your account to claim +{INVITE_REWARD_CREDIT}{" "}
              bonus Credit.
            </p>
            <Link
              href={startHref}
              className="btn btn-primary px-3 py-1.5 text-[12px]"
            >
              Claim bonus
            </Link>
          </div>
        )}

        <div className="flex flex-col justify-between gap-6 border-b border-line pb-8 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <h2 className="text-balance text-[clamp(1.9rem,4.2vw,2.85rem)] font-semibold leading-[1.06] tracking-[-0.03em] text-hi">
              Priced by the hour. Free every day.
            </h2>
            <p className="mt-3 text-pretty text-[14.5px] leading-[1.65] text-mid">
              Auto mode is free, and named models cost {CREDIT_PER_HOUR} Credit
              for a full hour of unlimited follow-up turns. Fixed-term passes
              never auto-renew and no credit card is stored in the app.
            </p>
          </div>

          <form
            method="GET"
            action="/pricing"
            className="flex flex-wrap items-center gap-2"
          >
            {ref && <input type="hidden" name="ref" value={ref} />}
            <label htmlFor="pricing-country" className="sr-only">
              Estimate prices in your currency
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
              Estimate
            </button>
          </form>
        </div>

        {/* ── Free Tier vs. Fixed-Term Passes ────────────────────────────── */}
        <section aria-label="Plans" className="mt-8 grid gap-5 lg:grid-cols-3">
          {/* Free Tier */}
          <div className="flex flex-col justify-between rounded-xl border border-line bg-card p-6 shadow-[var(--card-shadow)]">
            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[14px] font-semibold text-hi">Free tier</p>
                <span className="rounded-md border border-line bg-raised px-2 py-0.5 font-mono text-[10.5px] font-medium text-mid">
                  Ad-supported
                </span>
              </div>

              <p className="mt-4 font-mono text-[32px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-hi">
                {formatMoney(0, currency)}
              </p>
              <p className="mt-2 text-[12.5px] text-low">
                {DAILY_FREE_CREDIT} Credit / day ({dailyFreeHours} hrs/day) ·
                equal worldwide
              </p>

              <ul className="mt-5 space-y-2.5 border-t border-line pt-4 text-[13px] text-mid">
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                  <span>Unlimited Auto mode (0 Credit/hr)</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                  <span>{TRIAL_CREDIT} Credit one-time trial grant</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                  <span>
                    +{INVITE_REWARD_CREDIT} Credit per invite (up to{" "}
                    {MAX_INVITES_PER_ACCOUNT})
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                  <span>DeepSeek V4.1 Flash &amp; GPT-OSS 120B</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                  <span>Persistent sandbox, live previews &amp; GitHub PRs</span>
                </li>
              </ul>
            </div>

            <Link
              href={startHref}
              className="btn mt-6 w-full justify-center py-2 text-[13px]"
            >
              {signedIn ? "Open workspace" : "Start free with GitHub"}
            </Link>
          </div>

          {/* Paid Passes */}
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
                    {converted ? `Charged as RM ${plan.price} · ` : ""}
                    +{plan.credit} upfront wallet Credit · {plan.days} days
                  </p>

                  <ul className="mt-5 space-y-2.5 border-t border-line pt-4 text-[13px] text-mid">
                    <li className="flex items-start gap-2">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                      <span>
                        {PAID_DAILY_FREE_CREDIT} Credit / day ({paidDailyHours}{" "}
                        hrs/day) for {plan.days} days
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                      <span>+{plan.credit} Credit added to your wallet</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                      <span>Unlocks paid-only models (Claude Haiku 4.5)</span>
                    </li>
                    {PAID_BENEFITS.slice(2).map((benefit) => (
                      <li key={benefit} className="flex items-start gap-2">
                        <Check className="mt-0.5 size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                        <span>{benefit}</span>
                      </li>
                    ))}
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
            {currency.name} figures are estimates ({live ? "live" : "indicative"}{" "}
            rate). Hosted checkout always settles in Malaysian ringgit (RM).
          </p>
        )}

        {/* ── How Hourly Billing Works ───────────────────────────────────── */}
        <section className="mt-12 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-line bg-raised p-5">
            <Clock className="size-4 text-accent-text" strokeWidth={1.75} />
            <h3 className="mt-3 text-[14px] font-semibold text-hi">
              1 hour = unlimited follow-ups
            </h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-mid">
              Starting an hour on a named model costs {CREDIT_PER_HOUR} Credit.
              Every follow-up turn in that chat during the hour is free.
            </p>
          </div>

          <div className="rounded-xl border border-line bg-raised p-5">
            <Globe className="size-4 text-accent-text" strokeWidth={1.75} />
            <h3 className="mt-3 text-[14px] font-semibold text-hi">
              Local-midnight refills
            </h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-mid">
              Your daily allowance tops up at midnight in your chosen timezone—
              {DAILY_FREE_CREDIT} Credit on Free, {PAID_DAILY_FREE_CREDIT} Credit
              with an active pass.
            </p>
          </div>

          <div className="rounded-xl border border-line bg-raised p-5">
            <Layers className="size-4 text-accent-text" strokeWidth={1.75} />
            <h3 className="mt-3 text-[14px] font-semibold text-hi">
              Automatic failure refunds
            </h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-mid">
              If a provider fails or aborts before sending the first token, the
              hour is automatically returned to your ledger balance.
            </p>
          </div>
        </section>

        {/* ── Model Access Table ─────────────────────────────────────────── */}
        <section className="mt-12">
          <h3 className="text-[17px] font-semibold tracking-[-0.02em] text-hi">
            Model access &amp; hourly cost
          </h3>
          <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-card shadow-[var(--card-shadow)]">
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-line bg-raised text-[12px] text-low">
                <tr>
                  <th className="px-4 py-3 font-medium">Model</th>
                  <th className="px-4 py-3 font-medium">Hourly cost</th>
                  <th className="px-4 py-3 font-medium">Access</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {publicModels.map((model) => (
                  <tr key={model.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-hi">{model.name}</p>
                      <p className="mt-0.5 text-[12px] text-low">{model.blurb}</p>
                    </td>
                    <td className="px-4 py-3 font-mono text-[12.5px] tabular-nums text-hi">
                      {model.creditPerHour === 0
                        ? "Free (0 Credit)"
                        : `${model.creditPerHour} Credit / hr`}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-md px-2 py-0.5 font-mono text-[11px] font-medium ${
                          model.paidOnly
                            ? "bg-accent-soft text-accent-text"
                            : "border border-line bg-raised text-mid"
                        }`}
                      >
                        {model.paidOnly ? "Active pass" : "Free & pass"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-line py-6 text-[12.5px]">
          <p className="font-mono text-low">© 2026 Openmi</p>
          <div className="flex flex-wrap items-center gap-4 text-mid">
            <Link href="/about" className="hover:text-hi">
              About
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
