import Link from "next/link";

import { LegalPage, type LegalSection } from "@/components/LegalPage";
import { pageMetadata } from "@/lib/seo";

/**
 * The refund and cancellation policy, in one place.
 *
 * The Terms describe billing as part of the contract; this page is the answer
 * to the question a reader asks before paying and a scan asks after: what
 * happens to my money if I change my mind, stop using the service, or never get
 * an answer. It is published on its own URL so it can be linked from checkout,
 * the footer and every legal page, and it is deliberately blunt: every sale is
 * final. The one automatic correction — an hour the provider never answered —
 * is a metering fix, not a discretionary refund, and the page says so instead
 * of leaving a contradiction between the ledger and the policy.
 */

export const metadata = pageMetadata({
  path: "/refunds",
  title: "Refunds and Cancellation Policy | Openmi",
  description:
    "Openmi's refund and cancellation policy: all sales are final, passes do not renew, unused Credit is not refundable, and how to raise a payment problem or delete your account.",
});

const LAST_UPDATED = "November 15, 2026";

const SECTIONS: LegalSection[] = [
  {
    id: "scope",
    title: "1. What this policy covers",
    blocks: [
      {
        kind: "p",
        text: "This policy explains when Openmi (“we”, “us”) refunds a payment, and how a reader cancels. It applies to every paid product we offer — Credit top-ups, plans, passes, redeem codes bought from us — and to the subscription to the service itself. It forms part of our Terms of Service, and where the two documents differ about money, this page is the specific one.",
      },
      {
        kind: "p",
        text: "Payment is taken on a hosted payment page operated by Sociabuzz, not in this app. We never receive or store card details, and the payment provider's own rules apply to the transaction it processes alongside this policy.",
      },
    ],
  },
  {
    id: "all-sales-final",
    title: "2. All sales are final",
    blocks: [
      {
        kind: "p",
        text: "Every purchase is final. Once a payment is made and the Credit, plan or pass is granted, we do not offer refunds, credits, exchanges or partial refunds. That includes, without limitation:",
      },
      {
        kind: "list",
        items: [
          "A change of mind after paying.",
          "Credit you have not spent, including a balance left when you stop using the service.",
          "Unused days on a pass, and a pass you decide not to use.",
          "An account you close, suspend or abandon, and a plan you no longer need.",
          "A model answer you did not find useful, and a change you undid after it was written.",
          "A price or allowance that changed after you bought, which applies to hours started after the change.",
        ],
      },
      {
        kind: "p",
        text: "Top-ups and passes are granted automatically or when a receipt you uploaded is approved. Approval is recorded against your receipt, and the grant is a ledger row you can read on the activity page. A rejected receipt is not a sale: nothing was granted, and nothing is owed.",
      },
    ],
  },
  {
    id: "cancellation",
    title: "3. Passes are not subscriptions",
    blocks: [
      {
        kind: "p",
        text: "A plan or pass runs for the number of days shown at purchase and then ends by itself. Nothing renews automatically, no card is stored, and no recurring charge is created — so there is nothing to cancel to stop future payments.",
      },
      {
        kind: "p",
        text: "You can stop using Openmi at any time, and you can close your account yourself at /account/delete. Closing an account, ending a pass early or simply walking away does not refund an unexpired pass or an unspent Credit balance.",
      },
      {
        kind: "p",
        text: "If we end your access for a material breach of the Terms, the balance and any unexpired pass are not refunded either. Where the law gives you a right that cannot be excluded, section 8 explains how to raise it and it applies regardless of this paragraph.",
      },
    ],
  },
  {
    id: "credit",
    title: "4. Credit is a licence, not a deposit",
    blocks: [
      {
        kind: "p",
        text: "Credit is the unit one hour of chat is billed in. It has no cash value, is not a deposit or stored value, is not transferable between accounts, and may not be resold. Buying Credit buys the right to spend it in the service, not a claim on money we hold for you. Credit granted free — the daily allowance, trial credit, invite rewards, operator adjustments — carries the same limits and is never convertible to cash.",
      },
    ],
  },
  {
    id: "failed-hour",
    title: "5. An hour the provider never answered",
    blocks: [
      {
        kind: "p",
        text: "The hour is charged before the model provider is called. If the provider returns no answer at all — an error, a conflict, or a turn stopped before the first token — the hour is released back to your balance automatically by the ledger. That release is how the meter is corrected: you were charged for work the service never delivered. It is not a discretionary refund, it does not apply once an answer has started arriving, and it is not a route to a refund for a purchase.",
      },
      {
        kind: "p",
        text: "Stopping a turn after text has arrived keeps the hour charged, because the answer is kept and the turn can be continued inside the same hour. So does pausing a turn or reaching a step limit, because the work already done is saved. Every one of those outcomes is visible in the ledger and on the activity page.",
      },
    ],
  },
  {
    id: "payment-problems",
    title: "6. Payment problems and chargebacks",
    blocks: [
      {
        kind: "p",
        text: "If a payment is missing from your account, a receipt was rejected, or you believe a payment was made without your authorisation, write to the address in section 10 with the transaction reference and the date. We will check the receipt queue and the ledger with you. Contacting us first is the fastest route: a card issuer cannot see our ledger, and a disputed transaction may suspend the account while it is investigated.",
      },
      {
        kind: "list",
        items: [
          "A chargeback or payment dispute is decided by your bank or card issuer under its own rules, not by this policy.",
          "If a dispute is raised for a purchase we can show was delivered and used, we may suspend the account until it is resolved and may recover the disputed amount and any fees from the balance.",
          "Nothing in this policy prevents you from reporting suspected fraud to your bank or to a regulator.",
        ],
      },
    ],
  },
  {
    id: "closing",
    title: "7. Closing your account",
    blocks: [
      {
        kind: "p",
        text: "You do not need our permission to leave. Sign in and open /account/delete to delete your account and the data we control ourselves, without writing to support. Deletion is immediate and cannot be undone: the profile, chats, messages, repository connection, uploaded receipts, run and sandbox records and the ledger rows are removed. If you cannot sign in, write to the address in section 10 and we will action the request after confirming the account is yours.",
      },
      {
        kind: "p",
        text: "Deleting an account does not create a refund. Any Credit balance and any unexpired pass are forfeited when the account is deleted, as described in section 2.",
      },
    ],
  },
  {
    id: "statutory-rights",
    title: "8. Your statutory rights",
    blocks: [
      {
        kind: "p",
        text: "Nothing in this policy excludes or limits a right or remedy you have under a law that cannot be excluded or limited — including consumer rights in your country of residence. If you believe such a right applies to your purchase, write to the address in section 10 with the details and the legal basis you rely on, and we will consider it under that law rather than under this policy.",
      },
      {
        kind: "p",
        text: "You may also complain to the consumer or data-protection authority in your country. We would appreciate the chance to resolve the issue first.",
      },
    ],
  },
  {
    id: "changes",
    title: "9. Changes to this policy",
    blocks: [
      {
        kind: "p",
        text: "We may update this policy as the service changes. The revised version is posted here with a new date, and it applies to purchases made after it takes effect. A purchase is governed by the policy in force on the day it was made.",
      },
    ],
  },
];

export default function RefundsPage() {
  return (
    <LegalPage
      path="/refunds"
      eyebrow="legal"
      title="Refunds and cancellation"
      updated={LAST_UPDATED}
      intro="Every purchase is final: Openmi does not offer refunds, credits or cancellations for Credit, plans or passes. This page states that plainly, explains the one automatic correction the meter makes, and tells you how to raise a payment problem or close your account."
      pricingNote={
        <>
          Before buying a fixed-term pass, review the{" "}
          <Link
            href="/pricing"
            className="font-medium text-accent-text underline-offset-2 hover:underline"
          >
            full Openmi pass comparison and daily Credit allowances
          </Link>
          .
        </>
      }
      sections={SECTIONS}
      contact={{
        title: "10. Contact",
        lead: "Questions about a charge, a rejected receipt or this policy:",
        subject: "Billing question",
      }}
      other={{ href: "/terms", label: "Terms" }}
    />
  );
}
