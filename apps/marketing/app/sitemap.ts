import type { MetadataRoute } from 'next';
import { siteUrl } from '../lib/site';
import { visibleUpdates } from '../lib/updates';
import { visibleVideos } from '../lib/videos';
export const dynamic = 'force-static';
export default function sitemap(): MetadataRoute.Sitemap {
  // Published updates only: a draft is never listed, wherever the build runs.
  const updates = visibleUpdates(false).map((u) => `/updates/${u.slug}`);
  // /watch is listed once it has a published video; an empty page is not worth a crawler's visit.
  const watch = visibleVideos(false).length > 0 ? ['/watch'] : [];
  return ['', '/status', '/market', '/sandbox', '/updates', ...updates, ...watch, '/privacy', '/terms'].map((p) => ({ url: `${siteUrl}${p}` }));
}
