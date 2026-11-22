import Link from "next/link";

import { Brand } from "@/components/Brand";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { SUPPORT_EMAIL, supportMailto } from "@/lib/support";

export type LegalBlock =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] };

export type LegalSection = {
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
  updated: string;
  intro: string;
  sections: LegalSection[];
  contact: { title: string; lead: string; subject: string };
  other: { href: string; label: string };
}) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-2 px-5 sm:px-8">
          <Link href="/" aria-label="Openmi home">
            <Brand />
          </Link>
          <nav className="flex items-center gap-2">
            <ThemeSwitcher variant="icon" />
            <Link href={other.href} className="btn px-3.5 py-1.5 text-[12.5px]">
              {other.label}
            </Link>
          </nav>
        </div>
      </header>

      <main className="animate-enter mx-auto w-full max-w-3xl px-5 py-10 sm:px-8">
        <p className="text-[12px] font-medium capitalize text-accent-text">
          {eyebrow}
        </p>
        <h1 className="mt-2 text-balance text-[clamp(1.9rem,4.5vw,2.75rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-hi">
          {title}
        </h1>
        <p className="mt-2.5 font-mono text-[12px] text-low">
          Last updated {updated}
        </p>
        <p className="mt-5 text-pretty text-[14.5px] leading-[1.65] text-mid">
          {intro}
        </p>

        {sections.map((section) => (
          <section
            key={section.id}
            id={section.id}
            className="mt-10 scroll-mt-20 border-t border-line pt-6"
          >
            <h2 className="text-[16px] font-semibold tracking-[-0.015em] text-hi">
              {section.title}
            </h2>

            {section.blocks.map((block, index) =>
              block.kind === "p" ? (
                <p
                  key={index}
                  className="mt-3 text-pretty text-[13.5px] leading-[1.65] text-mid"
                >
                  {block.text}
                </p>
              ) : (
                <ul
                  key={index}
                  className="mt-3 list-disc space-y-2 pl-5 text-[13.5px] leading-[1.65] text-mid marker:text-line-strong"
                >
                  {block.items.map((item) => (
                    <li key={item} className="min-w-0 break-words">
                      {item}
                    </li>
                  ))}
                </ul>
              )
            )}
          </section>
        ))}

        <section
          id="contact"
          className="mt-10 scroll-mt-20 border-t border-line pt-6"
        >
          <h2 className="text-[16px] font-semibold tracking-[-0.015em] text-hi">
            {contact.title}
          </h2>
          <p className="mt-3 text-[13.5px] leading-[1.65] text-mid">
            {contact.lead}{" "}
            <a
              href={supportMailto(contact.subject)}
              className="break-words font-medium text-accent-text underline-offset-2 hover:underline"
            >
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        </section>

        <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-line py-6 text-[12.5px]">
          <p className="font-mono text-low">© 2026 Openmi</p>
          <div className="flex flex-wrap items-center gap-4 text-mid">
            <Link href="/terms" className="hover:text-hi">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-hi">
              Privacy
            </Link>
            <Link href="/refunds" className="hover:text-hi">
              Refunds
            </Link>
            <Link href="/account/delete" className="hover:text-hi">
              Delete my data
            </Link>
            <Link href="/" className="hover:text-hi">
              Home
            </Link>
          </div>
        </footer>
      </main>
    </div>
  );
}
