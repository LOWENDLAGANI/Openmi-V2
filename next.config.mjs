/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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
