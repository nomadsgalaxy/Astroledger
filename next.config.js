/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  experimental: { serverActions: { bodySizeLimit: '10mb' } },

  // Production security headers. Apply when Astroledger is reachable over the
  // public internet (Cloudflare Tunnel, real reverse proxy). Localhost dev
  // still works fine with these enabled.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Content-Type-Options',    value: 'nosniff' },
          { key: 'X-Frame-Options',           value: 'DENY' },
          { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy',        value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          // Server actions need the Origin header to match host; allow Cloudflare's
          // CF-Connecting-IP etc. flow through naturally.
        ],
      },
    ];
  },

  // When ASTROLEDGER_PUBLIC_HOST is set (tunnel mode), it's the canonical host for
  // server actions' origin validation. Without it Next 15+ rejects cross-origin
  // server-action POSTs from anything other than NEXTAUTH_URL's host.
  ...(process.env.ASTROLEDGER_PUBLIC_HOST ? {
    experimental: {
      serverActions: {
        bodySizeLimit: '10mb',
        allowedOrigins: [process.env.ASTROLEDGER_PUBLIC_HOST],
      },
    },
  } : {}),
};
module.exports = nextConfig;
