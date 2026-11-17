import type { MetadataRoute } from "next";

import { INDEXABLE_PAGES, siteUrl } from "@/lib/seo";

/**
 * The public pages, with absolute URLs built from the configured origin.
 *
 * No `lastModified`: the only date this app knows is the moment it was built, so
 * stamping every entry with it would tell Google all five pages changed on every
 * deploy. A lastmod that is always "now" is worse than none — crawlers learn to
 * ignore it, and the one time a page really did change the signal is gone.
 *
 * Read at request time for the same reason as `robots.ts`: the build machine's
 * origin is often not the one being served.
 */
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteUrl();

  return INDEXABLE_PAGES.map((page) => ({
    url: `${origin}${page.path}`,
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));
}
