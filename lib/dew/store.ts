import "server-only";

import { DEW_PER_HOUR, formatDew } from "@/lib/dew";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * The Dew gate and its readers.
 *
 * `startDewSession` is called before any provider request. A refusal is a 402
 * with a plain message and no upstream call; the hour is charged exactly once,
 * by `start_hour_session`, whose signature has no price parameter.
 *
 * Refunds are best effort and idempotent in the database: one refund per
 * session, fixed at the original charge.
 */

type Client = NonNullable<Awaited<ReturnType<typeof supabaseServer>>>;

export type DewSession = {
  sessionId: string;
  started: boolean;
  expiresAt: string;
  balance: number;
  price: number;
};

export type DewGate =
  | { ok: true; session: DewSession }
  | { ok: false; error: string; balance: number | null };

export type DewProfile = {
  balance: number;
  timezone: string;
  hasPaid: boolean;
  inviteCode: string | null;
  invitedBy: string | null;
};

function errorText(error: { message?: string } | null): string {
  return error?.message ?? "";
}

export async function refillDailyDew(supabase: Client): Promise<number | null> {
  const { data, error } = await supabase.rpc("refill_daily_dew");

  if (error || data === null || data === undefined) return null;
  return Number(data);
}

export async function startDewSession(
  supabase: Client,
  model: string,
  repo: string | null
): Promise<DewGate> {
  const { data, error } = await supabase.rpc("start_hour_session", {
    p_model: model,
    p_repo: repo,
  });

  if (error) {
    const message = errorText(error);

    if (message.includes("insufficient balance")) {
      return {
        ok: false,
        balance: null,
        error: `This hour costs ${formatDew(DEW_PER_HOUR)} Dew, and the balance is too low. Top up with a code or wait for the daily refill.`,
      };
    }

    return {
      ok: false,
      balance: null,
      error: `Dew could not be charged, so nothing was sent to a provider: ${message.replace(/^dew:\s*/, "")}`,
    };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { session_id: string; started: boolean; expires_at: string; balance: number | string; price: number | string }
    | undefined;

  if (!row) {
    return { ok: false, balance: null, error: "Dew did not return a session." };
  }

  return {
    ok: true,
    session: {
      sessionId: String(row.session_id),
      started: Boolean(row.started),
      expiresAt: String(row.expires_at),
      balance: Number(row.balance),
      price: Number(row.price),
    },
  };
}

export async function refundDewSession(
  supabase: Client,
  sessionId: string,
  reason: string
): Promise<boolean> {
  const { error } = await supabase.rpc("refund_hour_session", {
    p_session_id: sessionId,
    p_reason: reason,
  });

  return !error;
}

export async function readDewProfile(
  supabase: Client,
  owner: string
): Promise<DewProfile | null> {
  const { data } = await supabase
    .from("profiles")
    .select("dew_balance, timezone, has_paid, invite_code, invited_by")
    .eq("id", owner)
    .maybeSingle();

  if (!data) return null;

  const row = data as {
    dew_balance: number | string;
    timezone: string;
    has_paid: boolean;
    invite_code: string | null;
    invited_by: string | null;
  };

  return {
    balance: Number(row.dew_balance),
    timezone: row.timezone ?? "UTC",
    hasPaid: Boolean(row.has_paid),
    inviteCode: row.invite_code,
    invitedBy: row.invited_by,
  };
}

export async function redeemDewCode(
  supabase: Client,
  code: string
): Promise<{ ok: true; amount: number; balance: number } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("redeem_dew_code", { p_code: code });

  if (error) {
    const message = errorText(error);

    if (message.includes("already redeemed")) {
      return { ok: false, error: "That code has already been used." };
    }

    if (message.includes("not found")) {
      return { ok: false, error: "That code was not found." };
    }

    return { ok: false, error: message.replace(/^code:\s*/, "") };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { amount: number | string; balance: number | string }
    | undefined;

  if (!row) return { ok: false, error: "The code did not return a balance." };

  return { ok: true, amount: Number(row.amount), balance: Number(row.balance) };
}
