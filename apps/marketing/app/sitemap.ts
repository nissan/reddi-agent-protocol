import type { MetadataRoute } from 'next';
import { siteUrl } from '../lib/site';
import { visibleUpdates } from '../lib/updates';
export const dynamic = 'force-static';
export default function sitemap(): MetadataRoute.Sitemap {
  // Published updates only: a draft is never listed, wherever the build runs.
  const updates = visibleUpdates(false).map((u) => `/updates/${u.slug}`);
  return ['', '/status', '/sandbox', '/updates', ...updates, '/privacy', '/terms'].map((p) => ({ url: `${siteUrl}${p}` }));
}
