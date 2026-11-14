/**
 * Redaction at the boundary where text leaves the sandbox.
 *
 * A run has full outbound internet and executes commands a model wrote, so its
 * output is untrusted. Nothing secret is passed into the sandbox, and this is
 * the second layer: a token-shaped string in a command's output is replaced
 * before it reaches Postgres, an event or a transcript.
 *
 * It is a pattern list, not a proof. The guarantee that matters is upstream:
 * provider keys exist only in the worker's environment and are never placed in
 * the sandbox env or on a command line.
 */

const PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "openai-style key", pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { label: "github token", pattern: /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { label: "aws access key", pattern: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { label: "slack token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { label: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { label: "bearer header", pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/gi },
  { label: "private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  {
    label: "named secret assignment",
    pattern:
      /\b(E2B_API_KEY|SUPABASE_SERVICE_ROLE_KEY|GITHUB_TOKEN|OPENROUTER_API_KEY|DEEPSEEK_API_KEY|STRAITLY_API_KEY|VERCEL_TOKEN|CRON_SECRET|RUN_ARTIFACTS_SECRET_ACCESS_KEY)\s*[=:]\s*["']?[^\s"']{8,}/g,
  },
];

/** Replaces anything that looks like a credential. Idempotent. */
export function redactSecrets(text: string): string {
  let output = text;

  for (const { label, pattern } of PATTERNS) {
    output = output.replace(pattern, `[redacted ${label}]`);
  }

  return output;
}

/**
 * A one-line-ish preview for an event or a transcript row.
 *
 * Whitespace is collapsed so a tool's multi-line output cannot push the
 * transcript around; the caller keeps the full text in the step/tool row.
 */
export function previewText(text: string, maxChars: number): string {
  const flat = redactSecrets(text).replace(/\s+/g, " ").trim();

  if (flat.length <= maxChars) return flat;
  return `${flat.slice(0, Math.max(0, maxChars - 1))}…`;
}

/** Keeps the tail, which is where a failing command says why. */
export function tailBytes(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= maxBytes) return { text, truncated: false };

  const buffer = Buffer.from(text, "utf8");
  const tail = buffer.subarray(buffer.length - maxBytes).toString("utf8");
  const firstBreak = tail.indexOf("\n");
  const cleaned =
    firstBreak >= 0 && firstBreak < 300 ? tail.slice(firstBreak + 1) : tail;

  return {
    text: `… output truncated; showing the last ${maxBytes} bytes\n${cleaned}`,
    truncated: true,
  };
}

/** Caps a JSON payload that is about to become an event row. */
export function capPayload(
  payload: Record<string, unknown>,
  maxBytes: number
): Record<string, unknown> {
  const json = JSON.stringify(payload);
  if (Buffer.byteLength(json, "utf8") <= maxBytes) return payload;

  const capped: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "string") {
      capped[key] = `${value.slice(0, 2_000)}…`;
    } else {
      capped[key] = value;
    }
  }

  capped.truncated = true;
  return capped;
}
