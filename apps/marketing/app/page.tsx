import Link from 'next/link';
import Receipt from '../components/Receipt';
import Scenarios from '../components/Scenarios';
import Signup from '../components/Signup';
import StatusLedger from '../components/StatusLedger';
import XFeed from '../components/XFeed';
import { APP_URL, DEV_LINKS, FAQ, GITHUB_URL, LAUNCH_OFFER, LAYERS, RFS_URL, STAGE, STEPS, WHY_SOLANA } from '../lib/copy';
import { SIGNUP_COPY } from '../lib/newsletter/copy';
import { pageMetadata } from '../lib/metadata';
import { sandboxUrl } from '../lib/sandbox';
import { siteUrl } from '../lib/site';

export const metadata = pageMetadata(siteUrl, { path: '/' });

export default function Home() {
  return (
    <main id="main">
      <section className="hero wrap">
        <div className="hero-copy">
          <p className="eyebrow">THE VERIFY LAYER FOR OPEN AI INFERENCE ON SOLANA</p>
          <h1>You paid for inference.<br /><span>Get the receipt.</span></h1>
          <p className="hero-description">One OpenAI-style request. One payment over x402, priced per token. One signed receipt that names the provider, the model it says it ran, the tokens used and the payment that covered it.</p>
          <div className="hero-actions">
            <a className="button primary" href="#updates">Tell me when it opens</a>
            <Link className="text-link" href="/sandbox">See the devnet sandbox ↗</Link>
            <Link className="text-link" href="/watch">Watch the 30-second trailer ↗</Link>
          </div>
          <p className="small muted">{STAGE}</p>
        </div>
        <Receipt />
      </section>

      <section className="band">
        <div className="wrap rfs">
          <div>
            <p className="eyebrow">01 / WHY NOW</p>
            <h2>Solana asked for this.</h2>
            <p>Solana&apos;s Request for Startups calls for an open marketplace for AI inference. Its one-line brief:</p>
            <blockquote>
              <p>&ldquo;Let developers choose, verify, and pay inference providers through one interface.&rdquo;</p>
              <cite>Jacob Creech, VP Technology, Solana Foundation · <a href={RFS_URL} rel="noopener noreferrer">Request for Startups ↗</a></cite>
            </blockquote>
            <p>Choosing and paying already have good open tools. Verifying is the missing piece: when a provider says which model answered, what can you hold them to? We have been building that piece in the open, and its first release is close.</p>
            <p><Link className="text-link" href="/market">The market case and the numbers ↗</Link></p>
            <p className="small">Reddi Agent Protocol is an independent project. It is not affiliated with or endorsed by the Solana Foundation.</p>
          </div>
          <ol className="layers">
            {LAYERS.map((l) => (
              <li key={l.key} className={l.ours ? 'ours' : ''}>
                <span className="layer-title">{l.title}</span>
                <span className="layer-who">{l.who}{l.ours && <b> ← us</b>}</span>
                <p>{l.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="why-solana" className="section wrap">
        <div className="section-heading"><div><p className="eyebrow">{WHY_SOLANA.eyebrow}</p><h2>{WHY_SOLANA.headline}</h2></div><p>{WHY_SOLANA.lede}</p></div>
        <ul className="facts">
          {WHY_SOLANA.points.map((p) => <li key={p.value}><b>{p.value}</b><span>{p.label}</span></li>)}
        </ul>
        <p className="why-close">{WHY_SOLANA.close} <Link className="text-link" href="/market">The fee numbers ↗</Link></p>
      </section>

      <section id="how" className="section wrap">
        <div className="section-heading"><div><p className="eyebrow">03 / HOW IT WORKS</p><h2>Four steps.<br />One of them is new.</h2></div><p>If you have called a chat completions endpoint, you already know the first step. The receipt is the part nobody hands you today.</p></div>
        <ol className="steps">{STEPS.map((s) => <li key={s.n}><span>{s.n}</span><h3>{s.title}</h3><p>{s.body}</p></li>)}</ol>
      </section>

      <section id="sandbox" className="section wrap">
        <div className="section-heading"><div><p className="eyebrow">04 / TRY IT ON DEVNET</p><h2>A sandbox with nothing to lose.</h2></div><p>Four short scenarios on Solana devnet, with test funds only. {sandboxUrl ? 'Open the sandbox and pick one.' : 'The sandbox is being built. Sign up and we will tell you the day it opens.'}</p></div>
        <Scenarios />
        <p className="section-cta">{sandboxUrl ? <a className="button primary" href={sandboxUrl} rel="noopener noreferrer">Open the sandbox ↗</a> : <a className="button" href="#updates">Tell me when the sandbox opens</a>} <Link className="text-link" href="/sandbox">About the sandbox ↗</Link></p>
      </section>

      <section id="providers" className="section wrap">
        <div className="section-heading"><div><p className="eyebrow">{LAUNCH_OFFER.eyebrow}</p><h2>{LAUNCH_OFFER.headline}</h2></div><p>{LAUNCH_OFFER.lede}</p></div>
        <ul className="offer">{LAUNCH_OFFER.cards.map((c) => <li key={c.title}><b>{c.figure}</b><h3>{c.title}</h3><p>{c.body}</p></li>)}</ul>
        <p className="small">{LAUNCH_OFFER.judgeFree}</p>
        <p className="small muted">{LAUNCH_OFFER.note}</p>
        <p className="section-cta"><a className="button primary" href="#updates">{LAUNCH_OFFER.cta}</a> <Link className="text-link" href="/market">The numbers behind it ↗</Link></p>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="section-heading"><div><p className="eyebrow">06 / WHERE WE ARE</p><h2>Checked, in progress, planned.</h2></div><p>We say plainly which is which. Everything in the first column is in the public repository for you to read and run.</p></div>
          <StatusLedger />
          <p className="section-cta"><Link className="text-link" href="/status">Full status, with links to the evidence ↗</Link> <a className="text-link" href={GITHUB_URL} rel="noopener noreferrer">Read the code on GitHub ↗</a></p>
        </div>
      </section>

      <section id="developers" className="section wrap">
        <div className="section-heading"><div><p className="eyebrow">07 / FOR DEVELOPERS</p><h2>Already building? Go deeper.</h2></div><p>The developer app has the guides, the sandbox and the reference material. It runs on devnet and opens in its own site.</p></div>
        <div className="devlinks">{DEV_LINKS.map((d) => <a key={d.path} href={`${APP_URL}${d.path}`} rel="noopener noreferrer"><h3>{d.title} <span aria-hidden="true">↗</span></h3><p>{d.body}</p></a>)}</div>
      </section>

      <section className="section wrap feed-section">
        <div><p className="eyebrow">08 / FOLLOW THE BUILD</p><h2>Built in public.</h2><p>We post what shipped, what broke and what is next. Short demos and walkthrough videos will land here first.</p></div>
        <XFeed />
      </section>

      <section id="updates" className="signup-section wrap">
        <div><p className="eyebrow">{SIGNUP_COPY.eyebrow}</p><h2>{SIGNUP_COPY.headline}</h2><p>{SIGNUP_COPY.lede}</p>{process.env.NEXT_PUBLIC_NEWSLETTER_FORM !== '1' && <p className="small">{SIGNUP_COPY.closedHomeNote}</p>}</div>
        <Signup />
      </section>

      <section className="wrap faq">
        <p className="eyebrow">A FEW THINGS TO KNOW</p>
        {FAQ.map((f) => <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>)}
      </section>
    </main>
  );
}
