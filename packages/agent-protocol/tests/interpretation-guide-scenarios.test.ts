import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

type ScenarioResult = { id: string; matches: boolean; observed: Record<string, unknown> };

describe('interpretation guide scenarios (#679, interim)', () => {
  const stdout = execFileSync(process.execPath, ['examples/interpretation-guide-scenarios.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  const output = JSON.parse(stdout) as {
    ok: boolean;
    boundaries: Record<string, boolean>;
    scenarios: ScenarioResult[];
  };

  it('every scenario returns what the guide says it returns', () => {
    assert.equal(output.ok, true);
    assert.equal(output.scenarios.length, 19);
    for (const scenario of output.scenarios) {
      assert.equal(scenario.matches, true, `${scenario.id} no longer matches the guide`);
    }
  });

  it('runs without spend, signing, RPC, provider calls or credentials', () => {
    assert.deepEqual(output.boundaries, {
      livePayment: false,
      walletSigning: false,
      rpcCall: false,
      providerCall: false,
      credentialsRead: false,
    });
  });

  it('keeps the refusal scenarios refusing', () => {
    const byId = new Map(output.scenarios.map((scenario) => [scenario.id, scenario.observed]));
    assert.equal(byId.get('S3')?.policyAllowed, false);
    for (const id of ['S4', 'S5', 'S6']) assert.equal(byId.get(id)?.allowed, false, id);
    for (const id of ['S7', 'S8', 'S9', 'S10', 'S14', 'S15']) assert.equal(byId.get(id)?.ok, false, id);
    assert.equal(byId.get('S17')?.status, 'observation_inconclusive');
  });

  it('is described by a guide that names every scenario', () => {
    const guide = readFileSync('../../docs/RAP-INTERPRETATION-GUIDE-INTERIM.md', 'utf8');
    for (const scenario of output.scenarios) {
      assert.ok(guide.includes(`| ${scenario.id} |`), `guide has no row for ${scenario.id}`);
    }
  });
});
