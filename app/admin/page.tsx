import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Brand } from "@/components/Brand";
import { StatusPill } from "@/components/StatusPill";
import { readAdminAccess } from "@/lib/admin/access";
import { planById } from "@/lib/billing/plans";
import { formatDew } from "@/lib/dew";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { grantDew, reviewReceipt, setAdmin } from "./actions";

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
  has_paid: boolean;
};

function utc(value: string | null): string {
  if (!value) return "—";
  return value.slice(0, 16).replace("T", " ");
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
  searchParams: Promise<{ error?: string; done?: string }>;
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
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
        <p className="eyebrow">admin</p>
        <h1 className="mt-2 text-[24px] font-semibold tracking-[-0.02em] text-hi">
          Service role required
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          Reading every receipt and every balance needs SUPABASE_SERVICE_ROLE_KEY
          on the server. The role check already passed; this key is the missing
          piece.
        </p>
        <Link href="/setup" className="btn btn-primary mt-6 w-fit px-4 py-2">
          Open setup
        </Link>
      </main>
    );
  }

  const [requestsResult, adminsResult, membersResult, balancesResult] =
    await Promise.all([
      admin
        .from("payment_requests")
        .select(
          "id, owner, plan, amount, reference, note, receipt_path, receipt_name, status, dew_granted, decision_note, created_at, decided_at"
        )
        .order("created_at", { ascending: false })
        .limit(60),
      admin
        .from("admin_users")
        .select("user_id, granted_at")
        .order("granted_at", { ascending: false })
        .limit(50),
      admin.from("profiles").select("id", { count: "exact", head: true }),
      admin.from("profiles").select("dew_balance").limit(5000),
    ]);

  const requests = (requestsResult.data ?? []) as RequestRow[];
  const adminRows = (adminsResult.data ?? []) as Array<{
    user_id: string;
    granted_at: string;
  }>;

  const ownerIds = [...new Set([...requests.map((row) => row.owner), ...adminRows.map((row) => row.user_id)])];

  const profilesResult = ownerIds.length
    ? await admin
        .from("profiles")
        .select("id, email, dew_balance, has_paid")
        .in("id", ownerIds)
    : { data: [] as ProfileRow[] };

  const profiles = new Map(
    ((profilesResult.data ?? []) as ProfileRow[]).map((row) => [row.id, row])
  );

  const pending = requests.filter((row) => row.status === "pending");
  const decided = requests.filter((row) => row.status !== "pending").slice(0, 10);

  const dewHeld = ((balancesResult.data ?? []) as Array<{
    dew_balance: number | string;
  }>).reduce((total, row) => total + Number(row.dew_balance), 0);

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

  const selfIsStoredAdmin = adminRows.some(
    (row) => row.user_id === access.userId
  );

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
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

        <div className="flex items-center gap-2">
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
          { label: "dew held", value: formatDew(dewHeld) },
          { label: "admins", value: String(adminRows.length) },
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

      {requestsResult.error && (
        <p
          role="alert"
          className="mt-5 rounded-2xl border border-danger/25 bg-danger/8 px-4 py-2.5 text-[12px] leading-relaxed text-danger"
        >
          Payment tables are not readable: {requestsResult.error.message}. Apply
          migration 013 with <span className="font-mono">supabase db push</span>.
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

                  <p className="mt-1 font-mono text-[10.5px] text-low">
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
                      {member?.has_paid ? "paid" : "free"}
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
                      <button
                        name="decision"
                        value="approved"
                        className="btn btn-primary px-3 py-1.5 text-[11.5px]"
                      >
                        Approve
                      </button>
                      <button
                        name="decision"
                        value="rejected"
                        className="btn px-3 py-1.5 text-[11.5px]"
                      >
                        Reject
                      </button>
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
            <button className="btn btn-primary w-full py-2 text-[12px]">
              Add Dew
            </button>
          </form>
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
            <button className="btn px-3 py-1.5 text-[11.5px]">Grant</button>
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
                    <input
                      type="hidden"
                      name="email"
                      value={profiles.get(row.user_id)?.email ?? ""}
                    />
                    <button className="text-[10.5px] text-danger hover:underline">
                      Revoke
                    </button>
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

      <p className="mt-8 max-w-2xl text-[10.5px] leading-relaxed text-low">
        Every action here re-checks the operator role on the server, and the SQL
        functions check it again. The hidden logo gesture reveals this page&apos;s
        entry point; it never grants access on its own.
      </p>
    </main>
  );
}
