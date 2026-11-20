import type { MetadataRoute } from 'next';
import { siteUrl } from '../lib/site';
export const dynamic = 'force-static';
export default function sitemap(): MetadataRoute.Sitemap {
  return ['', '/status', '/sandbox', '/privacy', '/terms'].map((p) => ({ url: `${siteUrl}${p}` }));
}
