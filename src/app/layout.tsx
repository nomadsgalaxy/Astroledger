// Root layout. Intentionally bare - no Shell, no auth check. Those are
// applied per-route-group:
//   • (app)/layout.tsx → awaits auth() then wraps in Shell
//   • (auth)/layout.tsx → renders bare so signin can be reached unauthenticated
//
// This guarantees: an unauthenticated request to ANY page in (app) is
// redirected before any Server Component body or Prisma query runs.

import './globals.css';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? 'http://localhost:5050'),
  title: 'Astroledger',
  description: 'Engineering your money',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Astroledger' },
  icons: {
    // Order matters: browsers pick the first format they support. SVG first
    // (crisp at any size), then the multi-size .ico (legacy + Windows), then
    // explicit PNG fallbacks. All generated from the same mark via
    // `node scripts/generate-icons.mjs`.
    icon: [
      { url: '/icons/astroledger-icon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: '16x16 32x32 48x48' },
      { url: '/icons/astroledger-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/astroledger-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/astroledger-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple:   [{ url: '/icons/astroledger-180.png', sizes: '180x180' }],
  },
  openGraph: {
    title: 'Astroledger',
    description: 'Engineering your money — self-hosted, local-first personal finance.',
    siteName: 'Astroledger',
    images: [{ url: '/icons/astroledger-og.png', width: 1200, height: 630, alt: 'Astroledger' }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Astroledger',
    description: 'Engineering your money — self-hosted, local-first personal finance.',
    images: ['/icons/astroledger-og.png'],
  },
};

export const viewport: Viewport = {
  themeColor: '#FD5000',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* Register the service worker on first paint. Done inline so it
            doesn't need a client component shell. */}
        <script dangerouslySetInnerHTML={{ __html: `
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
              navigator.serviceWorker.register('/sw.js').catch(() => {});
            });
          }
        `}} />
      </head>
      <body>{children}</body>
    </html>
  );
}
