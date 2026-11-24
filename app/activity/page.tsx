import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AdBanner } from "@/components/AdBanner";
import { Brand } from "@/components/Brand";
import { EndHourButton } from "@/components/EndHourButton";
import { SubmitButton } from "@/components/SubmitButton";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import {
  CREDIT_PER_HOUR,
  INVITE_REWARD_CREDIT,
  MAX_INVITES_PER_ACCOUNT,
  TIMEZONES,
  dailyAllowance,
  formatCredit,
  formatPassDate,
  formatPassRemaining,
  isLowBalance,
  localDay,
} from "@/lib/credits";
import { readCreditProfile, refillDailyCredit } from "@/lib/credits/store";
import { getSession } from "@/lib/session";
import { saveTimezone } from "./actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Credit & activity — Openmi",
};

const KIND_LABEL: Record<string, string> = {
  trial: "Trial credit",
  daily: "Daily free Credit",
  session: "Hour session",
  refund: "Refund",
  invite: "Invite reward",
  topup: "Top-up",
  adjustment: "Adjustment",
};

type LedgerRow = {
  id: string;
  kind: string;
  amount: number | string;
  balance_after: number | string;
  reference: string | null;
  created_at: string;
};

type SessionRow = {
  session_id: string;
  started_at: string;
  expires_at: string;
  model: string | null;
  repo_full_name: string | null;
  refunded_at: string | null;
};

function utc(value: string): string {
  return value.slice(0, 16).replace("T", " ");
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const params = await searchParams;
  const session = await getSession();

  if (session.state === "signed-out") {
    redirect("/login?next=%2Factivity");
  }

  if (session.state === "unconfigured") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
        <div className="panel p-6">
          <p className="text-[12px] font-medium text-low">Unavailable</p>
          <h1 className="mt-1.5 text-[22px] font-semibold tracking-[-0.02em] text-hi">
            Openmi is unavailable right now
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-mid">
            We can&apos;t load your activity at the moment. Try again in a few
            minutes.
          </p>
        </div>
      </main>
    );
  }

  if (session.state === "banned") redirect("/banned");

  const { supabase, user } = session;

  await refillDailyCredit(supabase);

  const profile = await readCreditProfile(supabase, user.id);

  if (!profile) {
    redirect("/chat?error=Profile%20missing%20for%20this%20account");
  }

  const [ledgerResult, sessionResult, inviteCountResult, chatsResult, messagesResult] =
    await Promise.all([
      supabase
        .from("credit_transactions")
        .select("id, kind, amount, balance_after, reference, created_at")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("hour_sessions")
        .select(
          "session_id, started_at, expires_at, model, repo_full_name, refunded_at"
        )
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("invited_by", user.id)
        .eq("invite_rewarded", true),
      supabase.from("chats").select("id, title"),
      supabase
        .from("messages")
        .select("chat_id, usage_tokens")
        .order("created_at", { ascending: false })
        .limit(1_000),
    ]);

  const ledger = (ledgerResult.data ?? []) as LedgerRow[];
  const current = (sessionResult.data ?? null) as SessionRow | null;
  const invited = inviteCountResult.count ?? 0;
  const chats = (chatsResult.data ?? []) as Array<{ id: string; title: string }>;
  const messages = (messagesResult.data ?? []) as Array<{
    chat_id: string;
    usage_tokens: number | null;
  }>;

  const titles = new Map(chats.map((chat) => [chat.id, chat.title]));
  const usage = new Map<string, number>();

  for (const message of messages) {
    const id = String(message.chat_id);
    usage.set(id, (usage.get(id) ?? 0) + Number(message.usage_tokens ?? 0));
  }

  const perChat = [...usage.entries()]
    .map(([chatId, tokens]) => ({
      chatId,
      title: titles.get(chatId) ?? "Deleted chat",
      tokens,
    }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 10);

  const purchases = ledger.filter((row) => row.kind === "topup");
  const active = current
    ? new Date(current.expires_at).getTime() > Date.now()
    : false;

  const allowance = dailyAllowance(profile.paidActive);
  const today = localDay(profile.timezone);
  const lastDaily = ledger.find((row) => row.kind === "daily") ?? null;
  const settledToday = profile.creditDay === today;
  const alreadyAtAllowance = profile.balance >= allowance;

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-4xl items-center justify-between gap-3 px-5 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/chat" aria-label="Back to chats">
              <Brand compact />
            </Link>
            <span aria-hidden="true" className="text-line-strong">
              /
            </span>
            <h1 className="truncate text-[14px] font-semibold tracking-[-0.02em] text-hi">
              Balance &amp; activity
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <ThemeSwitcher variant="icon" />
            <Link href="/chat" className="btn gap-1.5 px-3 py-1.5 text-[12px]">
              <ArrowLeft aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
              <span>Workspace</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="animate-enter mx-auto w-full max-w-4xl px-5 py-8 sm:px-8">
        <AdBanner className="mb-6" />

        {params.error && (
          <p
            role="alert"
            className="mb-5 rounded-lg border border-danger/30 bg-danger/8 px-4 py-2.5 text-[12.5px] text-danger"
          >
            {params.error}
          </p>
        )}

        {params.saved && (
          <p
            role="status"
            className="mb-5 rounded-lg border border-accent/30 bg-accent-soft px-4 py-2.5 text-[12.5px] text-accent-text"
          >
            {params.saved === "timezone" ? "Timezone saved." : params.saved}
          </p>
        )}

        {/* ── Top KPI Strip ──────────────────────────────────────────────── */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="panel p-5">
            <p className="text-[12px] font-medium text-low">Available balance</p>
            <p
              className={`mt-2 font-mono text-[28px] font-semibold leading-none tracking-[-0.03em] tabular-nums ${
                isLowBalance(profile.balance) ? "text-warn" : "text-hi"
              }`}
            >
              {formatCredit(profile.balance)}{" "}
              <span className="font-sans text-[13px] font-medium text-low">
                Credit
              </span>
            </p>
            <p className="mt-2.5 text-[12px] text-mid">
              {CREDIT_PER_HOUR} Credit / hour · unlimited turns
            </p>
          </div>

          <div className="panel p-5">
            <p className="text-[12px] font-medium text-low">Daily allowance</p>
            <p className="mt-2 font-mono text-[28px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-hi">
              {formatCredit(allowance)}{" "}
              <span className="font-sans text-[13px] font-medium text-low">
                / day
              </span>
            </p>
            <p className="mt-2.5 text-[12px] text-mid">
              {profile.paidUntil
                ? profile.paidActive
                  ? `Pass ends ${formatPassDate(profile.paidUntil, profile.timezone) ?? "—"} (${formatPassRemaining(profile.paidUntil)})`
                  : `Pass ended ${formatPassDate(profile.paidUntil, profile.timezone) ?? "—"}`
                : `Refills at midnight (${profile.timezone})`}
            </p>
          </div>

          <div className="panel flex flex-col justify-between p-5">
            <div>
              <p className="text-[12px] font-medium text-low">Hour session</p>
              <p className="mt-2 text-[13.5px] font-medium leading-snug text-hi">
                {current
                  ? active
                    ? `Active until ${utc(current.expires_at)} UTC`
                    : `Ended ${utc(current.expires_at)} UTC${current.refunded_at ? " (refunded)" : ""}`
                  : "No active hour"}
              </p>
            </div>
            {current && active ? (
              <div className="mt-3">
                <EndHourButton />
              </div>
            ) : (
              <p className="mt-2 text-[12px] text-low">
                Turns inside an active hour carry no extra charge.
              </p>
            )}
          </div>

          <div className="panel p-5">
            <p className="text-[12px] font-medium text-low">Tokens used</p>
            <p className="mt-2 font-mono text-[28px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-hi">
              {profile.tokensUsed.toLocaleString()}
            </p>
            <p className="mt-2.5 text-[12px] text-mid">
              All chats, since this account was created
            </p>
          </div>
        </section>

        {/* ── Daily Refresh ──────────────────────────────────────────────── */}
        <section className="panel mt-5 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-hi">
              Daily refresh
            </h2>
            <p className="font-mono text-[11.5px] text-low">
              midnight · {profile.timezone}
            </p>
          </div>

          <p className="mt-2 text-[13px] text-mid">
            {settledToday
              ? `Settled for ${profile.creditDay}.`
              : `Pending for ${today}.`}
          </p>

          <dl className="mt-4 grid gap-4 border-t border-line pt-4 text-[12.5px] sm:grid-cols-3">
            <div>
              <dt className="text-[11.5px] text-low">Allowance</dt>
              <dd className="mt-1 font-mono font-medium tabular-nums text-hi">
                {formatCredit(allowance)} / day
              </dd>
            </div>
            <div>
              <dt className="text-[11.5px] text-low">Last grant</dt>
              <dd className="mt-1 font-mono font-medium text-hi">
                {lastDaily
                  ? `+${formatCredit(Number(lastDaily.amount))} on ${
                      lastDaily.reference ?? utc(lastDaily.created_at)
                    }`
                  : "none yet"}
              </dd>
            </div>
            <div>
              <dt className="text-[11.5px] text-low">Balance now</dt>
              <dd className="mt-1 font-mono font-medium tabular-nums text-hi">
                {formatCredit(profile.balance)}
              </dd>
            </div>
          </dl>

          {alreadyAtAllowance && (
            <p className="mt-3 border-t border-line pt-3 text-[12px] text-low">
              Daily refills top up to {formatCredit(allowance)} Credit (non-stacking).
            </p>
          )}
        </section>

        {/* ── Invite + Timezone ──────────────────────────────────────────── */}
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <section className="panel p-5">
            <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-hi">
              Invite code
            </h2>
            <p className="mt-1.5 text-[12.5px] text-mid">
              +{INVITE_REWARD_CREDIT} Credit each on invitee&apos;s first paid
              pass (max {MAX_INVITES_PER_ACCOUNT}).
            </p>
            <p className="mt-3 rounded-lg border border-line bg-raised px-3.5 py-2.5 font-mono text-[15px] font-semibold tracking-[0.14em] text-hi">
              {profile.inviteCode ?? "—"}
            </p>
            <p className="mt-2 font-mono text-[11.5px] tabular-nums text-low">
              {invited} / {MAX_INVITES_PER_ACCOUNT} rewarded
            </p>

            {purchases.length > 0 && (
              <>
                <p className="mt-4 border-t border-line pt-3 text-[12px] font-medium text-hi">
                  Purchase history
                </p>
                <ul className="mt-2 space-y-1.5 text-[12px] text-mid">
                  {purchases.map((row) => (
                    <li
                      key={row.id}
                      className="flex justify-between gap-3 font-mono tabular-nums"
                    >
                      <span>{utc(row.created_at)}</span>
                      <span className="text-accent-text">
                        +{formatCredit(Number(row.amount))}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="panel p-5">
            <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-hi">
              Daily refill timezone
            </h2>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-mid">
              Daily credits reset at local midnight in this zone.
            </p>

            <form action={saveTimezone} className="mt-4 flex flex-wrap gap-2">
              <select
                name="timezone"
                defaultValue={profile.timezone}
                aria-label="Timezone"
                className="field min-w-[180px] flex-1 py-2 text-[12.5px]"
              >
                {TIMEZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
              <SubmitButton className="btn px-3.5 py-2 text-[12.5px]" optimisticText="Saved">
                Save timezone
              </SubmitButton>
            </form>
          </section>
        </div>

        {/* ── Ledger Table ───────────────────────────────────────────────── */}
        <section className="panel mt-5 overflow-hidden">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-raised px-5 py-3.5">
            <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-hi">
              Credit history
            </h2>
            <p className="text-[11.5px] text-low">
              Append-only ledger of every balance change.
            </p>
          </div>

          {ledger.length === 0 ? (
            <p className="px-5 py-5 text-[12.5px] text-mid">
              No Credit activity yet. Trial credit appears after your first
              message.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-[12.5px]">
                <thead>
                  <tr className="border-b border-line bg-raised/50 text-[11.5px] font-medium text-low">
                    <th className="py-2.5 pl-5 pr-3 font-medium">When (UTC)</th>
                    <th className="font-medium">Kind</th>
                    <th className="text-right font-medium">Amount</th>
                    <th className="text-right font-medium">Balance</th>
                    <th className="pl-4 pr-5 font-medium">Reference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ledger.map((row) => {
                    const amount = Number(row.amount);

                    return (
                      <tr key={row.id} className="hover:bg-raised/40">
                        <td className="py-2.5 pl-5 pr-3 font-mono text-[11.5px] tabular-nums text-low">
                          {utc(row.created_at)}
                        </td>
                        <td className="text-body">
                          {KIND_LABEL[row.kind] ?? row.kind}
                        </td>
                        <td
                          className={`text-right font-mono tabular-nums ${
                            amount < 0
                              ? "text-danger"
                              : "text-[color:var(--diff-add)]"
                          }`}
                        >
                          {amount > 0 ? "+" : ""}
                          {formatCredit(amount)}
                        </td>
                        <td className="text-right font-mono tabular-nums text-mid">
                          {formatCredit(Number(row.balance_after))}
                        </td>
                        <td className="max-w-[180px] truncate pl-4 pr-5 font-mono text-[11.5px] text-low">
                          {row.reference ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Per-Chat Usage ─────────────────────────────────────────────── */}
        <section className="panel mt-5 overflow-hidden">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-raised px-5 py-3.5">
            <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-hi">
              Recent per-chat usage
            </h2>
            <p className="text-[11.5px] text-low">
              Last 1,000 messages · billed per hour, not per token
            </p>
          </div>

          {perChat.length === 0 ? (
            <p className="px-5 py-5 text-[12.5px] text-mid">No messages yet.</p>
          ) : (
            <ul className="divide-y divide-line text-[12.5px]">
              {perChat.map((row) => (
                <li
                  key={row.chatId}
                  className="flex justify-between gap-3 px-5 py-2.5"
                >
                  <span className="min-w-0 truncate text-body">{row.title}</span>
                  <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-mid">
                    ~{row.tokens.toLocaleString()} tokens
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="mt-6 max-w-2xl text-[12px] leading-relaxed text-low">
          An hour the provider never answered is released back to your balance
          automatically as a metering correction. Purchases are final and passes
          do not renew. Operator adjustments appear in the ledger above, and{" "}
          <Link
            href="/refunds"
            className="font-medium text-accent-text underline-offset-2 hover:underline"
          >
            the refund and cancellation policy
          </Link>{" "}
          details the terms.
        </p>
      </main>
    </div>
  );
}
