import Link from 'next/link';
import { redirect } from 'next/navigation';
import Scenarios from '../../components/Scenarios';
import { pageMetadata } from '../../lib/metadata';
import { SCENARIOS } from '../../lib/copy';
import { sandboxUrl, scenarioUrl } from '../../lib/sandbox';
import { siteUrl } from '../../lib/site';

export const metadata = pageMetadata(siteUrl, { path: '/sandbox', title: 'Devnet sandbox', description: 'Four short scenarios for trying receipted inference on Solana devnet with test funds only.' });

// The sandbox used to live at this address. A deep link to one scenario (?scenario=<id>) is sent on to the sandbox itself, so
// links shared before the site took this domain still open the scenario. Unknown ids just show this page.
export default async function Sandbox({ searchParams }: { searchParams: Promise<{ scenario?: string | string[] }> }) {
  const { scenario } = await searchParams;
  const target = typeof scenario === 'string' && SCENARIOS.some((s) => s.id === scenario) ? scenarioUrl(sandboxUrl, scenario) : null;
  if (target) redirect(target);
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
        <li>A browser. The default payment is simulated, so no wallet is needed.</li>
        <li>Optionally, a Solana wallet set to devnet if you want to pay with test SOL. No real funds.</li>
        <li>A few minutes per scenario.</li>
      </ul>
      <p>The sandbox providers answer from a script, not from a running model, and every receipt says so.</p>
    </main>
  );
}
