import type { Metadata } from 'next';
import Link from 'next/link';
import { indexable, siteUrl } from '../lib/site';
import { APP_URL, DEFAULT_DESCRIPTION, GITHUB_URL, SITE_NAME, STAGE, X_URL } from '../lib/copy';
import './globals.css';

export const metadata: Metadata = {
  title: { default: `${SITE_NAME}: receipted AI inference on Solana`, template: `%s · ${SITE_NAME}` },
  description: DEFAULT_DESCRIPTION,
  metadataBase: new URL(siteUrl),
  icons: { icon: [{ url: '/brand/icon.png', type: 'image/png' }], apple: [{ url: '/brand/apple-icon.png', sizes: '180x180' }] },
  // noindex unless the launch switch is on (resolveIndexable in lib/site.ts).
  robots: indexable ? { index: true, follow: true } : { index: false, follow: false },
};

function Mark() { return <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>; }

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#main">Skip to content</a>
        <p className="stage-strip"><span className="dot" aria-hidden="true" /> {STAGE}</p>
        <header className="header wrap">
          <Link className="brand" href="/" aria-label={`${SITE_NAME} home`}><Mark /><span>Reddi Agent Protocol</span></Link>
          <nav aria-label="Main navigation">
            <Link href="/#how">How it works</Link>
            <Link href="/sandbox">Sandbox</Link>
            <Link href="/status">Status</Link>
            <Link href="/updates">Updates</Link>
            <Link className="nav-cta" href="/#updates">Get updates</Link>
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
              <Link href="/sandbox">Sandbox</Link>
              <Link href="/updates">Updates</Link>
              <a href={APP_URL} rel="noopener noreferrer">Developer app</a>
              <a href={GITHUB_URL} rel="noopener noreferrer">GitHub</a>
              <a href={X_URL} rel="noopener noreferrer">X</a>
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
            </div>
            <p className="footer-note"><span>© 2026 Reddi Agent Protocol. Open source.</span><span>{STAGE}</span></p>
          </div>
        </footer>
      </body>
    </html>
  );
}
