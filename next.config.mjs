/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Every route that touches a session, a repository or a balance is dynamic.
  // Nothing in this app is safe to prerender into a shared cache.
  experimental: {},
};

export default nextConfig;
