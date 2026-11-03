import Link from "next/link";
import { redirect } from "next/navigation";

import { AdBanner } from "@/components/AdBanner";
import { Brand } from "@/components/Brand";
import { SubmitButton } from "@/components/SubmitButton";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import {
  DEW_PER_HOUR,
  INVITE_REWARD_DEW,
  LOW_BALANCE_DEW,
  MAX_INVITES_PER_ACCOUNT,
  TIMEZONES,
  TOPUP_PACKS,
  dailyAllowance,
  formatDew,
  isLowBalance,
} from "@/lib/dew";
import { readDewProfile, refillDailyDew } from "@/lib/dew/store";
import { getSession } from "@/lib/session";
import { redeemCode, saveTimezone } from "./actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dew & activity — Openmi",
};

const KIND_LABEL: Record<string, string> = {
  trial: "Trial credit",
  daily: "Daily free Dew",
  session: "Hour session",
  refund: "Refund",
  invite: "Invite reward",
  topup: "Top-up",
  adjustment: "Operator adjustment",
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
        <p className="eyebrow">not configured</p>
        <h1 className="mt-2 text-[24px] font-semibold tracking-[-0.02em] text-hi">
          Activity needs Supabase
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          Dew balances and the ledger live in Postgres behind row-level
          security. Without a project configured there is nothing to show.
        </p>
        <Link href="/setup" className="btn btn-primary mt-6 w-fit px-4 py-2">
          Open setup
        </Link>
      </main>
    );
  }

  const { supabase, user } = session;

  // Settle the local day before reading, so the balance shown is the balance
  // the next turn will use.
  await refillDailyDew(supabase);

  const profile = await readDewProfile(supabase, user.id);

  if (!profile) {
    redirect("/chat?error=Profile%20missing%20for%20this%20account");
  }

  const [ledgerResult, sessionResult, inviteCountResult, chatsResult, messagesResult] =
    await Promise.all([
      supabase
        .from("dew_transactions")
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

  return (
    <main className="animate-enter mx-auto w-full max-w-4xl px-5 py-8 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/chat" aria-label="Back to chats">
            <Brand compact />
          </Link>
          <span aria-hidden="true" className="h-4 w-px bg-line-strong" />
          <div>
            <p className="eyebrow">dew</p>
            <h1 className="text-[17px] font-semibold tracking-[-0.02em] text-hi">
              Balance &amp; activity
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ThemeSwitcher />
          <Link href="/chat" className="btn px-3.5 py-1.5 text-[12px]">
            Back to chats
          </Link>
        </div>
      </header>

      <AdBanner className="mt-6" />

      {params.error && (
        <p
          role="alert"
          className="mt-5 rounded-2xl border border-danger/25 bg-danger/8 px-4 py-2.5 text-[12px] text-danger"
        >
          {params.error}
        </p>
      )}

      {params.saved && (
        <p
          role="status"
          className="mt-5 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-2.5 text-[12px] text-accent-text"
        >
          {params.saved === "timezone" ? "Timezone saved." : params.saved}
        </p>
      )}

      <section className="mt-6 rounded-3xl border border-line bg-card px-5 py-6 sm:px-7">
        <p className="eyebrow">balance</p>
        <p
          className={`mt-1 text-[clamp(2.2rem,6vw,3rem)] font-semibold leading-none tracking-[-0.04em] ${
            isLowBalance(profile.balance) ? "text-warn" : "text-hi"
          }`}
        >
          {formatDew(profile.balance)}{" "}
          <span className="text-[0.42em] font-medium uppercase tracking-[0.08em] text-low">
            dew
          </span>
        </p>
        <p className="mt-3 max-w-xl text-[12.5px] leading-relaxed text-mid">
          An hour of chat costs {DEW_PER_HOUR} Dew, charged before the provider is
          called. The daily allowance is {dailyAllowance(profile.hasPaid)} Dew,
          settled at local midnight in {profile.timezone}.
        </p>

        {isLowBalance(profile.balance) && (
          <p className="mt-3 max-w-xl rounded-2xl border border-warn/25 bg-warn/8 px-4 py-2.5 text-[11.5px] leading-relaxed text-warn">
            Below {LOW_BALANCE_DEW} Dew. A chat turn will be refused once the
            balance cannot cover an hour; redeem a code below or wait for the
            daily refill.
          </p>
        )}

        <p className="mt-3 text-[11.5px] leading-relaxed text-low">
          {current
            ? active
              ? `An hour is running until ${utc(current.expires_at)} UTC; turns inside it are free.`
              : `The last hour ended ${utc(current.expires_at)} UTC${
                  current.refunded_at ? " and was refunded" : ""
                }.`
            : "No hour has started yet."}
        </p>
      </section>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <section className="panel p-5">
          <h2 className="text-[14px] font-semibold tracking-[-0.02em] text-hi">
            Redeem a code
          </h2>
          <p className="mt-1 text-[11.5px] leading-relaxed text-mid">
            Codes are issued by an operator. Each one can be redeemed once.
          </p>

          <form action={redeemCode} className="mt-3 flex gap-2">
            <input
              name="code"
              required
              maxLength={64}
              autoComplete="off"
              spellCheck={false}
              placeholder="TOPUP-…"
              aria-label="Dew code"
              className="field min-w-0 flex-1 bg-canvas py-1.5 font-mono text-[12px]"
            />
            <SubmitButton className="btn px-3 py-1.5 text-[12px]" pendingText="Redeeming…">
              Redeem
            </SubmitButton>
          </form>

          <p className="eyebrow mt-4">top-up packs</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {TOPUP_PACKS.map((dew) => (
              <li
                key={dew}
                className="rounded-full border border-line bg-chip px-3 py-1 font-mono text-[11px] text-mid"
              >
                {dew} Dew
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10.5px] leading-relaxed text-low">
            Or pay on the plans page and upload the receipt; an operator reviews
            it and the Dew lands here.
          </p>

          <Link href="/pay" className="btn mt-3 px-3 py-1.5 text-[11.5px]">
            Plans &amp; receipts
          </Link>
        </section>

        <section className="panel p-5">
          <h2 className="text-[14px] font-semibold tracking-[-0.02em] text-hi">
            Invite
          </h2>
          <p className="mt-1 text-[11.5px] leading-relaxed text-mid">
            Share this code at sign-up. Both sides get {INVITE_REWARD_DEW} Dew,
            once per account, up to {MAX_INVITES_PER_ACCOUNT} rewarded accounts.
          </p>
          <p className="mt-3 rounded-2xl bg-canvas px-4 py-2.5 font-mono text-[15px] tracking-[0.14em] text-hi">
            {profile.inviteCode ?? "—"}
          </p>
          <p className="mt-1.5 text-[10.5px] text-low">
            {invited} / {MAX_INVITES_PER_ACCOUNT} rewarded
          </p>

          {purchases.length > 0 && (
            <>
              <p className="eyebrow mt-4">purchase history</p>
              <ul className="mt-1.5 space-y-1 text-[11px] text-mid">
                {purchases.map((row) => (
                  <li key={row.id} className="flex justify-between gap-3 font-mono">
                    <span>{utc(row.created_at)}</span>
                    <span className="text-accent-text">
                      +{formatDew(Number(row.amount))}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      <section className="panel mt-5 overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pb-3 pt-5">
          <h2 className="text-[14px] font-semibold tracking-[-0.02em] text-hi">Ledger</h2>
          <p className="text-[10.5px] text-low">
            Every balance change is a row; the amounts sum to the balance above.
          </p>
        </div>

        {ledger.length === 0 ? (
          <p className="px-5 pb-5 text-[12px] text-mid">
            No Dew activity yet. The trial credit appears here the moment the
            account exists.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[540px] text-left text-[11.5px]">
              <thead>
                <tr className="eyebrow border-t border-line">
                  <th className="py-2 pl-5 pr-3 font-normal">When (UTC)</th>
                  <th className="font-normal">Kind</th>
                  <th className="text-right font-normal">Amount</th>
                  <th className="text-right font-normal">Balance</th>
                  <th className="pl-3 pr-5 font-normal">Reference</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((row) => {
                  const amount = Number(row.amount);

                  return (
                    <tr key={row.id} className="border-t border-line">
                      <td className="py-2 pl-5 pr-3 font-mono text-[10.5px] text-low">
                        {utc(row.created_at)}
                      </td>
                      <td className="text-body">{KIND_LABEL[row.kind] ?? row.kind}</td>
                      <td
                        className={`text-right font-mono ${
                          amount < 0 ? "text-danger" : "text-accent-text"
                        }`}
                      >
                        {amount > 0 ? "+" : ""}
                        {formatDew(amount)}
                      </td>
                      <td className="text-right font-mono text-mid">
                        {formatDew(Number(row.balance_after))}
                      </td>
                      <td className="max-w-[180px] truncate pl-3 pr-5 font-mono text-[10.5px] text-low">
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

      <section className="panel mt-5 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[14px] font-semibold tracking-[-0.02em] text-hi">
            Recent per-chat usage
          </h2>
          <p className="text-[10.5px] text-low">
            Token estimates from the last 1,000 messages. Dew is charged per
            hour, not per token.
          </p>
        </div>

        {perChat.length === 0 ? (
          <p className="mt-3 text-[12px] text-mid">No messages yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line text-[12px]">
            {perChat.map((row) => (
              <li key={row.chatId} className="flex justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-body">{row.title}</span>
                <span className="shrink-0 font-mono text-[10.5px] text-mid">
                  ~{row.tokens.toLocaleString()} tokens
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel mt-5 p-5">
        <h2 className="text-[14px] font-semibold tracking-[-0.02em] text-hi">
          Daily refill timezone
        </h2>
        <p className="mt-1 text-[11.5px] leading-relaxed text-mid">
          The refill happens at local midnight in this zone, and a day that is
          ahead of it never refills.
        </p>

        <form action={saveTimezone} className="mt-3 flex flex-wrap gap-2">
          <select
            name="timezone"
            defaultValue={profile.timezone}
            aria-label="Timezone"
            className="field w-auto bg-canvas py-1.5 text-[12px]"
          >
            {TIMEZONES.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
          <SubmitButton className="btn px-3 py-1.5 text-[12px]" pendingText="Saving…">
            Save timezone
          </SubmitButton>
        </form>
      </section>

      <p className="mt-8 max-w-2xl text-[10.5px] leading-relaxed text-low">
        Refunds are recorded when a provider fails or a turn is stopped before
        the first token. An hour that produced part of an answer is not
        refunded. Operator corrections are the only other path, and they appear
        in the ledger as adjustments.
      </p>
    </main>
  );
}
