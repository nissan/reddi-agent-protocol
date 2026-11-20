import { POLICY } from '../../lib/policy';
import { GITHUB_URL } from '../../lib/copy';
import { pageMetadata } from '../../lib/metadata';
import { siteUrl } from '../../lib/site';

export const metadata = pageMetadata(siteUrl, { path: '/terms', title: 'Terms', description: 'Plain terms for using this website.' });

export default function Terms() {
  return (
    <main id="main" className="wrap page prose">
      <p className="eyebrow">TERMS · VERSION {POLICY.version.toUpperCase()} · {POLICY.date.toUpperCase()}</p>
      <h1>Terms</h1>
      <p className="lead">This website describes software that is still being built. It is information, not an offer.</p>
      <h2>No financial or investment advice</h2>
      <p>Nothing here is financial, investment or legal advice, and nothing here offers a token or an investment.</p>
      <h2>Software in development</h2>
      <p>The software is open source under the licence in <a href={GITHUB_URL} rel="noopener noreferrer">the repository</a> and is provided as is, without warranty. The devnet sandbox and demos use test funds with no value. Do not send real funds to any address shown in a demo.</p>
      <h2>Plans can change</h2>
      <p>Anything described as being built or planned may change or not ship. The status page says what exists today.</p>
      <h2>Other sites</h2>
      <p>Links to GitHub, X and Solana lead to services with their own terms. Reddi Agent Protocol is an independent project and is not affiliated with or endorsed by the Solana Foundation.</p>
    </main>
  );
}
