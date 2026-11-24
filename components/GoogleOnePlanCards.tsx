import Link from "next/link";

import { ArrowGlyph } from "@/components/SiteHeader";
import {
  formatMoney,
  isConverted,
  type Currency,
} from "@/lib/billing/currency";
import { PLANS, type Plan } from "@/lib/billing/plans";
import {
  CREDIT_PER_HOUR,
  DAILY_FREE_CREDIT,
  PAID_DAILY_FREE_CREDIT,
  TRIAL_CREDIT,
} from "@/lib/credits";

type FeatureRow = {
  title: string;
  description: string;
};

function formatCardPrice(price: number, currency: Currency): string {
  if (isConverted(currency)) {
    return `~${formatMoney(price, currency)}`;
  }
  return `MYR ${price.toFixed(2)}`;
}

function PlanCta({
  label,
  href,
  external,
  disabled,
  primary,
}: {
  label: string;
  href: string;
  external?: boolean;
  disabled?: boolean;
  primary?: boolean;
}) {
  const base = "mt-6 h-11 w-full text-[15px]";
  const cls = disabled
    ? `btn ${base} cursor-not-allowed opacity-50`
    : primary
      ? `btn btn-primary ${base}`
      : `btn ${base}`;

  if (disabled) {
    return (
      <span aria-disabled="true" className={cls}>
        {label}
      </span>
    );
  }

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cls}
      >
        <span>{label}</span>
        {primary && <ArrowGlyph />}
      </a>
    );
  }

  return (
    <Link href={href} className={cls}>
      <span>{label}</span>
      {primary && <ArrowGlyph />}
    </Link>
  );
}

export function GoogleOnePlanCards({
  currency,
  mode,
  signedIn,
  startHref = "/login",
  passCtaHref = "/pay",
  paymentUrl,
  topupPaused = false,
}: {
  currency: Currency;
  mode: "pricing" | "pay";
  signedIn: boolean;
  startHref?: string;
  passCtaHref?: string;
  paymentUrl?: string;
  topupPaused?: boolean;
}) {
  const dailyFreeHours = Math.floor(DAILY_FREE_CREDIT / CREDIT_PER_HOUR);
  const paidDailyHours = Math.floor(PAID_DAILY_FREE_CREDIT / CREDIT_PER_HOUR);
  const multiplier = Number(
    (PAID_DAILY_FREE_CREDIT / DAILY_FREE_CREDIT).toFixed(1)
  );
  const converted = isConverted(currency);

  const orderedPaid: Array<{ plan: Plan; recommended: boolean }> = [
    ...(PLANS[1] ? [{ plan: PLANS[1], recommended: true }] : []),
    ...(PLANS[0] ? [{ plan: PLANS[0], recommended: false }] : []),
  ];

  const freeFeatures: FeatureRow[] = [
    {
      title: `${DAILY_FREE_CREDIT} Credit daily allowance`,
      description: `${dailyFreeHours} hours of named model chat every day, worldwide.`,
    },
    {
      title: `${TRIAL_CREDIT} Credit welcome trial`,
      description:
        "Upfront trial Credit on your first request so you can test models immediately.",
    },
    {
      title: "DeepSeek V4.1 Flash & GPT-OSS 120B",
      description:
        "Includes 0 Credit/hr Auto routing, cloud sandboxes, previews, and GitHub PRs.",
    },
  ];

  return (
    <div className="grid items-stretch gap-6 lg:grid-cols-3">
      {orderedPaid.map(({ plan, recommended }) => {
        const tierLabel = plan.days === 30 ? "30-day" : "15-day";
        const ctaLabel =
          mode === "pay" && topupPaused
            ? "Checkout paused"
            : `Get ${tierLabel} pass`;
        const ctaHref = mode === "pay" && paymentUrl ? paymentUrl : passCtaHref;
        const isExternal = mode === "pay" && Boolean(paymentUrl);

        const features: FeatureRow[] = [
          {
            title: `${multiplier}x daily usage allowance`,
            description: `${PAID_DAILY_FREE_CREDIT} Credit/day (${paidDailyHours} hrs) instead of ${DAILY_FREE_CREDIT} Credit/day on Free.`,
          },
          {
            title: "Includes Claude Haiku 4.5",
            description:
              "Fast frontier coding alongside DeepSeek V4.1 Flash and GPT-OSS 120B.",
          },
          {
            title: `+${plan.credit} upfront wallet Credit`,
            description:
              "Added to your append-only ledger immediately on top of your daily allowance.",
          },
          {
            title: "Stackable, never auto-renews",
            description: `One-time ${plan.days}-day pass that extends from your current end date.`,
          },
        ];

        return (
          <article
            key={plan.id}
            className={`flex flex-col rounded-[var(--r-lg)] bg-card p-6 ${
              recommended
                ? "border-2 border-accent"
                : "border border-line-strong"
            }`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-[22px] font-medium leading-[1.15] tracking-[-0.025em] text-hi">
                {plan.name}
              </h2>
              <span
                className={`font-mono text-[12px] font-medium ${
                  recommended ? "text-accent-text" : "text-low"
                }`}
              >
                {recommended ? "Most popular" : "Fixed term"}
              </span>
            </div>

            <p className="mt-2 font-mono text-[13px] text-mid">
              {PAID_DAILY_FREE_CREDIT} Credit/day · +{plan.credit} wallet Credit
            </p>

            <div className="mt-5 flex items-baseline gap-1">
              <span className="font-mono text-[34px] font-medium leading-none tracking-[-0.03em] tabular-nums text-hi">
                {formatCardPrice(plan.price, currency)}
              </span>
              <span className="text-[14px] text-mid">/ {plan.days} days</span>
            </div>

            {converted && (
              <p className="mt-1.5 text-[13px] text-low">
                Charged as MYR {plan.price.toFixed(2)} · one-time pass
              </p>
            )}

            <PlanCta
              label={ctaLabel}
              href={ctaHref}
              external={isExternal}
              disabled={mode === "pay" && topupPaused}
              primary={recommended}
            />

            <ul className="mt-6 flex-1 space-y-4 border-t border-line pt-5">
              {features.map((feature) => (
                <li key={feature.title}>
                  <p className="text-[15px] font-medium leading-snug text-hi">
                    {feature.title}
                  </p>
                  <p className="mt-1 text-[14px] leading-[1.5] text-mid">
                    {feature.description}
                  </p>
                </li>
              ))}
            </ul>
          </article>
        );
      })}

      {/* Free Plan Card */}
      <article className="flex flex-col rounded-[var(--r-lg)] border border-line-strong bg-card p-6">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[22px] font-medium leading-[1.15] tracking-[-0.025em] text-hi">
            Free tier
          </h2>
          <span className="font-mono text-[12px] text-low">Ad-supported</span>
        </div>

        <p className="mt-2 font-mono text-[13px] text-mid">
          {DAILY_FREE_CREDIT} Credit/day · {dailyFreeHours} hrs/day
        </p>

        <div className="mt-5 flex items-baseline gap-1">
          <span className="font-mono text-[34px] font-medium leading-none tracking-[-0.03em] tabular-nums text-hi">
            {formatCardPrice(0, currency)}
          </span>
          <span className="text-[14px] text-mid">/ forever</span>
        </div>

        <PlanCta
          label={signedIn ? "Open workspace" : "Start free with GitHub"}
          href={signedIn ? "/chat" : startHref}
        />

        <ul className="mt-6 flex-1 space-y-4 border-t border-line pt-5">
          {freeFeatures.map((feature) => (
            <li key={feature.title}>
              <p className="text-[15px] font-medium leading-snug text-hi">
                {feature.title}
              </p>
              <p className="mt-1 text-[14px] leading-[1.5] text-mid">
                {feature.description}
              </p>
            </li>
          ))}
        </ul>
      </article>
    </div>
  );
}
