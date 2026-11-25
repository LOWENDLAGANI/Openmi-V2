# Pricing and billing follow-ups

Ranked by value: what protects money already being taken first, then what brings
more in, then what makes the numbers readable. Effort is S (a day or less),
M (a few days), L (a week or more).

**The one number that matters.** A pass is not priced per Credit. RM18 buys 227
Credit (15 days × 15/day + 2) and RM36 buys 453 (30 × 15 + 3), so both sell
Credit at about **RM 0.079** and a chat hour at about **RM 0.24**. Everything
below is measured against that price, not the sticker on the pass.

## 1. Price the allowance against real model cost — M

Why: `lib/billing/economics.ts` (added with this note) now shows the pass buys
~76 or ~151 chat hours for RM18 / RM36, at RM0.24 of revenue per hour. Whether
that is profitable depends entirely on the provider bill for an hour on
DeepSeek V4.1 flash, GPT-OSS 120B and Claude Haiku 4.5 — a number this
repository does not record anywhere. The wallet grant cut from 30/70 to 2/3
changed almost nothing (the wallet is now under 1% of a pass); the daily
allowance is where the money is.

Also why: D6.2 prices sandbox time at 0.05 Credit/minute, which is fine against
the RM9-per-Credit wallet floor and a loss against the RM0.079 the allowance
actually costs — RM0.0040 earned per minute against RM0.0126 of compute, and
RM0.16 per hour against RM0.754. Every execution hour currently sells below
cost unless the allowance price is treated as the cost of Credit.

Do: instrument one median chat hour and one median sandbox hour with provider
cost, then set the allowance and the execution rate from that measurement.
Until then, treat both prices as provisional.

## 2. Record provider cost per run — M

Why: #1 cannot be done by hand for long. Each run has a model, token counts and
a provider; a `provider_cost` figure written at settlement turns every later
pricing question into a query. The append-only ledger already records Credit;
cost belongs beside it, never inside it.

Do: capture usage from the provider response in the worker, store cost on the
run row (or a `run_costs` table), and expose a margin figure in admin. Keep it
service-role only.

## 3. Remind members before a pass ends — S/M

Why: a pass ends and the account silently drops from 15 Credit/day to 6. That
is the single easiest repeat purchase to recover, and there is already a cron
route (`app/api/cron/run-sweep`) and a mail path (`lib/email/receipt.ts`) to
reuse. Two days before `paid_until`, one email with the end date and a link to
the passes page, deduplicated per pass.

## 4. Price the hour per model — M

Why: every named model costs 3 Credit/hour, so DeepSeek subsidises Claude Haiku
and any future expensive model. The plumbing already supports per-model prices
(`ModelCapability.creditPerHour`, `model_hour_credit` in the database, a test
that keeps them equal); this is a price decision, not a schema change. Once #2
exists, set each model's hour from its measured cost plus the same margin.

## 5. Retire or restate "+2 / +3 upfront wallet Credit" — S

Why: the bullet still reads like a purchase reason, but the grant is 0.9% and
0.7% of what a pass includes. Either drop the wallet grant to 0 and simplify
approval, or call it what it is ("2 Credit starter balance") instead of a
headline feature. Leaving it as marketing invites "where are my 30 Credit"
support mail.

## 6. A revenue and liability view in admin — M

Why: admin counts receipts and Credit held, but not money. The useful figures
are passes sold, active passes, Credit granted vs Credit spent, and outstanding
wallet balance. The last one is a real liability: wallet Credit never expires
(migrations 057/058), unlike the daily pool, so it must be visible before it is
large.

## 7. Receipt review SLA and queue alerts — S

Why: approval is the only way money becomes access, and it is manual. A stale
pending queue delays entitlement, generates duplicate uploads and is the usual
precursor to a chargeback. Add the age of the oldest pending receipt to admin,
and a once-a-day digest when it passes a threshold.

## 8. Cap stacked pass length — S

Why: passes stack and extend from the current end date with no ceiling. One
account can prepay months of 15 Credit/day allowance, which is both a liability
and an abuse vector (resale, shared accounts). Cap total stacked days (for
example 90) and flag bulk approvals in the risk feed that already exists.

## 9. Charge in the currency the price is shown in — M/L

Why: the page converts MYR into the reader's currency, then the hosted checkout
charges MYR. The one moment where conversion friction costs a sale is the one
with a currency switch in it. Either say plainly "charged in MYR" next to the
button (cheap) or add a payment rail that settles in local currency.

## 10. Put a ceiling on the free tier's Credit — M

Why: 6 Credit/day is about RM0.48 of Credit a day per active free account at
the pass price, roughly RM14 a month, paid for by ads. That is a fine bet while
ad revenue per user covers it and a quiet loss when it does not. Track
Credit spent by free accounts against ad revenue per active user, and set the
allowance from that ratio rather than from feel.

## Smaller, still worth doing

- **Trial and invite tightening:** the trial is 5 Credit per address per day and
  invites are capped at 10, but neither is tied to account age; a minimum
  GitHub account age would cut the cheapest abuse.
- **A bundle price:** three 30-day passes at a small discount matches how
  "pay once" is sold elsewhere, and it monetises the stacking that already
  works.
- **Publish the refund rule where the price is:** refunds are per failed
  session, never automatic on cancellation — one line next to the pass price
  prevents most of the arguments.

## Done in this change

- `lib/billing/economics.ts` + `tests/economics.test.ts`: allowance Credit, chat
  hours, effective RM per Credit, revenue per chat hour, wallet share and
  break-even cost, all derived from `PLANS` and `lib/credits.ts`.
- D6.2 in `docs/EXECUTION_ENVIRONMENT_PLAN.md` now states the allowance's
  effective price alongside the wallet floor.
