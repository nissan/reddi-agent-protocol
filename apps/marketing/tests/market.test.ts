// /market shows investor-style figures. Each must be cited (https source + the date it covers) or marked as our
// estimate, and the derived numbers must follow from the inputs, so a changed input cannot leave stale copy behind.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { BLENDED_2027_BPS, FOUNDING, LAUNCH_FEE_BPS, BUILD_HISTORY, FEE_FACTS, FORECASTS, JOB_COSTS, MID_TIER, jobCost, REVENUE_LINES, RFS, RFS_MAP, SCENARIOS, SOURCES, VOLUME_TODAY, feeFor, priceRow, scenarioRow, stackRow, volumeFor } from '../lib/market.ts';

test('every shown figure has a dated https source or is marked as our estimate', () => {
  for (const f of [...FEE_FACTS, ...VOLUME_TODAY, ...FORECASTS, ...BUILD_HISTORY]) {
    assert.ok(f.asOf.trim(), f.label);
    assert.ok(f.estimate || (f.source && /^https:\/\//.test(f.source.url)), f.label);
  }
  for (const s of Object.values(SOURCES)) assert.match(s.url, /^https:\/\//, s.label);
});

test('the planned fee is 5% standard and 2.5% at launch, of the actual cost, rounded down, with no minimum', () => {
  assert.equal(feeFor(1_000_000), 50_000); // 1 USDC -> 0.05 USDC (programs/pinocchio-escrow consts.rs)
  assert.equal(feeFor(19), 0); // under 0.00002 USDC pays no fee
  assert.equal(feeFor(20), 1);
  assert.equal(feeFor(1_000_000, LAUNCH_FEE_BPS), 25_000);
  assert.equal(feeFor(39, LAUNCH_FEE_BPS), 0);
  assert.equal(priceRow(0.001).rapFee, 0.00005);
  assert.equal(priceRow(0.001).launchFee, 0.000025);
  assert.equal(priceRow(1).rapFee, 0.05);
  assert.equal(FOUNDING.effectiveBps, 150);
});

test('card and network shares are computed, not typed', () => {
  assert.equal(Math.round(priceRow(0.01).cardPct), 3003);
  assert.equal(priceRow(1).networkPct.toFixed(4), '0.0365');
});

test('scenario revenue is volume times the fee, net of founding rebates in 2027, and the scenarios are ordered', () => {
  const rows = SCENARIOS.map(scenarioRow);
  assert.equal(BLENDED_2027_BPS, 437.5);
  for (const r of rows) {
    assert.ok(Math.abs(r.revenue2030 - r.som * 0.05) < 1e-3);
    assert.ok(Math.abs(r.revenue2027 - r.volume2027 * 0.04375) < 1e-6);
    assert.ok(Math.abs(r.rebate2027 - r.volume2027 * 0.4 * 0.02875) < 1e-6);
    assert.ok(r.net2027 > 0 && r.net2027 < r.revenue2027);
  }
  assert.ok(rows[0].som < rows[1].som && rows[1].som < rows[2].som);
  assert.equal(Math.round(rows[1].revenue2030), 12749000);
  assert.equal(Math.round(rows[1].net2027), 322500);
  assert.equal(volumeFor(1_000_000), 20_000_000);
});

test('the page labels SAM, SOM and scenario volumes as estimates and says no fee is collected today', () => {
  const page = readFileSync(join(import.meta.dirname, '..', 'app', 'market', 'page.tsx'), 'utf8');
  assert.match(page, /none is collected today/i);
  assert.match(page, /runs on Solana devnet today, and mainnet is coming soon/i);
  // SAM, SOM, and the job-cost rows that are not measured.
  assert.equal((page.match(/className="tag">estimate</g) ?? []).length, 3);
  assert.match(page, /our estimates<\/b>/);
});

test('the page is anchored on the Solana RFS item, quoted and linked', () => {
  const page = readFileSync(join(import.meta.dirname, '..', 'app', 'market', 'page.tsx'), 'utf8');
  assert.equal(RFS.url, 'https://solana.com/request-for-startups#ai-inference-marketplace');
  assert.match(page, /RFS\.thesis/);
  assert.match(page, /not affiliated with or endorsed by the Solana Foundation/);
  for (const m of RFS_MAP) assert.ok(RFS.thesis.includes(m.rfs) || RFS.whyNow.includes(m.rfs) || m.rfs === 'reputation', m.rfs);
});

test('every revenue line ties to an RFS ask, says how funds stay out of our hands, cites a reference and names no date', () => {
  const asks = new Set(RFS_MAP.map((m) => m.rfs));
  assert.equal(REVENUE_LINES.filter((l) => l.stage === 'First mainnet release').map((l) => l.key).join(), 'settle');
  for (const l of REVENUE_LINES) {
    assert.ok(asks.has(l.rfs), l.key);
    assert.ok(l.nonCustodial.length > 20, l.key);
    assert.match(l.benchmark.source.url, /^https:\/\//, l.key);
    if (l.stage !== 'First mainnet release') assert.doesNotMatch(`${l.name} ${l.fee} ${l.payer}`, /\b(20\d\d|Q[1-4])\b/, l.key);
  }
});

test('the revenue stack adds up and its settlement line matches the base-fee model', () => {
  for (const s of SCENARIOS) {
    const st = stackRow(s);
    assert.ok(Math.abs(st.total - st.lines.reduce((t, l) => t + l.revenue, 0)) < 1e-6);
    assert.ok(Math.abs(st.lines.find((l) => l.key === 'settle')!.revenue - scenarioRow(s).revenue2030) < 1e-6);
  }
  assert.equal(Math.round(stackRow(SCENARIOS[1]).total / 1000), 13898); // judge fee at 10% of an attested job (task research, 21 Nov 2026)
});

test('job costs are tokens times the cited mid-tier price, and only sourced rows claim to be measured', () => {
  assert.match(MID_TIER.source.url, /^https:\/\//);
  for (const j of JOB_COSTS) {
    if (j.measured) assert.ok(j.source && /^https:\/\//.test(j.source.url), j.task);
    if (!j.cachedShare) assert.ok(Math.abs(jobCost(j) - (j.inputTokens * 2 + j.outputTokens * 10) / 1e6) < 1e-12, j.task);
  }
  const review = JOB_COSTS.find((j) => j.task.startsWith('Review a pull request'))!;
  assert.equal(jobCost(review).toFixed(3), '0.039');
  const agent = JOB_COSTS.find((j) => j.measured)!;
  assert.equal(jobCost(agent).toFixed(3), '0.084'); // 93.6% cache reads at 0.05x, 4% cache writes at 1.25x
});
