import type { MetadataRoute } from 'next';
import { indexable, robotsRules, siteUrl } from '../lib/site';
export const dynamic = 'force-static';
// Crawlers are told to stay out of everything unless the launch switch is on (resolveIndexable in lib/site.ts).
export default function robots(): MetadataRoute.Robots {
  return robotsRules(indexable, siteUrl);
}
