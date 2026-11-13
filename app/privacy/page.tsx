import { LegalPage, type LegalSection } from "@/components/LegalPage";

export const metadata = {
  title: "Privacy Policy — Openmi",
  description:
    "What Openmi collects, why, who processes it, which cookies are used, how long data is kept, and how to exercise your rights.",
};

const LAST_UPDATED = "November 13, 2026";

const SECTIONS: LegalSection[] = [
  {
    id: "who-we-are",
    title: "1. Who we are and what this policy covers",
    blocks: [
      {
        kind: "p",
        text: "Openmi is an assistant that works on one GitHub repository per conversation. This policy explains what personal data the operator of Openmi (“we”, “us”) processes when you use the service, why we process it, who receives it, and the choices available to you. It applies to every origin at which we operate the service.",
      },
      {
        kind: "p",
        text: "We are the controller of the data described here. Some providers process data on our instructions as processors; they are listed in section 5.",
      },
    ],
  },
  {
    id: "data-we-collect",
    title: "2. Data we collect",
    blocks: [
      {
        kind: "list",
        items: [
          "Account data. Your email address, the password hash stored by Supabase Auth, a profile row holding preferences such as timezone, and any invite code associated with your account.",
          "GitHub connection. The personal access token or OAuth grant you provide, sealed with AES-256-GCM before storage (only the last four characters are ever displayed back to you), your GitHub user id and username, the scopes you granted, and the repositories you select.",
          "Content you submit. Chat messages and the answers to them, the repository and commit a chat is pinned to, the files the assistant reads, and the diffs or changesets it proposes.",
          "Execution records, where execution is enabled. Sandbox commands, exit codes, durations and output excerpts, screenshots the browser tool captures, checkpoints, and preview addresses.",
          "Billing records. Your Dew balance and the append-only ledger of charges, refunds, daily allowances, invite rewards and redeem codes; the plan receipts you upload and an operator’s decision on them.",
          "Technical data. A coarse country derived from request headers, used to show currency estimates; request metadata used to enforce rate limits; and error diagnostics.",
        ],
      },
    ],
  },
  {
    id: "how-we-use-it",
    title: "3. How and why we use it",
    blocks: [
      {
        kind: "list",
        items: [
          "To provide the service: authenticate you, read the repository you connected, send your prompt to the model you selected, return an answer, and propose changes. Legal basis: performance of our contract with you.",
          "To bill you: charge Dew for an hour of chat, apply daily allowances and trial credit, record ledger rows, and review uploaded receipts. Legal basis: performance of our contract, and our legal obligation to keep accounting records.",
          "To keep the service safe and working: rate limits, abuse prevention, and fault diagnosis. Legal basis: our legitimate interest in operating a secure service.",
          "To show advertising: banner ads are loaded only after you consent to them in the cookie banner. Legal basis: your consent, which you may withdraw at any time.",
        ],
      },
      {
        kind: "p",
        text: "We do not sell personal data. We do not run third-party analytics, session recording or tracking pixels outside the advertising frames described in section 4. We do not train models on your content. The model provider you select receives the prompt and the code needed to answer it, and processes them under its own terms.",
      },
    ],
  },
  {
    id: "cookies",
    title: "4. Cookies and local storage",
    blocks: [
      {
        kind: "p",
        text: "The service sets the following on your device. There are no others.",
      },
      {
        kind: "list",
        items: [
          "sb-<project>-auth-token — the Supabase session cookie. HttpOnly and essential: it keeps you signed in and lets a signed-out request be redirected before the page paints. It is cleared when you sign out or clear cookies.",
          "openmi-gh-state — short-lived and essential: protects the GitHub sign-in handshake against cross-site request forgery.",
          "openmi-country — first-party and functional, lasting up to one year: remembers the country used to show local currency estimates. It is written only when the request itself does not already reveal a country.",
          "openmi-theme — local storage: your paper, dark or ink appearance choice.",
          "openmi-cookie-consent — local storage: the choice you made in the cookie banner, so we do not ask on every page.",
        ],
      },
      {
        kind: "p",
        text: "Advertising. Banners are served by Adsterra. No advertising frame is created until you press Accept in the banner, so a visitor who declines makes no request to an advertising host and receives no advertising cookies. If you accept, Adsterra and its partners may set cookies inside those frames, and their own policies govern that use. Pressing Decline, or clearing site data, withdraws consent; clearing cookies also signs you out.",
      },
      {
        kind: "p",
        text: "The service is supported by these banners. Where advertising is enabled, a deployment may pause the product while an ad blocker hides them, which is described on screen when it happens.",
      },
    ],
  },
  {
    id: "sharing",
    title: "5. Sharing and subprocessors",
    blocks: [
      {
        kind: "p",
        text: "We share data only with providers that help us run the service, each bound to process it for that purpose:",
      },
      {
        kind: "list",
        items: [
          "Supabase — database, authentication and private file storage for receipts.",
          "Vercel — application hosting and delivery.",
          "GitHub — repository metadata and file reads at the pinned commit, and the writes you authorise.",
          "OpenRouter and DeepSeek — model inference. OpenRouter forwards each request to the upstream model provider it selects for that model.",
          "E2B — disposable Linux sandboxes, only where execution is enabled.",
          "Resend — transactional email such as receipt notifications, only where configured.",
          "Upstash — shared rate-limit counters, only where configured; otherwise counters are kept in our database.",
          "Adsterra — banner advertising, only after you consent.",
          "Sociabuzz — the hosted payment page for paid plans. We never receive or store card details.",
        ],
      },
      {
        kind: "p",
        text: "We may also disclose data where the law requires it, to protect the service or its users from abuse, or with your consent.",
      },
    ],
  },
  {
    id: "transfers",
    title: "6. International transfers",
    blocks: [
      {
        kind: "p",
        text: "We and our providers may process data outside the country you live in. Where data-protection law requires it, those transfers rely on the safeguards the relevant provider offers, such as standard contractual clauses.",
      },
    ],
  },
  {
    id: "retention",
    title: "7. How long we keep it",
    blocks: [
      {
        kind: "list",
        items: [
          "Account and content data are kept for as long as your account exists.",
          "A chat’s sandbox disk is stopped after about five minutes idle and destroyed after roughly 48 hours without activity; an operator may configure a shorter window.",
          "Rate-limit counters expire when their window closes, from minutes to a day.",
          "Ledger rows and receipts are kept while needed for accounting, refunds and disputes.",
          "Backups and diagnostic logs may persist for a limited period after deletion.",
        ],
      },
      {
        kind: "p",
        text: "To delete your account and the data we control, write to the address in section 12. Some records may be retained where the law requires it, or to resolve an open dispute.",
      },
    ],
  },
  {
    id: "security",
    title: "8. Security",
    blocks: [
      {
        kind: "p",
        text: "GitHub tokens are sealed with AES-256-GCM and authenticated on read, so a modified row fails rather than decrypting into a usable token. Traffic is served over HTTPS. Database tables use row-level security keyed to the authenticated account, so one account cannot query another’s rows. Sandboxes are given no platform credentials and hold no repository write access.",
      },
      {
        kind: "p",
        text: "No system is perfectly secure. Treat model output and generated code as untrusted until you have reviewed it, and do not paste credentials into a chat or a sandbox.",
      },
    ],
  },
  {
    id: "rights",
    title: "9. Your rights",
    blocks: [
      {
        kind: "p",
        text: "Depending on where you live, you may have the right to access, correct, delete, restrict or object to our processing of your data, to receive a portable copy of it, and to withdraw consent for advertising at any time. Write to the address in section 12; we may need to confirm your identity before we act. Withdrawing consent does not affect the lawfulness of processing carried out before the withdrawal.",
      },
      {
        kind: "p",
        text: "You may also complain to the data-protection authority in your country. We would appreciate the chance to resolve the issue first.",
      },
    ],
  },
  {
    id: "children",
    title: "10. Children",
    blocks: [
      {
        kind: "p",
        text: "The service is not intended for anyone under 16, and we do not knowingly collect their data. If you believe a child has provided data, contact us and we will delete it.",
      },
    ],
  },
  {
    id: "changes",
    title: "11. Changes to this policy",
    blocks: [
      {
        kind: "p",
        text: "We may update this policy as the service changes. The revised version is posted here with a new date, and material changes are flagged in the product. Continuing to use the service after a change takes effect means the revised policy applies to you.",
      },
    ],
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="legal"
      title="Privacy Policy"
      updated={LAST_UPDATED}
      intro="This policy explains what Openmi collects, how it is used, who processes it, and the choices you have. It applies to the service at every deployment origin we operate."
      sections={SECTIONS}
      contact={{
        title: "12. Contact and requests",
        lead: "Privacy questions, access requests and deletion requests:",
        subject: "Privacy request",
      }}
      other={{ href: "/terms", label: "Terms" }}
    />
  );
}
