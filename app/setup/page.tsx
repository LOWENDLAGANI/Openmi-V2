import Link from "next/link";

import { Brand } from "@/components/Brand";
import { StatusPill } from "@/components/StatusPill";
import { AI_PROVIDER_KEYS, readEnvReport } from "@/lib/env";
import { listMigrationFiles, probeMigrations } from "@/lib/migrations";

// Configuration is read per request. A setup page served from a shared cache
// would lie about the deployment it is describing.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Setup — Openmi",
};

export default async function SetupPage() {
  const report = readEnvReport();
  const [migrations, probe] = await Promise.all([
    listMigrationFiles(),
    probeMigrations(),
  ]);

  const providerList = AI_PROVIDER_KEYS.join(" · ");

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <header className="flex items-center justify-between">
        <Brand compact />
        <Link
          href="/"
          className="text-[13px] text-mid transition-colors hover:text-hi"
        >
          Back
        </Link>
      </header>

      <h1 className="mt-10 text-2xl font-semibold tracking-tight text-hi">
        Setup
      </h1>
      <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-mid">
        Everything this deployment needs, and whether it is present. Values are
        never read back — only whether a key is set. The app starts with none of
        these, so this page is the answer to &ldquo;why is that not working?&rdquo;
      </p>

      <section
        aria-labelledby="config-heading"
        className="mt-8 rounded-xl border border-line bg-card"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 id="config-heading" className="text-[14px] font-semibold text-hi">
            Configuration
          </h2>
          <StatusPill tone={report.ready ? "ok" : "pending"}>
            {report.requiredPresent}/{report.required} required keys ·{" "}
            {report.aiProviders === 0 ? "no provider" : `${report.aiProviders} provider`}
          </StatusPill>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-[0.12em] text-low">
                <th className="px-5 py-3 font-medium">Key</th>
                <th className="px-5 py-3 font-medium">Scope</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Unlocks</th>
              </tr>
            </thead>
            <tbody>
              {report.statuses.map((status) => (
                <tr key={status.key} className="border-t border-line align-top">
                  <td className="px-5 py-3">
                    <span className="font-mono text-[12px] text-hi">
                      {status.key}
                    </span>
                    <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-low">
                      {status.hint}
                    </p>
                  </td>
                  <td className="px-5 py-3 text-mid">
                    {status.scope === "public" ? "browser" : "server only"}
                  </td>
                  <td className="px-5 py-3">
                    {status.present ? (
                      <StatusPill tone="ok">set</StatusPill>
                    ) : status.required ? (
                      <StatusPill tone="missing">required</StatusPill>
                    ) : (
                      <StatusPill tone="optional">optional</StatusPill>
                    )}
                  </td>
                  <td className="px-5 py-3 text-mid">{status.unlocks}</td>
                </tr>
              ))}
              <tr className="border-t border-line align-top">
                <td className="px-5 py-3">
                  <span className="font-mono text-[12px] text-hi">
                    AI provider
                  </span>
                  <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-low">
                    {providerList}
                  </p>
                </td>
                <td className="px-5 py-3 text-mid">server only</td>
                <td className="px-5 py-3">
                  {report.aiProviders > 0 ? (
                    <StatusPill tone="ok">set</StatusPill>
                  ) : (
                    <StatusPill tone="missing">required</StatusPill>
                  )}
                </td>
                <td className="px-5 py-3 text-mid">
                  Chat answers. Without one, the composer explains the gap
                  instead of inventing a reply.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section
        aria-labelledby="migrations-heading"
        className="mt-6 rounded-xl border border-line bg-card p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2
            id="migrations-heading"
            className="text-[14px] font-semibold text-hi"
          >
            Migrations
          </h2>
          <StatusPill
            tone={
              probe.state === "applied"
                ? "ok"
                : probe.state === "not-applied"
                  ? "missing"
                  : "pending"
            }
          >
            {probe.state === "applied"
              ? "applied"
              : probe.state === "not-applied"
                ? "not applied"
                : probe.state === "unconfigured"
                  ? "waiting for Supabase"
                  : "unreachable"}
          </StatusPill>
        </div>

        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          {probe.detail}
        </p>

        <ul className="mt-4 space-y-1.5">
          {migrations.length === 0 ? (
            <li className="text-[12px] text-low">
              No migration files found in{" "}
              <span className="font-mono">supabase/migrations</span>.
            </li>
          ) : (
            migrations.map((migration) => (
              <li
                key={migration.name}
                className="flex items-center justify-between gap-3 rounded-lg border border-line bg-raised px-3 py-2"
              >
                <span className="font-mono text-[12px] text-body">
                  {migration.name}
                </span>
                <span className="font-mono text-[11px] text-low">
                  v{migration.version}
                </span>
              </li>
            ))
          )}
        </ul>

        <p className="mt-4 text-[12px] leading-relaxed text-low">
          Apply with{" "}
          <span className="font-mono text-mid">
            supabase link --project-ref &lt;ref&gt; &amp;&amp; supabase db push
          </span>
          . Migrations run before the deploy that depends on them; Vercel does
          not apply them.
        </p>
      </section>

      {report.missingRequired.length > 0 && (
        <section
          aria-labelledby="missing-heading"
          className="mt-6 rounded-xl border border-line bg-card p-5"
        >
          <h2 id="missing-heading" className="text-[14px] font-semibold text-hi">
            Still missing
          </h2>
          <ul className="mt-3 space-y-1.5">
            {report.missingRequired.map((key) => (
              <li
                key={key}
                className="flex items-start gap-2 text-[13px] text-mid"
              >
                <span aria-hidden="true" className="mt-1.5 size-1.5 rounded-full bg-danger" />
                <span className="font-mono text-[12px] text-body">{key}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[12px] leading-relaxed text-low">
            Set these in <span className="font-mono text-mid">.env.local</span>{" "}
            for development, or in Vercel under Project → Settings →
            Environment Variables for Preview and Production separately.
          </p>
        </section>
      )}
    </main>
  );
}
