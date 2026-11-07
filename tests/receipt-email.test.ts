import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  buildReceiptEmail,
  receiptRecipient,
} from "../lib/email/receipt-message";

const NOTICE = {
  submitterEmail: "payer@example.com",
  submitterId: "user-123",
  planName: "Starter",
  amount: 15,
  reference: "SB-9912",
  note: "",
  receiptName: "receipt.pdf",
  receiptType: "application/pdf",
};

test("the notification names the payer, the reference and the amount", () => {
  const { subject, text } = buildReceiptEmail(NOTICE);

  expect(subject).toContain("New receipt: Starter");
  expect(subject).toContain("RM 15.00");
  expect(subject).toContain("payer@example.com");
  expect(text).toContain("payer@example.com (user-123)");
  expect(text).toContain("SB-9912");
  expect(text).toContain("(none)");
});

test("a note with markup is escaped, not rendered", () => {
  const { html } = buildReceiptEmail({ ...NOTICE, note: "<b>hi</b> & bye" });

  expect(html).toContain("&lt;b&gt;hi&lt;/b&gt; &amp; bye");
  expect(html).not.toContain("<b>hi</b>");
});

test("the notify address wins, and a bad one falls back to the first admin", () => {
  expect(receiptRecipient({ RECEIPT_NOTIFY_EMAIL: "ops@openmi.dev" })).toBe(
    "ops@openmi.dev"
  );
  expect(
    receiptRecipient({
      RECEIPT_NOTIFY_EMAIL: "not-an-email",
      ADMIN_EMAILS: "a@b.co, c@d.co",
    })
  ).toBe("a@b.co");
  expect(receiptRecipient({ ADMIN_EMAILS: "  ,  " })).toBeNull();
});

test("a stored request emails the operator with the uploaded file", () => {
  const actions = readFileSync(
    new URL("../app/pay/actions.ts", import.meta.url),
    "utf8"
  );

  const storedAt = actions.indexOf('rpc("submit_payment_request"');
  const sentAt = actions.indexOf("sendReceiptNotification(");

  // The mail goes out only after the row exists: an email about a request that
  // was refused would send an operator hunting for something that is not there.
  expect(storedAt).toBeGreaterThan(-1);
  expect(sentAt).toBeGreaterThan(storedAt);
  expect(actions).toContain("attachment: {");
  expect(actions).toContain("submitterEmail: session.user.email");
});
