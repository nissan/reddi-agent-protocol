import Link from 'next/link';
import { pageMetadata } from '../../lib/metadata';
import { showDrafts, siteUrl } from '../../lib/site';
import { visibleUpdates } from '../../lib/updates';

export const metadata = pageMetadata(siteUrl, { path: '/updates', title: 'Build updates', description: 'Short, dated notes on what has been built and what you can check for yourself.' });

const day = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export default function Updates() {
  const updates = visibleUpdates(showDrafts);
  return (
    <main id="main" className="wrap page prose">
      <p className="eyebrow">BUILD UPDATES</p>
      <h1>What has been built</h1>
      <p className="lead">Short, dated notes. Each one links to something you can check for yourself. The same notes go to the newsletter.</p>
      {updates.length === 0 && <p>No updates have been published yet. The <Link href="/status">status page</Link> says what exists today.</p>}
      <ul className="updates">
        {updates.map((u) => (
          <li key={u.slug}>
            <p className="update-date">{day(u.date).toUpperCase()}{u.status === 'draft' && <span className="update-draft"> · DRAFT, NOT PUBLIC</span>}</p>
            <h2><Link href={`/updates/${u.slug}`}>{u.title}</Link></h2>
            <p>{u.summary}</p>
          </li>
        ))}
      </ul>
      <p><Link className="text-link" href="/#updates">Get these by email ↗</Link><Link className="text-link" href="/status">See what exists today ↗</Link></p>
    </main>
  );
}
