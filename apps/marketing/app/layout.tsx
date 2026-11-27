import type { Metadata } from 'next';
import Link from 'next/link';
import { indexable, siteUrl } from '../lib/site';
import { APP_URL, DEFAULT_DESCRIPTION, GITHUB_URL, SITE_NAME, STAGE, X_URL } from '../lib/copy';
import Analytics from '../components/Analytics';
import Consent from '../components/Consent';
import VercelAnalytics from '../components/VercelAnalytics';
import ThemeToggle from '../components/ThemeToggle';
import { ANALYTICS_ENABLED } from '../lib/analytics/enabled';
import { visibleVideos } from '../lib/videos';
import './globals.css';

// The Watch link appears once a video is published; until then the page exists but is not advertised.
const hasVideos = visibleVideos(false).length > 0;

export const metadata: Metadata = {
  title: { default: `${SITE_NAME}: receipted AI inference on Solana`, template: `%s · ${SITE_NAME}` },
  description: DEFAULT_DESCRIPTION,
  metadataBase: new URL(siteUrl),
  icons: { icon: [{ url: '/brand/icon.png', type: 'image/png' }], apple: [{ url: '/brand/apple-icon.png', sizes: '180x180' }] },
  // noindex unless the launch switch is on (resolveIndexable in lib/site.ts).
  robots: indexable ? { index: true, follow: true } : { index: false, follow: false },
};

// Applies a pinned Light or Dark choice before first paint, so a reader who chose Dark never sees a light flash.
// Auto (nothing stored) leaves the attribute off and the CSS follows the operating system.
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("rap-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

function Mark() { return <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>; }

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <a className="skip" href="#main">Skip to content</a>
        <p className="stage-strip"><span className="dot" aria-hidden="true" /> {STAGE}</p>
        <header className="header wrap">
          <Link className="brand" href="/" aria-label={`${SITE_NAME} home`}><Mark /><span>Reddi Agent Protocol</span></Link>
          <nav aria-label="Main navigation">
            <Link href="/#how">How it works</Link>
            <Link href="/sandbox">Sandbox</Link>
            <Link href="/status">Status</Link>
            <Link href="/market">The numbers</Link>
            <Link href="/updates">Updates</Link>
            {hasVideos && <Link href="/watch">Watch</Link>}
            <Link className="nav-cta" href="/#updates">Get updates</Link>
            <ThemeToggle />
          </nav>
        </header>
        {children}
        <footer className="footer">
          <div className="wrap footer-inner">
            <div>
              <Link className="brand" href="/"><Mark /><span>Reddi Agent Protocol</span></Link>
              <p className="footer-line">Payments prove transfer; RAP Assurance proves paid work.</p>
            </div>
            <div className="footer-links">
              <Link href="/status">Status</Link>
              <Link href="/market">The numbers</Link>
              <Link href="/sandbox">Sandbox</Link>
              <Link href="/updates">Updates</Link>
              {hasVideos && <Link href="/watch">Watch</Link>}
              <a href={APP_URL} rel="noopener noreferrer">Developer app</a>
              <a href={GITHUB_URL} rel="noopener noreferrer">GitHub</a>
              <a href={X_URL} rel="noopener noreferrer">X</a>
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
            </div>
            {ANALYTICS_ENABLED && <Consent />}
            <p className="footer-note"><span>© 2026 Reddi Agent Protocol. Open source.</span><span>{STAGE}</span></p>
          </div>
        </footer>
        {ANALYTICS_ENABLED && <Analytics />}
        {/* Only Vercel builds count visits: local dev and CI would load Vercel's debug script from another host. */}
        {process.env.VERCEL === "1" && <VercelAnalytics />}
      </body>
    </html>
  );
}
