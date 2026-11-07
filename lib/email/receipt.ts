import "server-only";

import {
  buildReceiptEmail,
  receiptRecipient,
  type ReceiptAttachment,
  type ReceiptNotification,
} from "./receipt-message";

/**
 * Emails the operator when a receipt is uploaded.
 *
 * Resend is called with `fetch` rather than its SDK: one POST, no dependency,
 * and the key never leaves this module. `server-only` above turns an accidental
 * client import into a build error.
 *
 * A mail failure is never a submission failure. The request is already stored
 * by the time this runs, so every outcome is returned instead of thrown and the
 * caller can ignore it; the receipt stays in the admin queue either way.
 */

const ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 8000;

/** Resend's own test sender. It only delivers to the account owner until a domain is verified. */
const DEFAULT_FROM = "Openmi <onboarding@resend.dev>";

export type ReceiptSendResult =
  | { sent: true }
  | { sent: false; reason: string };

export async function sendReceiptNotification(
  input: ReceiptNotification & { attachment: ReceiptAttachment }
): Promise<ReceiptSendResult> {
  const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
  const to = receiptRecipient(process.env);

  if (apiKey.length === 0) return { sent: false, reason: "RESEND_API_KEY is not set" };
  if (!to) return { sent: false, reason: "no notification address configured" };

  const from = (process.env.RECEIPT_FROM_EMAIL ?? "").trim() || DEFAULT_FROM;
  const message = buildReceiptEmail(input);

  const payload = {
    from,
    to: [to],
    // Answering the notification answers the payer, which is the useful reply.
    ...(input.submitterEmail ? { reply_to: input.submitterEmail } : {}),
    subject: message.subject,
    text: message.text,
    html: message.html,
    attachments: [
      {
        filename: input.attachment.filename,
        content: Buffer.from(input.attachment.bytes).toString("base64"),
        content_type: input.attachment.contentType,
      },
    ],
  };

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      // Status only: the response body can echo the recipient address.
      console.error(`receipt notification: Resend returned ${response.status}`);
      return { sent: false, reason: `Resend returned ${response.status}` };
    }

    return { sent: true };
  } catch (caught) {
    console.error(
      `receipt notification: ${caught instanceof Error ? caught.name : "request failed"}`
    );
    return { sent: false, reason: "the email request failed" };
  }
}
