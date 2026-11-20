import Link from 'next/link';
import {
  AS_OF, AVG_CALL_USD, CALL_PRICES, FEE_FACTS, FORECASTS, OCT_2026_X402_USD, REVENUE_TARGETS, SCENARIOS, SOURCES, TAM_USD, VOLUME_TODAY,
  FEE_BPS, priceRow, scenarioRow, volumeFor, type Figure,
} from '../../lib/market';
import { pageMetadata } from '../../lib/metadata';
import { siteUrl } from '../../lib/site';

export const metadata = pageMetadata(siteUrl, {
  path: '/market',
  title: 'The numbers',
  description: 'Why per-call AI payments work on Solana, how big agent payments are today, and what a planned 0.05% protocol fee could earn. Every figure is cited or marked as our estimate.',
});

const usd = (n: number, digits = 0) => `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const big = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : usd(n));
const pct = (n: number) => (n >= 100 ? `${Math.round(n).toLocaleString('en-US')}%` : `${n.toFixed(2)}%`);
const cents = `${Math.round(AVG_CALL_USD * 100)}¢`;
const perDay = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} billion` : `${(n / 1e6).toFixed(1)} million`);
const NAMES = { low: 'Low', base: 'Base', high: 'High' } as const;

function Facts({ items }: { items: Figure[] }) {
  return (
    <ul className="facts">
      {items.map((f) => (
        <li key={f.label}>
          <b>{f.value}</b>
          <span>{f.label}</span>
          <small>{f.asOf}{f.source && <> · <a href={f.source.url} rel="noopener noreferrer">{f.source.label} ↗</a></>}</small>
        </li>
      ))}
    </ul>
  );
}

export default function Market() {
  const rows = SCENARIOS.map(scenarioRow);
  const base = rows.find((r) => r.key === 'base')!;
  return (
    <main id="main" className="wrap page market">
      <p className="eyebrow">THE NUMBERS · AS OF {AS_OF.toUpperCase()}</p>
      <h1>Small payments, a large market, a thin fee.</h1>
      <p className="lead">Agents are starting to pay for AI one call at a time. This page shows why that works on Solana, how much gets paid today, and what a 0.05% protocol fee could earn if the market grows. Every number links to its source or is marked as our own estimate.</p>
      <p className="notice small">Nothing here runs on Solana mainnet yet, and no protocol fee is collected today. The 0.05% fee is planned for the first mainnet release, on direct per-call payments only.</p>

      <h2>1. Why a one-cent payment works on Solana</h2>
      <p>A card payment costs at least 30 cents, so nobody can sell a one-cent API call by card. On Solana the network fee is a small fraction of a cent, and since October 2026 a payment is final in about 150 milliseconds.</p>
      <Facts items={FEE_FACTS} />
      <div className="table-scroll">
        <table className="data">
          <caption>Cost of taking one payment, as a share of the price</caption>
          <thead><tr><th scope="col">Price of one call</th><th scope="col">Solana network fee</th><th scope="col">Card fee</th><th scope="col">Planned RAP fee (USDC)</th></tr></thead>
          <tbody>
            {CALL_PRICES.map(priceRow).map((r) => (
              <tr key={r.price}><td>{usd(r.price, r.price < 0.01 ? 3 : 2)}</td><td>{pct(r.networkPct)}</td><td>{pct(r.cardPct)}</td><td>{r.rapFee === 0 ? '$0 (rounds down)' : usd(r.rapFee, 6)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">Our reading: paying per call is comfortable from about one cent upward. Below that the network fee takes too big a share, and calls would need batching or payment channels. The planned fee is {FEE_BPS} basis points of the listed price, rounded down, so a USDC call under $0.002 pays none (<a href={SOURCES.feeIssue.url} rel="noopener noreferrer">fee design ↗</a>).</p>

      <h2>2. Agent payments today: many, but small</h2>
      <p>Agents have made close to 200 million payments over x402, the open HTTP payment standard. Much of that count is testing and bots. Real money is still small: about {usd(OCT_2026_X402_USD)} in October 2026, across every chain.</p>
      <Facts items={VOLUME_TODAY} />
      <p className="small muted">Sources measure different windows, chains and definitions, so their totals disagree. We quote the newest dated figure we could check and name where it came from.</p>

      <h2>3. Where it could go</h2>
      <Facts items={FORECASTS} />
      <p>Juniper names trust as the biggest barrier to agentic commerce. A receipt you can check is our answer to that.</p>

      <h2>4. Market size in 2030</h2>
      <p>The total market is the cited inference forecast. The two narrower layers are <b>our own estimates</b>, shown as low, base and high.</p>
      <div className="table-scroll">
        <table className="data">
          <caption>TAM, SAM and SOM in 2030</caption>
          <thead><tr><th scope="col">Layer</th><th scope="col">What it counts</th>{rows.map((r) => <th scope="col" key={r.key}>{NAMES[r.key]}</th>)}</tr></thead>
          <tbody>
            <tr><th scope="row">TAM</th><td>Global AI inference spend (<a href={SOURCES.mnm.url} rel="noopener noreferrer">MarketsandMarkets ↗</a>)</td>{rows.map((r) => <td key={r.key}>{big(TAM_USD)}</td>)}</tr>
            <tr><th scope="row">SAM <span className="tag">estimate</span></th><td>Inference bought per call by software agents over open on-chain payments</td>{rows.map((r) => <td key={r.key}>{big(r.sam)}<small>{(r.samShare * 100).toFixed(1)}% of TAM</small></td>)}</tr>
            <tr><th scope="row">SOM <span className="tag">estimate</span></th><td>Of that, paid directly with a RAP receipt</td>{rows.map((r) => <td key={r.key}>{big(r.som)}<small>{(r.somShare * 100).toFixed(0)}% of SAM</small></td>)}</tr>
          </tbody>
        </table>
      </div>

      <h2>5. What a 0.05% fee could earn</h2>
      <p>Protocol revenue is simple: payment volume with a RAP receipt, times 0.05%. In our base case that comes to about {usd(base.revenue2027)} in 2027 and about {usd(Math.round(base.revenue2030 / 100) * 100)} in 2030. All volumes below are <b>our estimates</b>.</p>
      <div className="table-scroll">
        <table className="data">
          <caption>Planned protocol fee revenue by scenario (our estimates)</caption>
          <thead><tr><th scope="col">Scenario</th><th scope="col">2027 volume</th><th scope="col">2027 fee revenue</th><th scope="col">2030 volume</th><th scope="col">2030 fee revenue</th><th scope="col">2030 calls at {cents}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}><th scope="row">{NAMES[r.key]}</th><td>{big(r.volume2027)}</td><td>{usd(r.revenue2027)}</td><td>{big(r.som)}</td><td>{usd(Math.round(r.revenue2030 / 100) * 100)}</td><td>{(r.calls2030 / 1e9).toFixed(2)} billion</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-scroll">
        <table className="data narrow">
          <caption>Volume needed for each level of yearly revenue</caption>
          <thead><tr><th scope="col">Yearly protocol revenue</th><th scope="col">Yearly volume needed</th><th scope="col">Calls a day at {cents}</th></tr></thead>
          <tbody>
            {REVENUE_TARGETS.map((t) => <tr key={t}><td>{big(t)}</td><td>{big(volumeFor(t))}</td><td>{perDay(volumeFor(t) / AVG_CALL_USD / 365)}</td></tr>)}
          </tbody>
        </table>
      </div>
      <p>A reality check: if every x402 payment in October 2026 had carried the fee, it would have come to about {usd((OCT_2026_X402_USD * FEE_BPS) / 10_000)} for the month. The fee is thin on purpose. It only adds up if agent payments grow by orders of magnitude, and that growth is the bet.</p>

      <h2>How we built this</h2>
      <ul className="plain">
        <li>The fee applies only to direct per-call payments. Escrow jobs carry no fee in the first release, so they add nothing here.</li>
        <li>Volume is in US dollars at the listed price. 2027 and 2030 are point estimates, and we fit no growth curve between them.</li>
        <li>We assume an average call of {cents}, close to the Q3 2026 agent average.</li>
        <li>Forecasts we could not check against the publisher&apos;s own page are left out.</li>
      </ul>
      <p><Link className="text-link" href="/status">What exists today ↗</Link> <Link className="text-link" href="/#updates">Get the build updates ↗</Link></p>
    </main>
  );
}
