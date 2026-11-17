import type { MetadataRoute } from "next";

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

export const SITE_TITLE = "Openmi: your repository, with a reviewer built in";

export const SITE_DESCRIPTION =
  "Connect GitHub, pick a repository, and chat with a model that reads the code and proposes edits. Nothing is pushed until you approve.";

export const SITE_LOCALE = "en_US";

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
  "/admin",
  "/account/",
  "/login",
  "/setup",
  "/banned",
];
