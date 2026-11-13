import Link from "next/link";

import { Brand } from "@/components/Brand";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { SUPPORT_EMAIL, supportMailto } from "@/lib/support";

/**
 * The shell every legal page shares.
 *
 * The two documents differ in content, not in shape: an eyebrow, a title, the
 * date it was last changed, numbered sections, and one contact address. Keeping
 * the shell here means a heading style, a clause spacing or the support link
 * cannot drift between the pages a reader is asked to trust.
 */

export type LegalBlock =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] };

export type LegalSection = {
  /** Anchor target, so a banner or a footer can link to one clause. */
  id: string;
  title: string;
  blocks: LegalBlock[];
};

export function LegalPage({
  eyebrow,
  title,
  updated,
  intro,
  sections,
  contact,
  other,
}: {
  eyebrow: string;
  title: string;
  /** The date this revision took effect, shown under the title. */
  updated: string;
  intro: string;
  sections: LegalSection[];
  contact: { title: string; lead: string; subject: string };
  other: { href: string; label: string };
}) {
  return (
    <main className="animate-enter mx-auto w-full max-w-3xl px-5 py-8 sm:px-8">
      <header className="flex items-center justify-between gap-2">
        <Link href="/" aria-label="Openmi home">
          <Brand />
        </Link>
        <nav className="flex items-center gap-1.5">
          <ThemeSwitcher variant="icon" />
          <Link href={other.href} className="btn px-3.5 py-1.5 text-[12px]">
            {other.label}
          </Link>
        </nav>
      </header>

      <p className="eyebrow mt-10">{eyebrow}</p>
      <h1 className="mt-3 text-balance text-[clamp(1.9rem,5vw,2.9rem)] font-semibold leading-[1.06] tracking-[-0.03em] text-hi">
        {title}
      </h1>
      <p className="mt-3 text-[12px] font-mono uppercase tracking-[0.12em] text-low">
        Last updated {updated}
      </p>
      <p className="mt-4 text-pretty text-[14px] leading-relaxed text-mid">{intro}</p>

      {sections.map((section) => (
        <section
          key={section.id}
          id={section.id}
          className="mt-12 scroll-mt-24 border-t border-line pt-6"
        >
          <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
            {section.title}
          </h2>

          {section.blocks.map((block, index) =>
            block.kind === "p" ? (
              <p
                key={index}
                className="mt-2 text-pretty text-[13px] leading-relaxed text-mid"
              >
                {block.text}
              </p>
            ) : (
              <ul
                key={index}
                className="mt-3 space-y-2 text-[13px] leading-relaxed text-mid"
              >
                {block.items.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent"
                    />
                    <span className="min-w-0 break-words">{item}</span>
                  </li>
                ))}
              </ul>
            )
          )}
        </section>
      ))}

      <section
        id="contact"
        className="mt-12 scroll-mt-24 border-t border-line pt-6"
      >
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
          {contact.title}
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          {contact.lead}{" "}
          <a
            href={supportMailto(contact.subject)}
            className="break-words text-accent-text underline-offset-2 hover:underline"
          >
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </section>

      <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-line py-6">
        <p className="text-[11.5px] text-low">© 2026 Openmi</p>
        <div className="flex items-center gap-3">
          <Link href="/terms" className="eyebrow hover:text-hi">
            terms
          </Link>
          <Link href="/privacy" className="eyebrow hover:text-hi">
            privacy
          </Link>
          <Link href="/" className="eyebrow hover:text-hi">
            home
          </Link>
        </div>
      </footer>
    </main>
  );
}
