/**
 * Calling a renamed database function on a database that has not been renamed.
 *
 * `053_dew_to_credit.sql` renames `refill_daily_dew` (and friends) to their
 * Credit names. The migration is applied by `supabase db push`, which is a
 * deployment step; until it runs, the old function is the only one there is and
 * every call to the new name fails with "Could not find the function … in the
 * schema cache". The app used to swallow that: the daily allowance silently
 * stopped refilling and nothing said so.
 *
 * `callRpc` tries the current name first and the pre-rename name second, but
 * only when the failure is actually "no such function". A permission error, a
 * closed refund window or a missing row are real answers and are returned as
 * they are, so the fallback cannot paper over a genuine refusal.
 */

export type RpcOutcome<T> = {
  data: T | null;
  error: { message?: string; code?: string } | null;
};

const MISSING_FUNCTION_CODE = "PGRST202";

export function isMissingFunction(
  error: { message?: string; code?: string } | null | undefined
): boolean {
  if (!error) return false;
  if (error.code === MISSING_FUNCTION_CODE) return true;

  const message = (error.message ?? "").toLowerCase();

  return (
    message.includes("could not find the function") ||
    message.includes("schema cache") ||
    (message.includes("function") && message.includes("does not exist"))
  );
}

export async function callRpc<T>(
  call: (name: string) => Promise<RpcOutcome<T>>,
  names: string[]
): Promise<RpcOutcome<T>> {
  let last: RpcOutcome<T> = { data: null, error: null };

  for (const name of names) {
    last = await call(name);

    if (!isMissingFunction(last.error)) return last;
  }

  return last;
}
