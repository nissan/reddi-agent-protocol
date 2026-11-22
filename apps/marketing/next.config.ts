import type { NextConfig } from 'next';
import { withBotId } from 'botid/next/config';
import { fileURLToPath } from 'node:url';
import { indexable } from './lib/site.ts';
const config: NextConfig = {
  poweredByHeader: false,
  turbopack: { root: fileURLToPath(new URL('.', import.meta.url)) },
  async headers() { return [
    { source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      { key: 'X-Frame-Options', value: 'DENY' },
      // The launch switch (resolveIndexable in lib/site.ts): noindex everywhere except a Vercel production build with SITE_PUBLIC=1.
      ...(indexable ? [] : [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }]),
    ] },
  ]; },
};
// withBotId adds the rewrites that proxy BotID's client script and check through this site's own origin.
export default withBotId(config);
