// /market shows investor-style figures. Each must be cited (https source + the date it covers) or marked as our
// estimate, and the derived numbers must follow from the inputs, so a changed input cannot leave stale copy behind.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { FEE_FACTS, FORECASTS, SCENARIOS, SOURCES, VOLUME_TODAY, feeFor, priceRow, scenarioRow, volumeFor } from '../lib/market.ts';

test('every shown figure has a dated https source or is marked as our estimate', () => {
  for (const f of [...FEE_FACTS, ...VOLUME_TODAY, ...FORECASTS]) {
    assert.ok(f.asOf.trim(), f.label);
    assert.ok(f.estimate || (f.source && /^https:\/\//.test(f.source.url)), f.label);
  }
  for (const s of Object.values(SOURCES)) assert.match(s.url, /^https:\/\//, s.label);
});

test('the planned fee is 5 bps of the listed price, rounded down, with no minimum', () => {
  assert.equal(feeFor(1_000_000), 500); // 1 USDC -> 0.0005 USDC (issue #744, RAP-FEE-S1)
  assert.equal(feeFor(1_000), 0); // 0.001 USDC pays no fee (RAP-FEE-S5)
  assert.equal(feeFor(1_999), 0);
  assert.equal(feeFor(2_000), 1);
  assert.equal(priceRow(0.001).rapFee, 0);
  assert.equal(priceRow(1).rapFee, 0.0005);
});

test('card and network shares are computed, not typed', () => {
  assert.equal(Math.round(priceRow(0.01).cardPct), 3003);
  assert.equal(priceRow(1).networkPct.toFixed(4), '0.0365');
});

test('scenario revenue is volume times 5 bps and the scenarios are ordered', () => {
  const rows = SCENARIOS.map(scenarioRow);
  for (const r of rows) {
    assert.ok(Math.abs(r.revenue2030 - r.som * 0.0005) < 1e-6);
    assert.equal(r.revenue2027, r.volume2027 * 0.0005);
  }
  assert.ok(rows[0].som < rows[1].som && rows[1].som < rows[2].som);
  assert.equal(Math.round(rows[1].revenue2030), 127490);
  assert.equal(volumeFor(1_000_000), 2_000_000_000);
});

test('the page labels SAM, SOM and scenario volumes as estimates and says no fee is collected today', () => {
  const page = readFileSync(join(import.meta.dirname, '..', 'app', 'market', 'page.tsx'), 'utf8');
  assert.match(page, /no protocol fee is collected today/i);
  assert.match(page, /nothing here runs on Solana mainnet yet/i);
  assert.equal((page.match(/className="tag">estimate</g) ?? []).length, 2);
  assert.match(page, /our estimates<\/b>/);
});
