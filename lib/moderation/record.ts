import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * The one way the app writes a risk signal.
 *
 * A signal is a fact worth an operator's attention, not a log line: a sandbox
 * command that named a metadata address, a rate limit hammered, a second run
 * started while one was live. It carries who, what and where, and the panel
 * shows it in the order it happened.
 *
 * Rules this helper keeps, so call sites do not have to:
 *
 *   - never throws, never blocks the request — recording is observation, and a
 *     moderation write that fails must not fail a turn;
 *   - caps what it stores: a 300-character summary and an 8 KB detail object, so
 *     a hostile payload cannot become a row that breaks the panel;
 *   - snapshots the email and handle at write time, so the account can be
 *     renamed or deleted and the signal still reads as a sentence;
 *   - never stores a secret. Call sites pass a command or a route, never output.
 */

export type RiskSeverity = "low" | "medium" | "high" | "critical";

const MAX_SUMMARY = 300;
const MAX_DETAIL_CHARS = 8_000;
const MAX_KIND = 60;
const MAX_ROUTE = 200;

export type RiskInput = {
  userId: string | null;
  kind: string;
  severity: RiskSeverity;
  summary: string;
  detail?: Record<string, unknown>;
  route?: string | null;
};

function cappedDetail(
  detail: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!detail) return {};

  try {
    const text = JSON.stringify(detail);
    if (text.length <= MAX_DETAIL_CHARS) return detail as Record<string, unknown>;
  } catch {
    // A cyclic or otherwise unserialisable payload is not worth a row's failure.
    return { note: "detail could not be serialised" };
  }

  return { note: "detail was too large to keep", truncated: true };
}

export async function recordRiskSignal(input: RiskInput): Promise<boolean> {
  try {
    const admin = supabaseAdmin();
    if (!admin) return false;

    let email: string | null = null;
    let handle: string | null = null;

    if (input.userId) {
      const { data } = await admin
        .from("profiles")
        .select("email, handle")
        .eq("id", input.userId)
        .maybeSingle();

      const row = data as { email?: string | null; handle?: string | null } | null;
      email = row?.email ?? null;
      handle = row?.handle ?? null;
    }

    const { error } = await admin.from("risk_events").insert({
      user_id: input.userId,
      email,
      handle,
      kind: input.kind.slice(0, MAX_KIND),
      severity: input.severity,
      summary: input.summary.slice(0, MAX_SUMMARY),
      detail: cappedDetail(input.detail),
      route: input.route ? input.route.slice(0, MAX_ROUTE) : null,
    });

    return !error;
  } catch {
    return false;
  }
}

export { firstSignalIn, resetSignalMemory } from "./dedupe";
