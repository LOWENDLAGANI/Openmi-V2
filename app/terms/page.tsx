import { LegalPage, type LegalSection } from "@/components/LegalPage";
import { DEW_PER_HOUR, DAILY_FREE_DEW, PAID_DAILY_FREE_DEW, TRIAL_DEW } from "@/lib/dew";

export const metadata = {
  title: "Terms of Service — Openmi",
  description:
    "The terms that govern your use of Openmi: accounts, GitHub access, billing in Dew, automatic changes, acceptable use, and liability.",
};

const LAST_UPDATED = "November 13, 2026";

const SECTIONS: LegalSection[] = [
  {
    id: "agreement",
    title: "1. Agreement",
    blocks: [
      {
        kind: "p",
        text: "These terms are an agreement between you and the operator of Openmi (“we”, “us”) and govern your use of the Openmi service, including the website, the chat workspace, and any sandbox, preview or publishing feature. By creating an account or using the service you accept them. If you do not accept them, do not use the service.",
      },
      {
        kind: "p",
        text: "If you use Openmi for an organisation, you confirm that you are authorised to bind it, and “you” includes that organisation.",
      },
    ],
  },
  {
    id: "accounts",
    title: "2. Eligibility and accounts",
    blocks: [
      {
        kind: "list",
        items: [
          "You must be at least 16 years old and able to enter into a binding contract.",
          "There is no guest mode: every action belongs to an authenticated account, created through GitHub or email sign-in.",
          "Keep your email address accurate and current; it is used for account recovery and billing notices.",
          "You are responsible for your credentials and for all activity under your account. Tell us promptly if you believe it has been compromised.",
          "Do not share an account between people to avoid charges, and do not create accounts to evade a suspension or a rate limit.",
        ],
      },
    ],
  },
  {
    id: "github",
    title: "3. GitHub access and permissions",
    blocks: [
      {
        kind: "p",
        text: "Connecting a repository requires a personal access token you provide or an OAuth grant you approve. The token is sealed with AES-256-GCM on our servers, and only its last four characters are ever shown again. You confirm that you are entitled to connect every repository you select, that you may authorise the reads and writes described here, and that your use complies with GitHub’s terms.",
      },
      {
        kind: "p",
        text: "Reads are made through a client that issues only GET requests, at the commit a chat is pinned to. Writes go to a branch created for the change, or to a branch you explicitly name. We never force-push, never merge a pull request we did not open, and never write to your default branch unless you name it as the destination or an operator has enabled default-branch writes for the deployment.",
      },
    ],
  },
  {
    id: "service",
    title: "4. What the service does, and what it does not",
    blocks: [
      {
        kind: "p",
        text: "Openmi reads the repository you connect, answers with path and line citations, and proposes changes as per-file diffs. Where execution is enabled it can install dependencies, run a build, run commands you ask for inside a disposable Linux sandbox, and report the exit codes it observed. It does not run your test suite as a verification step, and the product does not claim a test, build, commit or deployment that was not observed.",
      },
      {
        kind: "p",
        text: "Model output can be wrong, incomplete or insecure, and an automated change can compile but still be wrong for your project. You are responsible for reviewing a change and for what happens after it reaches your repository.",
      },
    ],
  },
  {
    id: "your-content",
    title: "5. Your content and licence",
    blocks: [
      {
        kind: "p",
        text: "You keep all rights to the code, chats and other content you submit. You grant us a limited, non-exclusive, worldwide licence to host, copy, process and transmit that content only as needed to operate the service: storing your chats, reading the repository you connected, sending your prompt and the relevant code to the model provider you select, and running builds in a sandbox when you ask for them.",
      },
      {
        kind: "p",
        text: "You confirm that you have the rights needed to submit that content, including any third-party code, and that it contains no secrets you are not authorised to share. Do not paste credentials into a chat or a sandbox: anything you send there is processed like any other message.",
      },
    ],
  },
  {
    id: "acceptable-use",
    title: "6. Acceptable use",
    blocks: [
      {
        kind: "list",
        items: [
          "Do not break the law, infringe the rights of others, or use the service to plan or carry out harm.",
          "Do not attack, scan or overload systems you do not own, including ours.",
          "Do not use sandboxes or preview addresses to run unauthorised workloads, mine cryptocurrency, host services for third parties, or evade rate limits or billing.",
          "Do not scrape or harvest data, or resell access to the service, without our written permission.",
          "Do not attempt to reach another account’s data or to circumvent row-level security.",
          "Respect the published rate limits, and make automated access identifiable.",
        ],
      },
      {
        kind: "p",
        text: "We may suspend or close an account that breaches these rules, and may remove content that does. Where it is reasonable and lawful to do so, we will tell you why.",
      },
    ],
  },
  {
    id: "billing",
    title: "7. Dew, plans and refunds",
    blocks: [
      {
        kind: "p",
        text: `Chat is billed in Dew. Each model has an hourly price, shown before you send; for every built-in model today it is ${DEW_PER_HOUR} Dew per hour. The hour is charged before the model provider is called, and further turns inside that hour are included. Every charge, refund and grant is written to an append-only ledger you can read on the activity page.`,
      },
      {
        kind: "p",
        text: `A daily allowance is granted once per local day: ${DAILY_FREE_DEW} Dew on the free tier, and ${PAID_DAILY_FREE_DEW} Dew while a paid plan is active. A trial credit of ${TRIAL_DEW} Dew is granted once per account, with at most one trial per address in any 24-hour period. An invite rewards the inviter and the invited account 5 Dew each, up to 10 rewarded accounts per inviter.`,
      },
      {
        kind: "list",
        items: [
          "Paid plans are sold through a hosted payment page operated by Sociabuzz. We never receive or store card details.",
          "A plan becomes active when a receipt you upload is approved. A redeem code issued by an operator adds Dew only; it does not start or extend a pass.",
          "A refund is recorded when the provider fails — including when it fails after streaming part of an answer — or when you stop a turn before the first token. Stopping after text has arrived, reaching a time or step limit, or pausing a turn does not refund, because the work is kept and the turn can continue.",
          "Dew has no cash value, is not transferable, and may not be resold. A balance is a licence to use the service, not a deposit, and it is not redeemable for money.",
          "Prices and allowances may change. A change applies to hours started after it is announced in the product.",
        ],
      },
    ],
  },
  {
    id: "automation",
    title: "8. Automatic changes and review",
    blocks: [
      {
        kind: "p",
        text: "By default a ready change is applied for you: it is written to its own branch, a pull request is opened, and the change is squash-merged, with the resulting commit recorded on the review card. A deployment can instead require your explicit approval before anything is written, in which case the card asks first.",
      },
      {
        kind: "p",
        text: "You can reject a pending change and undo an applied one. A change you name a destination for is written to that branch directly. Nothing is force-pushed, and a branch you did not name is never rewritten. You remain responsible for reviewing a change and for any consequence of applying it.",
      },
    ],
  },
  {
    id: "advertising",
    title: "9. Advertising",
    blocks: [
      {
        kind: "p",
        text: "Openmi is supported by banner advertising. Ad frames are loaded only after you consent to them, and you may withdraw that consent at any time as described in the Privacy Policy. Where advertising is enabled, the product may pause while an ad blocker hides the banners it relies on, and the screen says so when it happens.",
      },
    ],
  },
  {
    id: "third-parties",
    title: "10. Third-party services",
    blocks: [
      {
        kind: "p",
        text: "The service depends on providers operated by others, including Supabase, Vercel, GitHub, OpenRouter, DeepSeek, E2B, Resend, Upstash, Adsterra and Sociabuzz. Your use of those services through Openmi is also subject to their own terms, and we are not responsible for their availability, pricing or conduct.",
      },
    ],
  },
  {
    id: "availability",
    title: "11. Availability and changes to the service",
    blocks: [
      {
        kind: "p",
        text: "We provide the service as it stands on the day you use it. Features may be added, changed or withdrawn, including sandbox, preview and mission features, and a deployment may enable or disable them. We may suspend the service for maintenance or where necessary to protect it or its users. Nothing in these terms obliges us to keep any particular feature or price.",
      },
    ],
  },
  {
    id: "ip",
    title: "12. Intellectual property",
    blocks: [
      {
        kind: "p",
        text: "Openmi, including its software, text, design and marks, belongs to the operator or its licensors. These terms grant you a limited, revocable, non-exclusive right to use the service for its intended purpose; they transfer no ownership. Do not copy, resell or white-label the service without our written permission. Feedback you send may be used to improve the service without obligation to you.",
      },
    ],
  },
  {
    id: "disclaimers",
    title: "13. Disclaimers",
    blocks: [
      {
        kind: "p",
        text: "To the maximum extent permitted by law, the service is provided “as is” and “as available”, without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, accuracy and non-infringement. We do not warrant that the service will be uninterrupted, error-free or secure, that model output will be correct, or that a proposed change will compile, pass tests or be safe to deploy.",
      },
      {
        kind: "p",
        text: "Nothing in these terms excludes a warranty, right or remedy that cannot lawfully be excluded, including your statutory rights as a consumer.",
      },
    ],
  },
  {
    id: "liability",
    title: "14. Limitation of liability",
    blocks: [
      {
        kind: "p",
        text: "To the maximum extent permitted by law, we are not liable for indirect, incidental, special, consequential or punitive damages, or for lost profits, revenue, data, code or goodwill, arising out of or in connection with your use of the service, however caused and under whatever theory of liability. Our total aggregate liability for all claims relating to the service is limited to the greater of the amount you paid us in the twelve months before the event giving rise to the claim, or MYR 100.",
      },
      {
        kind: "p",
        text: "Nothing in this section limits liability for fraud or wilful misconduct, for death or personal injury caused by negligence, or for any other liability that cannot be limited by law.",
      },
    ],
  },
  {
    id: "indemnity",
    title: "15. Indemnity",
    blocks: [
      {
        kind: "p",
        text: "You will indemnify and hold us harmless from claims, damages and costs, including reasonable legal fees, arising from content you submit, from a repository you connect without authority, or from your breach of these terms or of another person’s rights. This does not apply to the extent a claim results from our own breach or negligence.",
      },
    ],
  },
  {
    id: "termination",
    title: "16. Termination",
    blocks: [
      {
        kind: "p",
        text: "You may stop using the service at any time and ask us to close your account using the address in section 20. We may suspend or terminate an account for a material breach of these terms, to comply with the law, or to protect the service or other users. Where it is reasonable, we will give notice and a chance to retrieve your data first.",
      },
      {
        kind: "p",
        text: "On termination your right to use the service ends. Clauses that by their nature should survive do survive, including payment obligations, disclaimers, liability, indemnity, and governing law.",
      },
    ],
  },
  {
    id: "law",
    title: "17. Governing law and disputes",
    blocks: [
      {
        kind: "p",
        text: "These terms are governed by the laws of Malaysia, without regard to its conflict-of-law rules. Before starting proceedings, both sides agree to try in good faith to resolve a dispute by writing to the contact address. Subject to any right you have as a consumer to bring a claim in your local courts, the courts of Malaysia have exclusive jurisdiction.",
      },
    ],
  },
  {
    id: "updates",
    title: "18. Changes to these terms",
    blocks: [
      {
        kind: "p",
        text: "We may update these terms as the service changes. The revised version is posted here with a new date, and material changes are announced in the product before they take effect. Continuing to use the service after a change takes effect means the revised terms apply to you.",
      },
    ],
  },
  {
    id: "general",
    title: "19. General",
    blocks: [
      {
        kind: "list",
        items: [
          "If a provision is unenforceable, it is limited to the minimum extent necessary and the remainder stays in force.",
          "A failure to enforce a provision is not a waiver of it.",
          "You may not assign these terms without our written consent; we may assign them to a successor of the service.",
          "These terms, together with the Privacy Policy and any plan terms shown at purchase, are the entire agreement between us about the service.",
          "Headings are for navigation only and do not affect interpretation.",
        ],
      },
    ],
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="legal"
      title="Terms of Service"
      updated={LAST_UPDATED}
      intro="These terms govern your use of Openmi, an assistant that reads a repository you connect and proposes changes to it. By creating an account or using the service you agree to them. If you do not agree, do not use the service."
      sections={SECTIONS}
      contact={{
        title: "20. Contact",
        lead: "Questions about these terms, notices and account closure:",
        subject: "Terms question",
      }}
      other={{ href: "/privacy", label: "Privacy" }}
    />
  );
}
