import { PLANS } from "@/lib/billing/plans";
import { AGENT_BRANCH_PREFIX } from "@/lib/branch";
import {
  CREDIT_PER_HOUR,
  DAILY_FREE_CREDIT,
  INVITE_REWARD_CREDIT,
  MAX_INVITES_PER_ACCOUNT,
  PAID_DAILY_FREE_CREDIT,
  TRIAL_CREDIT,
} from "@/lib/credits";
import { MODELS } from "@/lib/models";
import { SITE_DESCRIPTION, SITE_NAME, siteUrl } from "@/lib/seo";

/**
 * Dynamic llms.txt rendered directly from the app's billing, credit, and model
 * constants so AI search engines (ChatGPT, Perplexity, Claude, Gemini) always
 * read the exact same numbers as the live pricing and product pages.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const origin = siteUrl();
  const dailyFreeHours = Math.floor(DAILY_FREE_CREDIT / CREDIT_PER_HOUR);
  const paidDailyHours = Math.floor(PAID_DAILY_FREE_CREDIT / CREDIT_PER_HOUR);
  const publicModels = MODELS.filter((model) => !model.adminOnly);

  const planLines = PLANS.map(
    (plan) =>
      `- ${plan.name}: RM ${plan.price} one-time (${plan.days} days, +${plan.credit} upfront wallet Credit, ${PAID_DAILY_FREE_CREDIT} Credit/day [${paidDailyHours} hrs/day], unlocks Claude Haiku 4.5, no auto-renewal)`
  ).join("\n");

  const modelLines = publicModels
    .map(
      (model) =>
        `- ${model.name}: ${model.creditPerHour} Credit/hr (${model.paidOnly ? "Paid pass" : "Free & paid pass"})`
    )
    .join("\n");

  const body = `# ${SITE_NAME}

> ${SITE_DESCRIPTION}

## Key pages

- Home: ${origin}/
- Pricing & passes: ${origin}/pricing
- How Openmi works & execution boundaries: ${origin}/about
- Refunds & cancellation policy: ${origin}/refunds
- Terms of Service: ${origin}/terms
- Privacy Policy: ${origin}/privacy

## Pricing & Credit rules

- Hourly rate: ${CREDIT_PER_HOUR} Credit/hr per named model (Auto is 0 Credit/hr). Unlimited follow-up turns inside an active hour.
- Free tier (ad-supported, no card, no API keys): ${DAILY_FREE_CREDIT} free Credit/day (${dailyFreeHours} hrs/day) plus ${TRIAL_CREDIT} Credit trial grant on first turn (1 per IP per 24 hours).
- Paid passes (fixed-term, stackable, never auto-renew, settled in MYR via hosted checkout):
${planLines}
- Invite rewards: +${INVITE_REWARD_CREDIT} Credit for both inviter and invitee on the invitee's first paid pass (up to ${MAX_INVITES_PER_ACCOUNT} invites per account).
- Failed-hour protection: If a model provider returns no answer before the first token, the hour charge is released back to your balance automatically.

## Available models

${modelLines}

## Technical workflow & boundaries

- One GitHub repository per conversation, pinned to the exact commit SHA.
- Reads repository files and cites verified path:line locations from that commit.
- Writes unified per-file diffs to ${AGENT_BRANCH_PREFIX}<changeset-id> and opens one pull request (never force-pushes, never writes to the default branch unless explicitly named).
- Runs dependency installs and builds inside a per-chat cloud Linux sandbox (48-hour idle TTL) with live previews, one-click Vercel publish, and observed exit codes only.
- GitHub OAuth or fine-grained tokens are encrypted server-side with AES-256-GCM.
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
