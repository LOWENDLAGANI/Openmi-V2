/**
 * The receipt notification, as data.
 *
 * Pure on purpose — no `fetch`, no `server-only`, no `process.env` read at
 * import time — so the tests can pin the subject, the body and the recipient
 * rule without a mail provider. `receipt.ts` is the only module that talks to
 * Resend, and it does nothing but hand this payload to the API.
 *
 * The audience is the operator, not the payer: the submitter's address goes in
 * the body and in Reply-To, so answering the notification answers the person
 * who uploaded the receipt instead of the sending domain.
 */

export type ReceiptNotification = {
  /** The signed-in account that uploaded the file; null if the provider hid it. */
  submitterEmail: string | null;
  submitterId: string;
  planName: string;
  /** Ringgit, as charged by the hosted page. */
  amount: number;
  reference: string;
  note: string;
  receiptName: string;
  receiptType: string;
};

export type ReceiptAttachment = {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
};

export type ReceiptEmail = {
  subject: string;
  text: string;
  html: string;
};

/** Deliberately loose: one @, something on both sides, a dot in the domain. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Where a submitted receipt is announced: `RECEIPT_NOTIFY_EMAIL` when it is a
 * plausible address, otherwise the first valid entry in `ADMIN_EMAILS`.
 *
 * Null means nobody is configured. The sender then sends nothing rather than
 * guessing an address — a receipt is private, and a wrong inbox is a leak.
 */
export function receiptRecipient(
  env: Record<string, string | undefined> = process.env
): string | null {
  const direct = (env.RECEIPT_NOTIFY_EMAIL ?? "").trim();
  if (EMAIL.test(direct)) return direct;

  const admins = (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => EMAIL.test(entry));

  return admins[0] ?? null;
}

function money(amount: number): string {
  return `RM ${amount.toFixed(2)}`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character
  );
}

export function buildReceiptEmail(notice: ReceiptNotification): ReceiptEmail {
  const who = notice.submitterEmail ?? "email not available";
  const note = notice.note.length > 0 ? notice.note : "(none)";

  const rows: [string, string][] = [
    ["Account", `${who} (${notice.submitterId})`],
    ["Plan", notice.planName],
    ["Amount", money(notice.amount)],
    ["Reference", notice.reference],
    ["Note", note],
    ["File", `${notice.receiptName} (${notice.receiptType})`],
  ];

  const text = [
    "A receipt was uploaded on Openmi and is waiting for review.",
    "",
    ...rows.map(([label, value]) => `${label.padEnd(10)} ${value}`),
    "",
    "The file is attached. Approve or reject it in the admin queue.",
  ].join("\n");

  const html = [
    '<div style="font-family:ui-sans-serif,system-ui,sans-serif;font-size:14px;line-height:1.6">',
    "<p>A receipt was uploaded on Openmi and is waiting for review.</p>",
    '<table cellpadding="0" cellspacing="0" style="border-collapse:collapse">',
    ...rows.map(
      ([label, value]) =>
        `<tr><td style="padding:2px 12px 2px 0;color:#666">${escapeHtml(
          label
        )}</td><td style="padding:2px 0">${escapeHtml(value)}</td></tr>`
    ),
    "</table>",
    "<p>The file is attached. Approve or reject it in the admin queue.</p>",
    "</div>",
  ].join("");

  return {
    subject: `New receipt: ${notice.planName} · ${money(notice.amount)} · ${who}`,
    text,
    html,
  };
}
