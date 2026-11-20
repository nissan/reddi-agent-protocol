import Link from 'next/link';
import FunnelBeacon from '../../../components/FunnelBeacon';
import { notFound } from 'next/navigation';
import { pageMetadata } from '../../../lib/metadata';
import { showDrafts, siteUrl } from '../../../lib/site';
import { findUpdate, visibleUpdates } from '../../../lib/updates';

export const dynamicParams = false;
export function generateStaticParams() { return visibleUpdates(showDrafts).map((u) => ({ slug: u.slug })); }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const u = findUpdate((await params).slug, showDrafts);
  if (!u) return {};
  // A draft is never indexed, wherever it is shown.
  return { ...pageMetadata(siteUrl, { path: `/updates/${u.slug}`, title: u.title, description: u.summary }), ...(u.status === 'draft' ? { robots: { index: false, follow: false } } : {}) };
}

const day = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export default async function UpdatePage({ params }: { params: Promise<{ slug: string }> }) {
  const u = findUpdate((await params).slug, showDrafts);
  if (!u) notFound();
  return (
    <main id="main" className="wrap page prose">
      <p className="eyebrow">BUILD UPDATE · {day(u.date).toUpperCase()}{u.status === 'draft' ? ' · DRAFT, NOT PUBLIC' : ''}</p>
      <h1>{u.title}</h1>
      <p className="lead">{u.summary}</p>
      {u.body.map((p) => <p key={p}>{p}</p>)}
      <h2>Check it yourself</h2>
      <ul>{u.links.map((l) => <li key={l.href}><a href={l.href} rel="noopener noreferrer">{l.label}</a></li>)}</ul>
      <p><Link className="text-link" href="/updates">All updates ↗</Link><Link className="text-link" href="/#updates">Get these by email ↗</Link></p>
      <FunnelBeacon event="update_opened" slug={u.slug} />
    </main>
  );
}
