import Link from 'next/link';
import StatusLedger from '../../components/StatusLedger';
import { GITHUB_URL, STAGE } from '../../lib/copy';
import { pageMetadata } from '../../lib/metadata';
import { siteUrl } from '../../lib/site';

export const metadata = pageMetadata(siteUrl, { path: '/status', title: 'Status', description: 'What exists today in Reddi Agent Protocol, what is being built and what is only planned, with a link to check each line.' });

export default function Status() {
  return (
    <main id="main" className="wrap page">
      <p className="eyebrow">STATUS</p>
      <h1>What exists, what is being built, what is planned.</h1>
      <p className="lead">{STAGE} Each line below links to the place you can check it. If a line here and the repository ever disagree, the repository is right and this page is the bug.</p>
      <StatusLedger detail />
      <h2>What we do not claim</h2>
      <ul className="plain">
        <li>No part of this runs on Solana mainnet yet.</li>
        <li>No outside security audit has been completed. A scoped review is in progress.</li>
        <li>A receipt is a provider&apos;s signed statement plus evidence you can check. It is not a proof of which model executed.</li>
        <li>Reddi Agent Protocol is not a custodian and it is not a marketplace. A buyer&apos;s maximum is held by an on-chain program until the provider settles, not by a Reddi account or server.</li>
        <li>No protocol fee is collected today.</li>
      </ul>
      <p><a className="text-link" href={GITHUB_URL} rel="noopener noreferrer">Read the code on GitHub ↗</a> <Link className="text-link" href="/#updates">Get the build updates ↗</Link></p>
    </main>
  );
}
