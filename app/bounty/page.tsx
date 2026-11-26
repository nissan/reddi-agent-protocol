import { Prose } from '@/components/Prose';

export default function BountyPage() {
  return (
    <div className="min-h-screen bg-page text-white">
      <div className="mx-auto max-w-6xl space-y-10 px-4 pb-16 pt-12 sm:px-6 lg:px-8">
        <header className="rounded-3xl border border-brand-green/25 bg-paper-raised p-8 md:p-10">
          <p className="section-label">Security bounty</p>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-6xl">
            Open $500 Bug Bounty & Third‑Party Audit
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-gray-300">
            We invite independent security researchers and auditors to review the Reddi Agent
            Protocol program. A $500 bounty is offered for valid, previously unreported
            vulnerabilities that meet the criteria below.
          </p>
        </header>

        <section className="prose prose-invert max-w-3xl">
          <h2>Scope</h2>
          <p>
            The bounty covers the on‑chain escrow, rating, and attestation logic of the V1
            program (see <code>programs/pinocchio-escrow</code>) as deployed on Solana devnet.
            This includes:
          </p>
          <ul>
            <li>Re‑entrancy, replay, and double‑release attacks.</li>
            <li>Unauthorized release or cancel actions.</li>
            <li>Rating, judge attestation, and dispute mechanisms.</li>
            <li>Any other security‑critical behavior documented in <code>SECURITY.md</code>.</li>
          </ul>

          <h2>Rules</h2>
          <ul>
            <li>
              Only vulnerabilities that are <strong>new</strong> and not previously disclosed
              in public forums or prior audits are eligible.
            </li>
            <li>
              The issue must be reproducible on the current devnet deployment (see
              <code>config/quasar/deployments.json</code>).
            </li>
            <li>
              Exploits that require <em>owner‑controlled</em> keys or private credentials are
              out of scope.
            </li>
            <li>
              Submissions must include a clear description, steps to reproduce, and a proof‑of‑concept
              (code or transaction) that does not compromise user funds.
            </li>
          </ul>

          <h2>Reward</h2>
          <p>
            A flat bounty of <strong>$500 USD</strong> will be paid to the first valid report for each
            qualifying vulnerability. Payments will be made in USDC to an address provided by the
            researcher.
          </p>

          <h2>Contact</h2>
          <p>
            Please submit reports via the repository’s private vulnerability reporting flow
            (GitHub → Security → Report a vulnerability). If that option is unavailable, open a
            public issue titled <code>Security contact request</code> with only a request for a
            private channel – do not include exploit details.
          </p>

          <h2>References</h2>
          <ul>
            <li>
              <a href="/SECURITY.md" target="_blank" rel="noopener noreferrer">
                SECURITY.md
              </a>
            </li>
            <li>
              <a href="/docs/QUASAR-PROGRAMS-SECURITY-AUDIT-2026-05-06.md" target="_blank" rel="noopener noreferrer">
                Quasar Security Audit (2026‑05‑06)
              </a>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
