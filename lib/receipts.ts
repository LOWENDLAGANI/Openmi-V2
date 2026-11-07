/**
 * Receipt uploads: a short allowlist and a content check.
 *
 * The browser supplies both the MIME type and the filename, so neither is
 * evidence of what the bytes are. A file that claims to be PNG but starts with
 * HTML is rejected before it reaches the private bucket or the operator's
 * mail. The extension still comes from the allowlist, never from the name.
 */

export const RECEIPT_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

function bytesAt(source: Uint8Array, offset: number, expected: number[]): boolean {
  if (source.length < offset + expected.length) return false;
  return expected.every((byte, index) => source[offset + index] === byte);
}

function asciiAt(source: Uint8Array, offset: number, expected: string): boolean {
  if (source.length < offset + expected.length) return false;

  for (let index = 0; index < expected.length; index += 1) {
    if (source[offset + index] !== expected.charCodeAt(index)) return false;
  }

  return true;
}

/** Whether the bytes begin with the signature the declared type requires. */
export function receiptBytesMatchType(bytes: Uint8Array, mime: string): boolean {
  switch (mime) {
    case "image/png":
      return bytesAt(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return bytesAt(bytes, 0, [0xff, 0xd8, 0xff]);
    case "image/webp":
      return asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP");
    case "application/pdf":
      return asciiAt(bytes, 0, "%PDF-");
    default:
      return false;
  }
}
