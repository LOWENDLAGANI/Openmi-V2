import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Brand } from "@/components/Brand";
import { SetupReport } from "@/components/SetupReport";
import { StatusPill } from "@/components/StatusPill";
import { SubmitButton } from "@/components/SubmitButton";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { readAdminAccess } from "@/lib/admin/access";
import { planById } from "@/lib/billing/plans";
import { formatDew } from "@/lib/dew";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createGiveawayCodes, grantDew, reviewReceipt, setAdmin } from "./actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Admin — Openmi",
  robots: { index: false, follow: false },
};

type RequestRow = {
  id: string;
  owner: string;
  plan: string;
  amount: number | string;
  reference: string;
  note: string | null;
  receipt_path: string;
  receipt_name: string | null;
  status: string;
  dew_granted: number | null;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
};

type ProfileRow = {
  id: string;
  email: string | null;
  dew_balance: number | string;
  paid_until: string | null;
};

type AccountRow = ProfileRow & {
  handle: string | null;
  created_at: string;
};

/** How many accounts the panel renders before "See more". */
const ACCOUNT_PAGE = 20;

/** A ceiling, so one click-crazy operator cannot ask for the whole table. */
const ACCOUNT_PAGE_MAX = 200;

/**
 * An email search, reduced to something PostgREST cannot read as syntax. `%`
 * and `_` are wildcards, and commas and parentheses separate filters.
 */
function cleanSearch(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .slice(0, 80)
    .replace(/[%,()*_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A paging link that keeps the search and returns to the member list. */
function accountsHref(query: string, shown: number): string {
  const search = new URLSearchParams();
  if (query.length > 0) search.set("q", query);
  search.set("users", String(shown));
  return `/admin?${search.toString()}#members`;
}

function utc(value: string | null): string {
  if (!value) return "—";
  return value.slice(0, 16).replace("T", " ");
}

/** Entitlement is the window, not the historical "has ever paid" flag. */
function paidActive(until: string | null | undefined): boolean {
  return typeof until === "string" && Date.parse(until) > Date.now();
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="eyebrow block px-1 pb-1.5">{label}</span>
      {children}
    </label>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    done?: string;
    q?: string;
    users?: string;
  }>;
}) {
  const params = await searchParams;
  const access = await readAdminAccess();

  if (access.state === "unconfigured") redirect("/setup");
  if (access.state === "signed-out") redirect("/login?next=%2Fadmin");

  // A signed-in visitor without the role is not told that this page exists.
  if (access.state === "forbidden") notFound();

  const admin = supabaseAdmin();

  if (!admin) {
    return (
      <main className="animate-enter mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
        <p className="eyebrow">admin</p>
        <h1 className="mt-2 text-[24px] font-semibold tracking-[-0.02em] text-hi">
          Service role required
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          Reading every receipt and every balance needs SUPABASE_SERVICE_ROLE_KEY
          on the server. The role check already passed; this key is the missing
          piece.
        </p>
      </main>
    );
  }

  // Pending receipts are their own query. Filtering them out of the newest 60
  // requests left older pending rows invisible — and unreviewable — on a busy
  // deployment. Decisions are a separate, small, newest-first list.
  const [
    pendingResult,
    decidedResult,
    adminsResult,
    adminCountResult,
    membersResult,
    dewHeldResult,
    selfAdminResult,
    codesResult,
  ] = await Promise.all([
    admin
      .from("payment_requests")
      .select(
        "id, owner, plan, amount, reference, note, receipt_path, receipt_name, status, dew_granted, decision_note, created_at, decided_at"
      )
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(50),
    admin
      .from("payment_requests")
      .select(
        "id, owner, plan, amount, reference, note, receipt_path, receipt_name, status, dew_granted, decision_note, created_at, decided_at"
      )
      .neq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(10),
    admin
      .from("admin_users")
      .select("user_id, granted_at")
      .order("granted_at", { ascending: false })
      .limit(50),
    admin.from("admin_users").select("user_id", { count: "exact", head: true }),
    admin.from("profiles").select("id", { count: "exact", head: true }),
    // One aggregate for the whole table: summing a capped page undercounted.
    admin.rpc("admin_dew_held"),
    // The warning below asks about this operator, not about the first 50 rows.
    admin
      .from("admin_users")
      .select("user_id")
      .eq("user_id", access.userId)
      .maybeSingle(),
    admin
      .from("dew_codes")
      .select("code, dew_amount, note, created_at, redeemed_at")
      .order("created_at", { ascending: false })
      .limit(12),
  ]);

  const giveawayCodes = (codesResult.data ?? []) as Array<{
    code: string;
    dew_amount: number | string;
    note: string | null;
    redeemed_at: string | null;
  }>;

  const pending = (pendingResult.data ?? []) as RequestRow[];
  const decided = (decidedResult.data ?? []) as RequestRow[];
  const adminRows = (adminsResult.data ?? []) as Array<{
    user_id: string;
    granted_at: string;
  }>;

  const adminCount = adminCountResult.count ?? adminRows.length;
  const dewHeld = dewHeldResult.error ? null : Number(dewHeldResult.data ?? 0);
  const selfIsStoredAdmin = Boolean(selfAdminResult.data);
  const paymentsError = pendingResult.error ?? decidedResult.error;

  const ownerIds = [
    ...new Set([
      ...pending.map((row) => row.owner),
      ...decided.map((row) => row.owner),
      ...adminRows.map((row) => row.user_id),
    ]),
  ];

  const profilesResult = ownerIds.length
    ? await admin
        .from("profiles")
        .select("id, email, dew_balance, paid_until")
        .in("id", ownerIds)
    : { data: [] as ProfileRow[] };

  const profiles = new Map(
    ((profilesResult.data ?? []) as ProfileRow[]).map((row) => [row.id, row])
  );

  // Accounts are their own query so the panel does not get slower as the member
  // list grows. Search and paging run in Postgres and only the slice on screen
  // is fetched — the whole table is never sent to the page.
  const accountSearch = cleanSearch(params.q);
  const requestedAccounts = Number.parseInt(params.users ?? "", 10);
  const accountShown = Number.isFinite(requestedAccounts)
    ? Math.min(Math.max(requestedAccounts, ACCOUNT_PAGE), ACCOUNT_PAGE_MAX)
    : ACCOUNT_PAGE;

  let accountQuery = admin
    .from("profiles")
    .select("id, email, handle, dew_balance, paid_until, created_at", {
      count: "exact",
    });

  if (accountSearch.length > 0) {
    accountQuery = accountQuery.ilike("email", `%${accountSearch}%`);
  }

  const accountsResult = await accountQuery
    .order("created_at", { ascending: false })
    .range(0, accountShown - 1);

  const accountRows = (accountsResult.data ?? []) as AccountRow[];
  const accountTotal = accountsResult.count ?? accountRows.length;

  // Short-lived links: the bucket is private and the operator is the only
  // viewer here.
  const signed = new Map<string, string>();
  await Promise.all(
    pending.slice(0, 20).map(async (row) => {
      const { data } = await admin.storage
        .from("receipts")
        .createSignedUrl(row.receipt_path, 600);
      if (data?.signedUrl) signed.set(row.id, data.signedUrl);
    })
  );

  return (
    <main className="animate-enter mx-auto w-full max-w-5xl px-5 py-8 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/chat" aria-label="Back to chats">
            <Brand compact />
          </Link>
          <span aria-hidden="true" className="h-4 w-px bg-line-strong" />
          <div>
            <p className="eyebrow">restricted</p>
            <h1 className="text-[17px] font-semibold tracking-[-0.02em] text-hi">
              Operations
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ThemeSwitcher className="hidden sm:inline-flex" />
          <StatusPill tone={access.via === "allowlist" ? "pending" : "ok"}>
            {access.via === "allowlist" ? "allowlist" : "admin role"}
          </StatusPill>
          <Link href="/chat" className="btn px-3.5 py-1.5 text-[12px]">
            Back to chats
          </Link>
        </div>
      </header>

      <p className="mt-3 max-w-2xl font-mono text-[10.5px] text-low">
        {access.email ?? access.userId}
      </p>

      {params.error && (
        <p
          role="alert"
          className="mt-5 rounded-2xl border border-danger/25 bg-danger/8 px-4 py-2.5 text-[12px] text-danger"
        >
          {params.error}
        </p>
      )}

      {params.done && (
        <p
          role="status"
          className="mt-5 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-2.5 text-[12px] text-accent-text"
        >
          {params.done === "approved"
            ? "Receipt approved and Dew granted."
            : params.done === "rejected"
              ? "Receipt rejected. The note is visible to the member."
              : params.done === "topup"
                ? "Dew added to that account."
                : params.done === "giveaway"
                  ? "Giveaway codes created. They are listed below."
                  : params.done === "granted"
                  ? "Admin access granted."
                  : "Admin access revoked."}
        </p>
      )}

      {access.via === "allowlist" && !selfIsStoredAdmin && (
        <p className="mt-5 rounded-2xl border border-warn/25 bg-warn/8 px-4 py-2.5 text-[11.5px] leading-relaxed text-warn">
          This session is an admin through ADMIN_EMAILS. Add yourself under
          &ldquo;Admin role&rdquo; below so access survives removing that
          variable.
        </p>
      )}

      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "members", value: String(membersResult.count ?? 0) },
          { label: "receipts waiting", value: String(pending.length) },
          {
            label: "dew + wallet",
            value: dewHeld === null ? "—" : formatDew(dewHeld),
          },
          { label: "admins", value: String(adminCount) },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border border-line bg-card px-4 py-3"
          >
            <p className="eyebrow">{stat.label}</p>
            <p className="mt-1 font-mono text-[20px] leading-none text-hi">
              {stat.value}
            </p>
          </div>
        ))}
      </section>

      <section
        id="members"
        aria-labelledby="members-heading"
        className="panel mt-5 p-5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id="members-heading"
            className="text-[15px] font-semibold tracking-[-0.02em] text-hi"
          >
            Registered accounts
          </h2>
          <p className="text-[10.5px] text-low">
            {accountRows.length} of {accountTotal} · newest first
          </p>
        </div>

        <form action="/admin" method="get" className="mt-3 flex flex-wrap gap-2">
          <input
            type="search"
            name="q"
            defaultValue={accountSearch}
            maxLength={80}
            autoComplete="off"
            spellCheck={false}
            placeholder="Search by email"
            aria-label="Search accounts by email"
            className="field min-w-0 flex-1 py-1.5 text-[12px]"
          />
          <button type="submit" className="btn px-3.5 py-1.5 text-[12px]">
            Search
          </button>
          {accountSearch.length > 0 && (
            <Link
              href="/admin#members"
              className="btn btn-quiet px-3 py-1.5 text-[12px]"
            >
              Clear
            </Link>
          )}
        </form>

        {accountRows.length === 0 ? (
          <p className="mt-3 text-[12px] leading-relaxed text-mid">
            {accountSearch.length > 0
              ? `No account matches “${accountSearch}”.`
              : "No accounts yet."}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {accountRows.map((member) => (
              <li
                key={member.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5"
              >
                <div className="min-w-0">
                  <p
                    className="truncate text-[12px] text-body"
                    title={member.email ?? member.handle ?? member.id}
                  >
                    {member.email ?? member.handle ?? member.id}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-low">
                    joined {utc(member.created_at)}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-[10.5px] text-low">
                    {formatDew(Number(member.dew_balance))} dew
                  </span>
                  <StatusPill tone={paidActive(member.paid_until) ? "ok" : "optional"}>
                    {paidActive(member.paid_until) ? "paid" : "free"}
                  </StatusPill>
                </div>
              </li>
            ))}
          </ul>
        )}

        {accountRows.length < accountTotal && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            <p className="max-w-md text-[10.5px] leading-relaxed text-low">
              Showing {accountRows.length} of {accountTotal}. The rest load on
              request, so a large account list never slows this page.
            </p>

            {accountShown < ACCOUNT_PAGE_MAX ? (
              <Link
                href={accountsHref(accountSearch, accountShown + ACCOUNT_PAGE)}
                className="btn px-3.5 py-1.5 text-[11.5px]"
              >
                See more
              </Link>
            ) : (
              <p className="text-[10.5px] text-low">
                Refine the search to see more.
              </p>
            )}
          </div>
        )}
      </section>

      {paymentsError && (
        <p
          role="alert"
          className="mt-5 rounded-2xl border border-danger/25 bg-danger/8 px-4 py-2.5 text-[12px] leading-relaxed text-danger"
        >
          Payment tables are not readable: {paymentsError.message}. Check that
          the migrations in <span className="font-mono">supabase/migrations</span>{" "}
          are applied with <span className="font-mono">supabase db push</span>.
        </p>
      )}

      <section aria-labelledby="queue-heading" className="panel mt-5 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id="queue-heading"
            className="text-[15px] font-semibold tracking-[-0.02em] text-hi"
          >
            Receipts waiting
          </h2>
          <p className="text-[10.5px] text-low">
            {pending.length === 0 ? "nothing to review" : `${pending.length} pending`}
          </p>
        </div>

        {pending.length === 0 ? (
          <p className="mt-3 text-[12px] leading-relaxed text-mid">
            Nothing waiting. Uploads from the plans page arrive here with their
            proof attached.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {pending.map((row) => {
              const plan = planById(row.plan);
              const member = profiles.get(row.owner);
              const receipt = signed.get(row.id);

              return (
                <li
                  key={row.id}
                  className="rounded-2xl border border-line bg-raised px-4 py-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-[12.5px] font-semibold text-hi">
                      {member?.email ?? row.owner}
                    </p>
                    <StatusPill tone="pending">pending</StatusPill>
                  </div>

                  <p className="mt-1 break-words font-mono text-[10.5px] text-low">
                    {plan?.name ?? row.plan} · RM{" "}
                    {Number(row.amount).toFixed(2)} · ref {row.reference} ·{" "}
                    {utc(row.created_at)}
                  </p>

                  {row.note && (
                    <p className="mt-1.5 text-[11.5px] leading-relaxed text-mid">
                      {row.note}
                    </p>
                  )}

                  <div className="mt-1.5 flex flex-wrap items-center gap-3">
                    {receipt ? (
                      <a
                        href={receipt}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="eyebrow hover:text-hi"
                      >
                        open receipt ↗
                      </a>
                    ) : (
                      <span className="text-[10.5px] text-low">
                        {row.receipt_name ?? "receipt unavailable"}
                      </span>
                    )}
                    <span className="font-mono text-[10px] text-low">
                      balance {formatDew(Number(member?.dew_balance ?? 0))}
                    </span>
                    <span className="font-mono text-[10px] text-low">
                      {paidActive(member?.paid_until) ? "paid" : "free"}
                    </span>
                  </div>

                  <form
                    action={reviewReceipt}
                    className="mt-3 grid gap-2 sm:grid-cols-[110px_1fr_auto]"
                  >
                    <input type="hidden" name="requestId" value={row.id} />
                    <input
                      name="dew"
                      type="number"
                      min="0"
                      step="1"
                      defaultValue={plan?.dew ?? 0}
                      aria-label="Dew to grant"
                      className="field py-1.5 font-mono text-[12px]"
                    />
                    <input
                      name="note"
                      maxLength={200}
                      placeholder="Note shown to the member (optional)"
                      className="field py-1.5 text-[12px]"
                    />
                    <div className="flex gap-1.5">
                      <SubmitButton
                        name="decision"
                        value="approved"
                        className="btn btn-primary flex-1 px-3 py-1.5 text-[11.5px] sm:flex-none"
                        pendingText="Approving…"
                      >
                        Approve
                      </SubmitButton>
                      <SubmitButton
                        name="decision"
                        value="rejected"
                        className="btn flex-1 px-3 py-1.5 text-[11.5px] sm:flex-none"
                        pendingText="Rejecting…"
                      >
                        Reject
                      </SubmitButton>
                    </div>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <section aria-labelledby="topup-heading" className="panel p-5">
          <h2
            id="topup-heading"
            className="text-[15px] font-semibold tracking-[-0.02em] text-hi"
          >
            Top up a balance
          </h2>
          <p className="mt-1 text-[11.5px] leading-relaxed text-mid">
            Adds Dew by account email and writes the same ledger row a purchase
            would. A negative amount is an adjustment and cannot take the balance
            below zero.
          </p>

          <form action={grantDew} className="mt-3 space-y-2">
            <Field label="Member email">
              <input
                name="email"
                type="email"
                required
                autoComplete="off"
                className="field py-1.5 text-[12px]"
              />
            </Field>
            <Field label="Dew amount">
              <input
                name="amount"
                type="number"
                step="1"
                required
                className="field py-1.5 font-mono text-[12px]"
              />
            </Field>
            <Field label="Reason">
              <input
                name="reason"
                maxLength={120}
                placeholder="manual top-up, support, correction"
                className="field py-1.5 text-[12px]"
              />
            </Field>
            <SubmitButton
              className="btn btn-primary w-full py-2 text-[12px]"
              pendingText="Adding Dew…"
            >
              Add Dew
            </SubmitButton>
          </form>
        </section>

        <section aria-labelledby="giveaway-heading" className="panel p-5">
          <h2
            id="giveaway-heading"
            className="text-[15px] font-semibold tracking-[-0.02em] text-hi"
          >
            Giveaway codes
          </h2>
          <p className="mt-1 text-[11.5px] leading-relaxed text-mid">
            Mint codes that add Dew once each, for a launch or a support gesture.
            A giveaway does not switch an account to the paid allowance.
          </p>

          <form action={createGiveawayCodes} className="mt-3 space-y-2">
            <Field label="Dew each">
              <input
                name="amount"
                type="number"
                min="1"
                step="1"
                required
                className="field py-1.5 font-mono text-[12px]"
              />
            </Field>
            <Field label="How many">
              <input
                name="count"
                type="number"
                min="1"
                max="50"
                defaultValue="5"
                required
                className="field py-1.5 font-mono text-[12px]"
              />
            </Field>
            <Field label="Note">
              <input
                name="note"
                maxLength={120}
                placeholder="launch giveaway"
                className="field py-1.5 text-[12px]"
              />
            </Field>
            <SubmitButton
              className="btn btn-primary w-full py-2 text-[12px]"
              pendingText="Minting codes…"
            >
              Create codes
            </SubmitButton>
          </form>

          {giveawayCodes.length === 0 ? (
            <p className="mt-3 text-[11.5px] text-low">No codes issued yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {giveawayCodes.map((row) => (
                <li
                  key={row.code}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <span className="break-all font-mono text-[11px] text-hi">
                    {row.code}
                  </span>
                  <span className="font-mono text-[10px] text-low">
                    {formatDew(Number(row.dew_amount))} Dew ·{" "}
                    {row.redeemed_at ? "redeemed" : "unused"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="admins-heading" className="panel p-5">
          <h2
            id="admins-heading"
            className="text-[15px] font-semibold tracking-[-0.02em] text-hi"
          >
            Admin role
          </h2>
          <p className="mt-1 text-[11.5px] leading-relaxed text-mid">
            Database admins keep access without the environment allowlist. An
            admin cannot revoke itself.
          </p>

          <form action={setAdmin} className="mt-3 flex gap-2">
            <input type="hidden" name="enabled" value="1" />
            <input
              name="email"
              type="email"
              required
              autoComplete="off"
              placeholder="operator@example.com"
              aria-label="Email to grant admin"
              className="field min-w-0 flex-1 py-1.5 text-[12px]"
            />
            <SubmitButton className="btn px-3 py-1.5 text-[11.5px]" pendingText="Granting…">
              Grant
            </SubmitButton>
          </form>

          {adminRows.length === 0 ? (
            <p className="mt-3 text-[11.5px] text-low">
              No stored admins yet.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {adminRows.map((row) => (
                <li
                  key={row.user_id}
                  className="flex items-center justify-between gap-2 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[11.5px] text-body">
                      {profiles.get(row.user_id)?.email ?? row.user_id}
                    </p>
                    <p className="font-mono text-[10px] text-low">
                      since {utc(row.granted_at)}
                    </p>
                  </div>
                  <form action={setAdmin}>
                    <input type="hidden" name="enabled" value="0" />
                    <input type="hidden" name="userId" value={row.user_id} />
                    <SubmitButton
                      className="text-[10.5px] text-danger hover:underline"
                      pendingText="Revoking…"
                    >
                      Revoke
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section aria-labelledby="decided-heading" className="panel mt-5 p-5">
        <h2
          id="decided-heading"
          className="text-[15px] font-semibold tracking-[-0.02em] text-hi"
        >
          Recent decisions
        </h2>

        {decided.length === 0 ? (
          <p className="mt-3 text-[12px] text-mid">Nothing reviewed yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {decided.map((row) => (
              <li key={row.id} className="py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11.5px] text-body">
                    {profiles.get(row.owner)?.email ?? row.owner} ·{" "}
                    {planById(row.plan)?.name ?? row.plan}
                  </p>
                  <div className="flex items-center gap-2">
                    {row.status === "approved" && row.dew_granted !== null && (
                      <span className="font-mono text-[10px] text-accent-text">
                        +{row.dew_granted} dew
                      </span>
                    )}
                    <StatusPill tone={row.status === "approved" ? "ok" : "missing"}>
                      {row.status}
                    </StatusPill>
                  </div>
                </div>
                <p className="mt-0.5 font-mono text-[10px] text-low">
                  ref {row.reference} · {utc(row.decided_at)}
                </p>
                {row.decision_note && (
                  <p className="mt-1 text-[11px] leading-relaxed text-mid">
                    {row.decision_note}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="panel mt-8 p-5">
        <summary className="cursor-pointer text-[15px] font-semibold tracking-[-0.02em] text-hi">
          Configuration &amp; probes
        </summary>
        <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-mid">
          The deployment report: which keys are present, whether the schema
          matches this checkout, and which live services answer. It used to be a
          public page; only operators see it now.
        </p>
        <SetupReport />
      </details>

      <p className="mt-8 max-w-2xl text-[10.5px] leading-relaxed text-low">
        Every action here re-checks the operator role on the server, and the SQL
        functions check it again. The hidden logo gesture reveals this page&apos;s
        entry point; it never grants access on its own.
      </p>
    </main>
  );
}
