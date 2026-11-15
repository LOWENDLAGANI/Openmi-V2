/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  // Clickjacking. `frame-ancestors 'none'` is the modern answer and
  // X-Frame-Options repeats it for browsers that predate CSP: the app refuses
  // to be embedded anywhere, so no hostile page can lay an invisible frame over
  // its own buttons. The policy names only directives that harden the document
  // itself — no script-src or style-src — because the app ships inline styles
  // and a consent-gated ad frame, and a source list without a nonce would
  // break both without adding protection here.
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  },
  // Two years, every name under the domain, and preload-eligible. A downgrade
  // to http on any subdomain is refused for that window, which is the point;
  // the record can only be sent over https in the first place.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // This origin's documents and resources are not shared with another origin:
  // no window handle leaks through a cross-origin opener, and no other site can
  // load our responses as a subresource and read them.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const nextConfig = {
  async redirects() {
    return [
      { source: "/terms-of-service", destination: "/terms", permanent: true },
      { source: "/privacy-policy", destination: "/privacy", permanent: true },
      { source: "/tos", destination: "/terms", permanent: true },
      // A policy that a scan and a reader both look for by several names.
      { source: "/refund-policy", destination: "/refunds", permanent: true },
      {
        source: "/refunds-and-cancellation",
        destination: "/refunds",
        permanent: true,
      },
      {
        source: "/cancellation-policy",
        destination: "/refunds",
        permanent: true,
      },
      // The deletion path, under the two names people arrive with.
      { source: "/delete-account", destination: "/account/delete", permanent: true },
      { source: "/data-deletion", destination: "/account/delete", permanent: true },
    ];
  },
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    // `/:path*` includes /api: the same origin rules apply to a JSON response
    // as to a page, and an API route framed or reused by another site is the
    // same defect.
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // Every route that touches a session, a repository or a balance is dynamic.
  // Nothing in this app is safe to prerender into a shared cache.
  experimental: {
    // Receipt uploads travel through a server action. The default 1 MB body is
    // smaller than a phone screenshot, and the action itself caps files at
    // 5 MB; this ceiling exists so that cap is reachable.
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
