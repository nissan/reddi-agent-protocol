import Link from 'next/link';
import Scenarios from '../../components/Scenarios';
import { pageMetadata } from '../../lib/metadata';
import { sandboxUrl } from '../../lib/sandbox';
import { siteUrl } from '../../lib/site';

export const metadata = pageMetadata(siteUrl, { path: '/sandbox', title: 'Devnet sandbox', description: 'Three short scenarios for trying receipted inference on Solana devnet with test funds only.' });

export default function Sandbox() {
  return (
    <main id="main" className="wrap page">
      <p className="eyebrow">DEVNET SANDBOX</p>
      <h1>Try receipted inference with test funds.</h1>
      <p className="lead">The sandbox runs on Solana devnet. Devnet tokens have no value, so nothing you do there can cost you money. {sandboxUrl ? 'Pick a scenario and open it.' : 'It is being built now and is not open yet.'}</p>
      <Scenarios />
      {sandboxUrl
        ? <p className="section-cta"><a className="button primary" href={sandboxUrl} rel="noopener noreferrer">Open the sandbox ↗</a></p>
        : <div className="notice"><h2>Opens soon</h2><p>We will email the list the day it opens. Until then, the developer demo in the repository shows the same flow in a rougher form.</p><p><Link className="button" href="/#updates">Tell me when it opens</Link></p></div>}
      <h2>What you will need</h2>
      <ul className="plain">
        <li>A Solana wallet set to devnet. No real funds.</li>
        <li>A few minutes per scenario.</li>
        <li>Nothing else: the sandbox supplies test tokens and a test provider.</li>
      </ul>
    </main>
  );
}
