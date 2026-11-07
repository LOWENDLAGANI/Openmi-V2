import { expect, test } from "bun:test";

import { RECEIPT_TYPES, receiptBytesMatchType } from "../lib/receipts";

const bytes = (...values: number[]) => Uint8Array.from(values);

test("each allowed receipt type has an extension", () => {
  expect(RECEIPT_TYPES).toEqual({
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "application/pdf": "pdf",
  });
});

test("a real signature passes for its own type", () => {
  expect(
    receiptBytesMatchType(
      bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00),
      "image/png"
    )
  ).toBe(true);
  expect(receiptBytesMatchType(bytes(0xff, 0xd8, 0xff, 0xe0), "image/jpeg")).toBe(
    true
  );
  expect(
    receiptBytesMatchType(
      Uint8Array.from([...Buffer.from("RIFF0000WEBP", "ascii")]),
      "image/webp"
    )
  ).toBe(true);
  expect(
    receiptBytesMatchType(Uint8Array.from(Buffer.from("%PDF-1.7\n", "ascii")), "application/pdf")
  ).toBe(true);
});

test("disguised or truncated files are refused", () => {
  expect(receiptBytesMatchType(bytes(0x3c, 0x68, 0x74, 0x6d, 0x6c), "image/png")).toBe(
    false
  );
  expect(receiptBytesMatchType(bytes(0x89, 0x50), "image/png")).toBe(false);
  expect(
    receiptBytesMatchType(Uint8Array.from(Buffer.from("RIFF0000NOPE", "ascii")), "image/webp")
  ).toBe(false);
  expect(receiptBytesMatchType(bytes(), "application/pdf")).toBe(false);
  expect(receiptBytesMatchType(bytes(0x25, 0x50, 0x44, 0x46), "text/html")).toBe(
    false
  );
});
