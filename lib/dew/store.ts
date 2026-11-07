import "server-only";

import { formatDew } from "@/lib/dew";
import { modelHourDew, modelName } from "@/lib/models";
import { supabaseAdmin } from "@/lib/supabase/admin";
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
type AdminClient = NonNullable<ReturnType<typeof supabaseAdmin>>;

export type DewSession = {
  sessionId: string;
  started: boolean;
  expiresAt: string;
  balance: number;
  /** Paid wallet credit left after the charge. */
  wallet: number;
  price: number;
  /** How the turn was paid for. Every turn is an hour. */
  mode: "hour";
  /** True when the charge was split between the balance and the wallet. */
  combined: boolean;
};

export type DewGate =
  | { ok: true; session: DewSession }
  | {
      ok: false;
      error: string;
      balance: number | null;
      code: "hour-active" | "no-dew";
      /** The chat holding the running hour, when the database named one. */
      activeChatId: string | null;
    };

export type DewProfile = {
  balance: number;
  /** Paid credit, spent only after the daily balance cannot cover a charge. */
  wallet: number;
  timezone: string;
  hasPaid: boolean;
  inviteCode: string | null;
  invitedBy: string | null;
};

function errorText(error: { message?: string } | null): string {
  return error?.message ?? "";
}

export async function refillDailyDew(supabase: Client): Promise<number | null> {
  // The function's only argument has a default, but PostgREST resolves an RPC
  // by the arguments it is given. Sending it explicitly (null means "the
  // signed-in account") is what makes the call match; omitting it addressed a
  // zero-argument function that does not exist.
  const { data, error } = await supabase.rpc("refill_daily_dew", {
    p_owner: null,
  });

  if (error || data === null || data === undefined) return null;
  return Number(data);
}

/**
 * Asks for the account's trial Dew, once.
 *
 * Returns what was granted: 5 the first time from an address that has not been
 * paid today, 0 otherwise. A refusal is not an error — the account can still
 * chat on its daily allowance — so a failed call returns 0 and the turn goes on.
 * The address arrives as a keyed hash; the server never stores the address.
 */
export async function grantTrialDew(
  admin: AdminClient,
  owner: string,
  ipHash: string
): Promise<number> {
  const { data, error } = await admin.rpc("grant_trial_dew", {
    p_owner: owner,
    p_ip_hash: ipHash,
  });

  if (error || data === null || data === undefined) return 0;
  return Number(data);
}

/**
 * The gate.
 *
 * Every turn is paid for by an hour: the first message in a chat starts one, and
 * a message inside a running hour in the same chat is free. The price is not a
 * parameter, and the browser chooses nothing about it.
 */
export async function startDewSession(
  supabase: Client,
  model: string,
  repo: string | null,
  options: { chatId: string | null }
): Promise<DewGate> {
  const { chatId } = options;
  // The price belongs to the model, so the sentence a refusal shows names the
  // same number the database will charge rather than a global constant.
  const price = modelHourDew(model);

  const { data, error } = await supabase.rpc("start_hour_session", {
    p_model: model,
    p_repo: repo,
    p_chat_id: chatId,
  });

  if (error) {
    const message = errorText(error);

    // An hour is locked to the model it was bought for. Switching models mid-hour
    // is a choice the reader has to make explicitly, so it is named as such
    // rather than reported as "an hour is already running".
    if (/hour on model/i.test(message)) {
      const found = message.match(/hour on model (.+)$/i);
      const startedOn = found ? found[1].trim() : "";

      return {
        ok: false,
        balance: null,
        code: "hour-active",
        activeChatId: null,
        error: startedOn
          ? `This hour of chat was started on ${modelName(startedOn)}. Switch back to that model, or end the session and start a new hour here.`
          : "This hour of chat is locked to the model that started it. End the session and start a new hour here.",
      };
    }

    // An active hour is a state, not a failure: the composer offers the chat
    // that holds it and an explicit "end session" instead of a retry loop.
    if (/hour active/i.test(message)) {
      const found = message.match(/hour active in ([0-9a-f-]{36})/i);
      const activeChatId = found ? found[1] : null;

      return {
        ok: false,
        balance: null,
        code: "hour-active",
        activeChatId,
        error: activeChatId
          ? "An hour of chat is already running in another chat. Open that chat to continue, or end the session and start a new one here."
          : "An hour of chat is already running. Continue in that chat, or end the session and start a new one here.",
      };
    }

    if (message.includes("insufficient balance")) {
      return {
        ok: false,
        balance: null,
        code: "no-dew",
        activeChatId: null,
        error: `This hour costs ${formatDew(price)} Dew, and the balance and wallet cannot cover it. Redeem a code or wait for the daily refill.`,
      };
    }

    return {
      ok: false,
      balance: null,
      code: "no-dew",
      activeChatId: null,
      error: `Dew could not be charged, so nothing was sent to a provider: ${message.replace(/^dew:\s*/, "")}`,
    };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        session_id?: string;
        started?: boolean;
        expires_at?: string;
        balance?: number | string;
        wallet?: number | string;
        price?: number | string;
        combined?: boolean;
      }
    | undefined;

  if (!row) {
    return {
      ok: false,
      balance: null,
      code: "no-dew",
      activeChatId: null,
      error: "Dew did not return a session.",
    };
  }

  return {
    ok: true,
    session: {
      sessionId: row.session_id ? String(row.session_id) : "",
      // An hour may already be running for this chat, in which case the turn is
      // free and nothing was charged.
      started: Boolean(row.started),
      expiresAt: row.expires_at ? String(row.expires_at) : "",
      balance: Number(row.balance ?? 0),
      wallet: Number(row.wallet ?? 0),
      price: Number(row.price ?? price),
      mode: "hour",
      combined: Boolean(row.combined),
    },
  };
}

/** Ends the running hour so a new one can start in this chat. No refund. */
export async function endHourSession(
  supabase: Client,
  chatId: string | null
): Promise<boolean> {
  const { data, error } = await supabase.rpc("end_hour_session", {
    p_chat_id: chatId,
  });

  return !error && Boolean(data);
}

export async function refundDewSession(
  admin: AdminClient,
  owner: string,
  sessionId: string,
  reason: string
): Promise<boolean> {
  const { error } = await admin.rpc("refund_hour_session", {
    p_owner: owner,
    p_session_id: sessionId,
    p_reason: reason,
  });

  return !error;
}

/**
 * Sandbox runs: a reservation up front, a settlement against real minutes.
 *
 * Both go through service-role functions in `017_execution_dew.sql`. The run
 * route has already proven the account owns the changeset, and the function
 * refuses a reservation the balance cannot cover — so a run that cannot be
 * paid for never reaches a provider.
 */
export async function reserveExecutionDew(
  admin: AdminClient,
  owner: string,
  runId: string,
  amount: number
): Promise<{ ok: true; balance: number } | { ok: false; error: string }> {
  const { data, error } = await admin.rpc("execution_reserve_dew", {
    p_owner: owner,
    p_run_id: runId,
    p_amount: amount,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true, balance: Number(data ?? 0) };
}

export async function settleExecutionDew(
  admin: AdminClient,
  owner: string,
  runId: string,
  charged: number
): Promise<{ ok: true; balance: number } | { ok: false; error: string }> {
  const { data, error } = await admin.rpc("execution_settle_dew", {
    p_owner: owner,
    p_run_id: runId,
    p_charged: charged,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true, balance: Number(data ?? 0) };
}

export async function readDewProfile(
  supabase: Client,
  owner: string
): Promise<DewProfile | null> {
  const { data } = await supabase
    .from("profiles")
    .select("dew_balance, wallet_dew, timezone, has_paid, invite_code, invited_by")
    .eq("id", owner)
    .maybeSingle();

  if (!data) return null;

  const row = data as {
    dew_balance: number | string;
    wallet_dew?: number | string;
    timezone: string;
    has_paid: boolean;
    invite_code: string | null;
    invited_by: string | null;
  };

  return {
    balance: Number(row.dew_balance),
    wallet: Number(row.wallet_dew ?? 0),
    timezone: row.timezone ?? "UTC",
    hasPaid: Boolean(row.has_paid),
    inviteCode: row.invite_code,
    invitedBy: row.invited_by,
  };
}

export async function redeemDewCode(
  admin: AdminClient,
  owner: string,
  code: string
): Promise<{ ok: true; amount: number; balance: number } | { ok: false; error: string }> {
  const { data, error } = await admin.rpc("redeem_dew_code", {
    p_owner: owner,
    p_code: code,
  });

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
