/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig = {
  async redirects() {
    return [
      { source: "/terms-of-service", destination: "/terms", permanent: true },
      { source: "/privacy-policy", destination: "/privacy", permanent: true },
      { source: "/tos", destination: "/terms", permanent: true },
    ];
  },
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
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
