"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Brand } from "@/components/Brand";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";

export type NavItem = {
  href: string;
  label: string;
};

const DEFAULT_NAV: NavItem[] = [
  { href: "/#features", label: "Features" },
  { href: "/#how", label: "Workflow" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
];

export function ArrowGlyph() {
  return (
    <svg
      className="m-arrow"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M1.5 6h8.25M6.25 2.5 9.75 6l-3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SiteHeader({
  nav = DEFAULT_NAV,
  loginHref = "/login",
  currentPath,
  signedIn = false,
}: {
  nav?: NavItem[];
  loginHref?: string;
  currentPath?: string;
  signedIn?: boolean;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const primaryHref = signedIn ? "/chat" : loginHref;
  const primaryLabel = signedIn ? "Open workspace" : "Start free with GitHub";

  return (
    <header className="site-nav">
      <div className="lp-wrap flex h-full items-center justify-between gap-4">
        <div className="flex items-center gap-8">
          <a
            href="#main"
            className="sr-only rounded-[var(--r-sm)] focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[100] focus:border focus:border-line-strong focus:bg-card focus:px-4 focus:py-2 focus:text-[14px] focus:text-hi"
          >
            Skip to content
          </a>

          <Link href="/" aria-label="Openmi home" className="shrink-0">
            <Brand compact />
          </Link>

          <nav aria-label="Primary" className="hidden items-center gap-7 md:flex">
            {nav.map((item) => {
              const active = currentPath === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`t-link text-[15px] font-medium ${
                    active ? "text-hi" : "text-mid hover:text-hi"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2.5">
          <ThemeSwitcher variant="icon" />

          {!signedIn && (
            <Link
              href={loginHref}
              className="t-link hidden px-2 py-1 text-[15px] font-medium text-mid hover:text-hi sm:inline-flex"
            >
              Sign in
            </Link>
          )}

          <Link
            href={primaryHref}
            className="btn btn-primary h-10 px-4 text-[14px]"
          >
            <span className="hidden sm:inline">{primaryLabel}</span>
            <span className="sm:hidden">
              {signedIn ? "Workspace" : "Start free"}
            </span>
            <ArrowGlyph />
          </Link>

          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            className="btn grid size-10 p-0 md:hidden"
          >
            {open ? (
              <X aria-hidden="true" className="size-4" strokeWidth={1.75} />
            ) : (
              <Menu aria-hidden="true" className="size-4" strokeWidth={1.75} />
            )}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-b border-line bg-canvas md:hidden">
          <nav
            aria-label="Mobile navigation"
            className="lp-wrap flex flex-col py-4"
          >
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="flex h-12 items-center border-b border-line text-[16px] font-medium text-hi last:border-b-0"
              >
                {item.label}
              </Link>
            ))}
            {!signedIn && (
              <Link
                href={loginHref}
                onClick={() => setOpen(false)}
                className="flex h-12 items-center text-[16px] font-medium text-mid"
              >
                Sign in
              </Link>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
