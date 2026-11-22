import { CONTACT_EMAIL, POLICY } from '../../lib/policy';
import { GITHUB_URL } from '../../lib/copy';
import { pageMetadata } from '../../lib/metadata';
import { siteUrl } from '../../lib/site';
import { ANALYTICS_ENABLED, ANALYTICS_REGION } from '../../lib/analytics/enabled';

export const metadata = pageMetadata(siteUrl, { path: '/privacy', title: 'Privacy', description: 'What this website collects, why, and how to have it removed.' });

export default function Privacy() {
  return (
    <main id="main" className="wrap page prose">
      <p className="eyebrow">PRIVACY · VERSION {POLICY.version.toUpperCase()} · {POLICY.date.toUpperCase()}</p>
      <h1>Privacy</h1>
      <p className="lead">This website collects as little as it can. Reading it never needs an account, a wallet or a subscription.</p>
      <h2>If you sign up for updates</h2>
      <p>We store the email address you enter and the times you asked, confirmed or unsubscribed. We use it only to confirm your request, to tell you when the sandbox and the guarded beta open, and to send the build updates. We do not sell it or share it for advertising.</p>
      <p>Signup is confirmed opt-in: nothing is kept for good until you press the button in the confirmation email. An address that is never confirmed is deleted after {POLICY.pendingDays} days. Every message has a one-click unsubscribe link, which takes effect immediately.</p>
      <p>Two service providers handle this data for us: Resend sends the emails, and Vercel hosts the site and stores the list.</p>
      <h2>Posts from X</h2>
      <p>The home page can show posts from our X account. Nothing is loaded from X until you press the button that shows them. When you do, X receives your address and may set cookies under its own policy.</p>
      <h2>Videos from YouTube</h2>
      <p>The Watch page shows our videos, which are hosted on YouTube. Nothing is loaded from YouTube until you press play. When you do, the video plays from YouTube&apos;s privacy-enhanced player, YouTube receives your address and it may set cookies under its own policy.</p>
      <h2>Analytics and cookies</h2>
      {ANALYTICS_ENABLED
        ? <>
          <p>Measurement is optional and off until you choose. The first time you visit, the site asks, and nothing is loaded, sent or stored for measurement before you answer. Your answer is saved in this browser only.</p>
          <p>If you allow it, we use PostHog{ANALYTICS_REGION ? ` (${ANALYTICS_REGION})` : ''} to count page views, clicks on links to other sites, sign-up steps and which build updates are opened, and to see which of our own campaign links brought you here. It uses a random anonymous ID kept in this browser. It never receives your email address or a wallet address, it does not record your screen, and it sets no advertising trackers.</p>
          <p>You can change your mind at any time with Privacy settings at the foot of every page. Withdrawing stops collection at once and removes PostHog&apos;s identifiers from this browser.</p>
        </>
        : <p>This site sets no cookies of its own and runs no analytics or advertising trackers.</p>}
      <p>Our hosting provider keeps ordinary request logs for security and reliability.</p>
      <h2>Your choices</h2>
      <p>You can unsubscribe with the link in any message. To have your address deleted, or to ask what we hold, {CONTACT_EMAIL ? <>write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</> : <>open an issue on <a href={GITHUB_URL} rel="noopener noreferrer">the public repository</a> without including your address, and we will arrange a private channel.</>}</p>
    </main>
  );
}
