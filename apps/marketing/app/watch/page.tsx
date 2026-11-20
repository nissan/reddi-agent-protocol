import Link from 'next/link';
import VideoEmbed from '../../components/VideoEmbed';
import { pageMetadata } from '../../lib/metadata';
import { showDrafts, siteUrl } from '../../lib/site';
import { visibleVideos } from '../../lib/videos';

export const metadata = pageMetadata(siteUrl, { path: '/watch', title: 'Watch', description: 'Short videos that explain receipted AI inference on Solana and walk through the devnet sandbox.' });

const day = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export default function Watch() {
  const videos = visibleVideos(showDrafts);
  return (
    <main id="main" className="wrap page prose">
      <p className="eyebrow">WATCH</p>
      <h1>See it explained</h1>
      <p className="lead">Short videos on what a receipt for paid inference is, why it matters and how to try it on devnet.</p>
      {videos.length === 0 && <div className="notice"><h2>The first video is being made</h2><p>Nothing has been published here yet. Until then, the sandbox shows the same thing in the browser and the build updates say what has changed.</p><p><Link className="button" href="/sandbox">Open the sandbox</Link></p></div>}
      <ul className="updates">
        {videos.map((v) => (
          <li key={v.slug} id={v.slug}>
            <p className="update-date">{day(v.date).toUpperCase()} · {v.minutes} MIN{v.status === 'draft' && <span className="update-draft"> · DRAFT, NOT PUBLIC</span>}</p>
            <h2>{v.title}</h2>
            <p>{v.summary}</p>
            <VideoEmbed youtubeId={v.youtubeId} title={v.title} />
          </li>
        ))}
      </ul>
      <p><Link className="text-link" href="/#updates">Get new videos by email ↗</Link><Link className="text-link" href="/updates">Read the build updates ↗</Link></p>
    </main>
  );
}
