import type { MetadataRoute } from "next";

import { PRIVATE_PATHS, siteUrl } from "@/lib/seo";

/**
 * Evaluated per request, not baked in at build time: the machine that builds a
 * deployment is not the origin it is served from — CI builds with
 * `NEXT_PUBLIC_SITE_URL=https://ci.invalid` — and a robots file pointing at the
 * wrong host sends crawlers away from every page it was meant to introduce.
 */
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const origin = siteUrl();

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: PRIVATE_PATHS,
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
