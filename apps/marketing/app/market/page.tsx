import Link from 'next/link';
import {
  AS_OF, AVG_CALL_USD, CALL_PRICES, FEE_FACTS, FORECASTS, OCT_2026_X402_USD, REVENUE_TARGETS, SCENARIOS, SOURCES, TAM_USD, VOLUME_TODAY,
  BUILD_HISTORY, FEE_BPS, REVENUE_LINES, SOL_FEE_CAP, RFS, RFS_MAP, priceRow, scenarioRow, stackRow, volumeFor, type Figure,
} from '../../lib/market';
import { pageMetadata } from '../../lib/metadata';
import { siteUrl } from '../../lib/site';

export const metadata = pageMetadata(siteUrl, {
  path: '/market',
  title: 'The numbers',
  description: 'Solana asked for an open marketplace for AI inference. The market case for the verify layer we started building first: per-call payments, agent payment volumes, market size and planned protocol revenue. Every figure is cited or marked as our estimate.',
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
  const stack = SCENARIOS.map(stackRow);
  const baseStack = stack.find((r) => r.key === 'base')!;
  return (
    <main id="main" className="wrap page market">
      <p className="eyebrow">THE NUMBERS · AS OF {AS_OF.toUpperCase()}</p>
      <h1>Solana asked for an open inference market. <span>We were already building it.</span></h1>
      <p className="lead">On {RFS.published} the Solana Foundation published its Request for Startups. One of its eleven ideas is an open marketplace for AI inference. This page is the market case for the part we build, the verify layer, and what it could earn. Every number links to its source or is marked as our own estimate.</p>
      <p className="notice small">Nothing here runs on Solana mainnet yet, and no protocol fee is collected today. The 2.5% fee is planned for the first mainnet release. Every other revenue line on this page is a roadmap item.</p>

      <h2>The prediction</h2>
      <blockquote className="rfs-quote">
        <p>&ldquo;{RFS.thesis}&rdquo;</p>
        <p className="small">&ldquo;{RFS.whyNow}&rdquo;</p>
        <cite>{RFS.author} · <a href={RFS.url} rel="noopener noreferrer">{RFS.title}, Solana Request for Startups ↗</a></cite>
      </blockquote>
      <p>Each word in that brief maps to something we have been building in public since March 2026.</p>
      <ul className="rfs-map">
        {RFS_MAP.map((m) => <li key={m.rfs}><b>&ldquo;{m.rfs}&rdquo;</b><span>{m.ours}</span></li>)}
      </ul>
      <Facts items={BUILD_HISTORY} />
      <p className="small muted">The RFS publication date is from <a href={RFS.publishedSource.url} rel="noopener noreferrer">{RFS.publishedSource.label} ↗</a>. Reddi Agent Protocol is an independent project. It is not affiliated with or endorsed by the Solana Foundation.</p>

      <h2>1. Why a one-cent payment works on Solana</h2>
      <p>A card payment costs at least 30 cents, so nobody can sell a one-cent API call by card. On Solana the network fee is a small fraction of a cent, and since October 2026 a payment is final in about 150 milliseconds.</p>
      <Facts items={FEE_FACTS} />
      <div className="table-scroll">
        <table className="data">
          <caption>Cost of taking one payment, as a share of the price</caption>
          <thead><tr><th scope="col">Price of one call</th><th scope="col">Solana network fee</th><th scope="col">Card fee</th><th scope="col">Planned RAP fee at 2.5% (USDC)</th></tr></thead>
          <tbody>
            {CALL_PRICES.map(priceRow).map((r) => (
              <tr key={r.price}><td>{usd(r.price, r.price < 0.01 ? 3 : 2)}</td><td>{pct(r.networkPct)}</td><td>{pct(r.cardPct)}</td><td>{r.rapFee === 0 ? '$0 (rounds down)' : usd(r.rapFee, 6)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">Our reading: paying per call is comfortable from about one cent upward. Below that the network fee takes too big a share, and calls would need batching or payment channels. The planned fee is {FEE_BPS / 100}% of what a call actually cost, rounded down, so a USDC call under $0.00004 pays none. On SOL payments it never goes above {SOL_FEE_CAP} SOL (<a href={SOURCES.feeIssue.url} rel="noopener noreferrer">fee design ↗</a>).</p>

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

      <h2>5. The base fee alone: 2.5%</h2>
      <p>Providers price their models the way AI APIs already do: per million input and output tokens. Before a call the buyer sees an estimated cost and approves a maximum, which is locked on-chain. After the response, the real token count sets the true cost. The provider is paid that, less the 2.5% fee, and the rest of the maximum goes back to the buyer.</p>
      <p>Protocol revenue is simple: payment volume with a RAP receipt, times 2.5%. In our base case that comes to about {usd(base.revenue2027)} in 2027 and about {usd(Math.round(base.revenue2030 / 100) * 100)} in 2030. All volumes below are <b>our estimates</b>.</p>
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
      <p>A reality check: if every x402 payment in October 2026 had carried the fee, it would have come to about {usd((OCT_2026_X402_USD * FEE_BPS) / 10_000)} for the month. For comparison, OpenRouter charges 5.5% on card top-ups and 5% in crypto (<a href={SOURCES.openRouterFee.url} rel="noopener noreferrer">{SOURCES.openRouterFee.label} ↗</a>). The roadmap below adds to the settlement fee.</p>

      <h2>6. Revenue roadmap</h2>
      <p>The RFS asks for more than payment. It asks for verification, reputation and payment channels. Each of those is a service agents will pay for, and each can be priced without us ever holding anyone&apos;s funds. Fees are split inside the buyer&apos;s own payment, or held by an on-chain program under fixed rules. The treasury only receives.</p>
      <div className="table-scroll">
        <table className="data roadmap">
          <caption>Protocol revenue lines (fees are our proposals)</caption>
          <thead><tr><th scope="col">Revenue line</th><th scope="col">RFS ask</th><th scope="col">Stage</th><th scope="col">Who pays, proposed fee</th><th scope="col">How funds stay out of our hands</th><th scope="col">Market reference</th></tr></thead>
          <tbody>
            {REVENUE_LINES.map((l) => (
              <tr key={l.key}><th scope="row">{l.name}</th><td>&ldquo;{l.rfs}&rdquo;</td><td><span className={`stage stage-${l.stage === 'Exploring' ? 'exploring' : l.stage === 'Planned' ? 'planned' : 'v1'}`}>{l.stage}</span></td><td>{l.payer}<small>{l.fee}</small></td><td>{l.nonCustodial}</td><td>{l.benchmark.text} (<a href={l.benchmark.source.url} rel="noopener noreferrer">{l.benchmark.source.label} ↗</a>)</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>7. What the full stack could earn in 2030</h2>
      <p>Same market estimates as above, with every revenue line added. In our base case the protocol earns about {big(baseStack.total)} a year, an effective {baseStack.effectiveBps.toFixed(0)} basis points of volume, against {usd(Math.round(base.revenue2030 / 100) * 100)} from the settlement fee alone. All figures are <b>our estimates</b>.</p>
      <div className="table-scroll">
        <table className="data">
          <caption>2030 protocol revenue by line (our estimates)</caption>
          <thead><tr><th scope="col">Revenue line</th>{stack.map((r) => <th scope="col" key={r.key}>{NAMES[r.key]}</th>)}</tr></thead>
          <tbody>
            {REVENUE_LINES.map((l) => <tr key={l.key}><th scope="row">{l.name}</th>{stack.map((r) => <td key={r.key}>{big(r.lines.find((x) => x.key === l.key)!.revenue)}</td>)}</tr>)}
            <tr className="total"><th scope="row">Total</th>{stack.map((r) => <td key={r.key}>{big(r.total)}<small>{r.effectiveBps.toFixed(0)} bps of volume</small></td>)}</tr>
          </tbody>
        </table>
      </div>
      <p className="small muted">Base assumptions: a quarter of volume buys a verified receipt, 15% is spot-checked, disputes come from escrow volume half the size of per-call volume, one reputation lookup per two paid calls, 2,000 listed providers and 5% of calls private. Low and high scale each of these down or up.</p>
      <p>The bigger lever is scope. A receipt works for any paid agent API or tool call, not only inference. Juniper forecasts $1.5T of agentic commerce in 2030. We have not counted any of it here.</p>

      <h2>How we built this</h2>
      <ul className="plain">
        <li>In the first mainnet release the fee applies to every paid call and every escrow job, on the actual cost. It comes out of the provider&apos;s share, so the buyer never pays more than the cost.</li>
        <li>Volume is in US dollars at the actual cost of each call. 2027 and 2030 are point estimates, and we fit no growth curve between them.</li>
        <li>We assume an average call of {cents}, close to the Q3 2026 agent average.</li>
        <li>Forecasts we could not check against the publisher&apos;s own page are left out.</li>
      </ul>
      <p><Link className="text-link" href="/status">What exists today ↗</Link> <Link className="text-link" href="/#updates">Get the build updates ↗</Link></p>
    </main>
  );
}
