import { Check, Cloud, Layers, ShieldCheck, Terminal } from "lucide-react";
import Link from "next/link";

import { OpenmiMark } from "@/components/OpenmiMark";
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
  const base =
    "mt-6 flex h-12 w-full items-center justify-center rounded-full px-5 text-[15px] font-medium transition-opacity";
  const tone = disabled
    ? "cursor-not-allowed border border-line bg-raised text-low"
    : primary
      ? "bg-accent text-on-accent hover:opacity-90"
      : "border border-line-strong bg-raised text-hi hover:bg-hover";

  if (disabled) {
    return (
      <span aria-disabled="true" className={`${base} ${tone}`}>
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
        className={`${base} ${tone}`}
      >
        {label}
      </a>
    );
  }

  return (
    <Link href={href} className={`${base} ${tone}`}>
      {label}
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

  // Order: Recommended 30-day pass FIRST so mobile opens directly onto the
  // blue-bordered RECOMMENDED card (1:1 with the Google One screen).
  const orderedPaid: Array<{ plan: Plan; recommended: boolean }> = [
    ...(PLANS[1] ? [{ plan: PLANS[1], recommended: true }] : []),
    ...(PLANS[0] ? [{ plan: PLANS[0], recommended: false }] : []),
  ];

  const freeFeatures: FeatureRow[] = [
    {
      title: `${DAILY_FREE_CREDIT} Credit daily allowance`,
      description: `Get ${dailyFreeHours} full hours of named model chat every day, worldwide`,
    },
    {
      title: `${TRIAL_CREDIT} Credit welcome trial`,
      description:
        "Extra upfront trial Credit on your first request to test models right away",
    },
    {
      title: "Access DeepSeek V4.1 & GPT-OSS 120B",
      description:
        "Includes 0 Credit/hr Auto routing across available free models",
    },
  ];

  return (
    <div className="grid items-stretch gap-5 lg:grid-cols-3">
      {orderedPaid.map(({ plan, recommended }) => {
        const tierLabel = plan.days === 30 ? "30-day" : "15-day";
        const ctaLabel =
          mode === "pay" && topupPaused
            ? "Checkout paused"
            : `Get Openmi AI ${tierLabel}`;
        const ctaHref = mode === "pay" && paymentUrl ? paymentUrl : passCtaHref;
        const isExternal = mode === "pay" && Boolean(paymentUrl);

        const features: FeatureRow[] = [
          {
            title: `${multiplier}x higher usage limits than Free plan¹`,
            description: `Get ${PAID_DAILY_FREE_CREDIT} Credit/day (${paidDailyHours} hrs) instead of ${DAILY_FREE_CREDIT} Credit/day on the Free plan`,
          },
          {
            title: "Access to Claude Haiku 4.5",
            description:
              "Get fast frontier coding performance alongside DeepSeek V4.1 & GPT-OSS 120B",
          },
          {
            title: `+${plan.credit} upfront wallet Credit`,
            description: recommended
              ? "Banked immediately in your ledger — over 2x the bonus of the 15-day pass"
              : "Banked immediately in your ledger on top of your daily allowance",
          },
        ];

        return (
          <article
            key={plan.id}
            className={`flex flex-col rounded-[24px] bg-card p-6 sm:p-7 ${
              recommended
                ? "border-2 border-accent"
                : "border border-line-strong"
            }`}
          >
            {recommended ? (
              <p className="text-[11px] font-semibold tracking-[0.06em] text-accent-text uppercase">
                RECOMMENDED
              </p>
            ) : (
              <p className="text-[11px] font-semibold tracking-[0.06em] text-low uppercase">
                FIXED-TERM PASS
              </p>
            )}

            <h2 className="mt-2 text-[28px] font-medium leading-[1.15] tracking-[-0.025em] text-hi">
              Openmi AI <span className="text-accent-text">{tierLabel}</span>
            </h2>

            <div className="mt-3.5">
              <span className="inline-flex items-center gap-2 rounded-full bg-raised px-3.5 py-1.5 text-[13px] font-medium text-hi">
                <Cloud
                  aria-hidden="true"
                  className="size-4 text-hi"
                  strokeWidth={1.75}
                />
                <span>
                  {PAID_DAILY_FREE_CREDIT} Credit/day · +{plan.credit} Credit
                </span>
              </span>
            </div>

            <div className="mt-5">
              <p className="text-[15px] font-normal text-mid">Starting at</p>
              <div className="mt-1 flex items-baseline gap-0.5">
                <span className="text-[36px] font-medium leading-none tracking-[-0.025em] tabular-nums text-hi sm:text-[38px]">
                  {formatCardPrice(plan.price, currency)}
                </span>
                <span className="text-[16px] font-normal text-hi">
                  /{plan.days}d
                </span>
              </div>
              {converted && (
                <p className="mt-1.5 text-[12px] text-low">
                  Charged as MYR {plan.price.toFixed(2)} · no auto-renewal
                </p>
              )}
            </div>

            <PlanCta
              label={ctaLabel}
              href={ctaHref}
              external={isExternal}
              disabled={mode === "pay" && topupPaused}
              primary={recommended}
            />

            <div className="mt-7 flex-1">
              <div className="flex items-center gap-3">
                <OpenmiMark size={22} />
                <span className="text-[17px] font-medium tracking-[-0.015em] text-hi">
                  Openmi AI
                </span>
              </div>

              <ul className="mt-5 space-y-5">
                {features.map((feature) => (
                  <li key={feature.title} className="flex items-start gap-3.5">
                    <Check
                      aria-hidden="true"
                      className="mt-0.5 size-5 shrink-0 text-body"
                      strokeWidth={2}
                    />
                    <div>
                      <p className="text-[15px] font-medium leading-snug text-hi">
                        {feature.title}
                      </p>
                      <p className="mt-1 text-[14px] leading-[1.45] text-mid">
                        {feature.description}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <hr className="my-6 border-line" />

            <div>
              <p className="text-[15px] font-medium leading-snug text-hi">
                Includes higher access to Openmi&apos;s workspace and more¹
              </p>

              <ul className="mt-5 space-y-4">
                <li className="flex items-start gap-3.5">
                  <Terminal
                    aria-hidden="true"
                    className="mt-0.5 size-5 shrink-0 text-body"
                    strokeWidth={1.75}
                  />
                  <div>
                    <p className="text-[15px] font-medium leading-snug text-hi">
                      Sandbox, live previews &amp; GitHub PRs²
                    </p>
                    <p className="mt-1 text-[14px] leading-[1.45] text-mid">
                      Full coding workspace for editing files, running builds,
                      and opening pull requests
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-3.5">
                  <Layers
                    aria-hidden="true"
                    className="mt-0.5 size-5 shrink-0 text-body"
                    strokeWidth={1.75}
                  />
                  <div>
                    <p className="text-[15px] font-medium leading-snug text-hi">
                      Zero auto-renewal · stackable
                    </p>
                    <p className="mt-1 text-[14px] leading-[1.45] text-mid">
                      One-time {plan.days}-day pass that extends from your
                      current end date
                    </p>
                  </div>
                </li>
              </ul>
            </div>
          </article>
        );
      })}

      {/* Free Plan Card */}
      <article className="flex flex-col rounded-[24px] border border-line-strong bg-card p-6 sm:p-7">
        <p className="text-[11px] font-semibold tracking-[0.06em] text-low uppercase">
          FREE PLAN
        </p>

        <h2 className="mt-2 text-[28px] font-medium leading-[1.15] tracking-[-0.025em] text-hi">
          Openmi <span className="text-mid">Free</span>
        </h2>

        <div className="mt-3.5">
          <span className="inline-flex items-center gap-2 rounded-full bg-raised px-3.5 py-1.5 text-[13px] font-medium text-hi">
            <Cloud
              aria-hidden="true"
              className="size-4 text-hi"
              strokeWidth={1.75}
            />
            <span>
              {DAILY_FREE_CREDIT} Credit/day · {dailyFreeHours} hrs
            </span>
          </span>
        </div>

        <div className="mt-5">
          <p className="text-[15px] font-normal text-mid">Always free</p>
          <div className="mt-1 flex items-baseline gap-0.5">
            <span className="text-[36px] font-medium leading-none tracking-[-0.025em] tabular-nums text-hi sm:text-[38px]">
              {formatCardPrice(0, currency)}
            </span>
            <span className="text-[16px] font-normal text-hi">/mo</span>
          </div>
        </div>

        <PlanCta
          label={signedIn ? "Continue on Free" : "Get Openmi Free"}
          href={signedIn ? "/chat" : startHref}
        />

        <div className="mt-7 flex-1">
          <div className="flex items-center gap-3">
            <OpenmiMark size={22} />
            <span className="text-[17px] font-medium tracking-[-0.015em] text-hi">
              Openmi AI
            </span>
          </div>

          <ul className="mt-5 space-y-5">
            {freeFeatures.map((feature) => (
              <li key={feature.title} className="flex items-start gap-3.5">
                <Check
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0 text-body"
                  strokeWidth={2}
                />
                <div>
                  <p className="text-[15px] font-medium leading-snug text-hi">
                    {feature.title}
                  </p>
                  <p className="mt-1 text-[14px] leading-[1.45] text-mid">
                    {feature.description}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <hr className="my-6 border-line" />

        <div>
          <p className="text-[15px] font-medium leading-snug text-hi">
            Includes coding workspace &amp; failure protection
          </p>

          <ul className="mt-5 space-y-4">
            <li className="flex items-start gap-3.5">
              <Terminal
                aria-hidden="true"
                className="mt-0.5 size-5 shrink-0 text-body"
                strokeWidth={1.75}
              />
              <div>
                <p className="text-[15px] font-medium leading-snug text-hi">
                  Sandbox, live previews &amp; GitHub PRs
                </p>
                <p className="mt-1 text-[14px] leading-[1.45] text-mid">
                  Edit files, run builds, and open pull requests from chat
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3.5">
              <ShieldCheck
                aria-hidden="true"
                className="mt-0.5 size-5 shrink-0 text-body"
                strokeWidth={1.75}
              />
              <div>
                <p className="text-[15px] font-medium leading-snug text-hi">
                  Automatic failure refunds
                </p>
                <p className="mt-1 text-[14px] leading-[1.45] text-mid">
                  Hour charges release automatically if a model provider drops
                </p>
              </div>
            </li>
          </ul>
        </div>
      </article>
    </div>
  );
}
