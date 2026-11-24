import type { Metadata, MetadataRoute } from "next";

import { PLANS } from "@/lib/billing/plans";
import {
  CREDIT_PER_HOUR,
  DAILY_FREE_CREDIT,
  PAID_DAILY_FREE_CREDIT,
  TRIAL_CREDIT,
} from "@/lib/credits";

/**
 * What a search engine is told about the site, in one place.
 *
 * Three things have to agree: the origin in `metadataBase`, the absolute URLs in
 * `sitemap.xml`, and the `Sitemap:` line in `robots.txt`. A sitemap that lists a
 * host the pages do not serve is a crawl error rather than a ranking detail, so
 * they are derived from the same value here instead of being typed three times.
 *
 * `NEXT_PUBLIC_SITE_URL` is the deployment's own origin and already the source
 * of truth for auth redirects and pull-request links. A bare domain is treated
 * as https, because leaving the scheme off is the common slip and throwing over
 * it would take the whole build down. Unset means development, so this falls
 * back to the same origin `.env.example` ships; a build on a machine with no
 * environment still emits a valid sitemap instead of failing.
 */
const LOCAL_ORIGIN = "http://localhost:3000";

export function siteUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim();
  if (raw.length === 0) return LOCAL_ORIGIN;

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    return new URL(withScheme).origin;
  } catch {
    return LOCAL_ORIGIN;
  }
}

export const SITE_NAME = "Openmi";

export const SITE_TITLE =
  "Free GitHub Coding Agent Priced by the Hour | Openmi";

export const SITE_DESCRIPTION = `Ad-supported browser coding agent for GitHub with cloud Linux sandboxes, live previews, verified line citations, and isolated pull requests. ${DAILY_FREE_CREDIT} free Credit daily, ${CREDIT_PER_HOUR} Credit per hour.`;

export const SITE_LOCALE = "en_US";

export function pageMetadata(input: {
  path: string;
  title: string;
  description: string;
  noIndex?: boolean;
  other?: Record<string, string>;
}): Metadata {
  const canonical = input.path === "" ? "/" : input.path;

  return {
    title: input.title,
    description: input.description,
    alternates: { canonical },
    ...(input.noIndex
      ? {
          robots: {
            index: false,
            follow: false,
          },
        }
      : {}),
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: SITE_LOCALE,
      url: canonical,
      title: input.title,
      description: input.description,
    },
    twitter: {
      card: "summary_large_image",
      title: input.title,
      description: input.description,
    },
    ...(input.other ? { other: input.other } : {}),
  };
}

/**
 * Serializes a JSON-LD object safely for inline `<script type="application/ld+json">`.
 * Escaping `<` prevents closing the script tag if a string ever contains `</script>`.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function breadcrumbJsonLd(
  items: Array<{ name: string; path: string }>
): Record<string, unknown> {
  const origin = siteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${origin}${item.path === "/" ? "" : item.path}`,
    })),
  };
}

export function faqJsonLd(
  items: ReadonlyArray<{ question: string; answer: string }>
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}

export function pricingOffersJsonLd(): Record<string, unknown> {
  const origin = siteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web",
    url: origin,
    description: SITE_DESCRIPTION,
    offers: [
      {
        "@type": "Offer",
        name: "Free tier (ad-supported)",
        price: "0",
        priceCurrency: "MYR",
        url: `${origin}/pricing`,
        availability: "https://schema.org/InStock",
        description: `${DAILY_FREE_CREDIT} free Credit daily (${Math.floor(DAILY_FREE_CREDIT / CREDIT_PER_HOUR)} hrs/day) plus ${TRIAL_CREDIT} Credit trial grant.`,
      },
      ...PLANS.map((plan) => ({
        "@type": "Offer",
        name: plan.name,
        price: String(plan.price),
        priceCurrency: "MYR",
        url: `${origin}/pricing`,
        availability: "https://schema.org/InStock",
        description: `${plan.days}-day fixed-term pass with ${PAID_DAILY_FREE_CREDIT} Credit daily, +${plan.credit} upfront wallet Credit, and Claude Haiku 4.5 access. No auto-renewal.`,
      })),
    ],
  };
}

export function organizationJsonLd(): Record<string, unknown> {
  const origin = siteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: origin,
    logo: `${origin}/icon-512.png`,
  };
}

type ChangeFrequency = NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;

/**
 * The pages a stranger may land on, in the order they matter.
 *
 * Everything behind the session gate is absent on purpose: an indexed sign-in
 * redirect is a search result nobody can open, and Google treats a page that
 * redirects everyone as a soft 404. Legal pages are listed because they are
 * public and a reader looking for them by name should find them here.
 */
export const INDEXABLE_PAGES: {
  path: string;
  changeFrequency: ChangeFrequency;
  priority: number;
}[] = [
  { path: "", changeFrequency: "weekly", priority: 1 },
  { path: "/pricing", changeFrequency: "weekly", priority: 0.9 },
  { path: "/about", changeFrequency: "monthly", priority: 0.8 },
  { path: "/refunds", changeFrequency: "yearly", priority: 0.4 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
];

/**
 * Routes that exist for a signed-in reader or an operator, and the endpoints.
 *
 * `allow: "/"` plus a prefix disallow is the shape Google documents: the first
 * matching rule wins, and the shorter path rule allows everything not named
 * here.
 */
export const PRIVATE_PATHS = [
  "/api/",
  "/auth/",
  "/chat",
  "/agent",
  "/activity",
  "/pay",
  "/report",
  "/suggestions",
  "/admin",
  "/account/",
  "/login",
  "/setup",
  "/banned",
];
