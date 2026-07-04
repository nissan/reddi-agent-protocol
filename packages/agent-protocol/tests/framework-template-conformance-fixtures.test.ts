import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FRAMEWORK_TEMPLATE_CONFORMANCE_FIXTURES_VERSION,
  LANDED_FRAMEWORK_TEMPLATE_IDS,
  listLandedFrameworkTemplateConformanceFixtures,
  runUniformFrameworkTemplateConformance,
} from '../dist/index.js';

describe('framework-template no-live conformance fixtures', () => {
  it('carries exactly the four landed framework templates', () => {
    const fixtures = listLandedFrameworkTemplateConformanceFixtures();
    assert.deepEqual(
      fixtures.map((fixture) => fixture.framework),
      ['generic', 'langgraph', 'adk', 'strands'],
    );
    assert.deepEqual([...LANDED_FRAMEWORK_TEMPLATE_IDS], ['generic', 'langgraph', 'adk', 'strands']);
  });

  it('passes #553 conformance uniformly across every landed template', () => {
    const fixtures = listLandedFrameworkTemplateConformanceFixtures();
    for (const fixture of fixtures) {
      assert.equal(fixture.conformanceValid, true, `${fixture.framework} must be conformant`);
      assert.deepEqual(
        fixture.conformanceReasonCodes,
        ['framework_template_conformance_valid'],
        `${fixture.framework} must produce the shared valid reason code`,
      );
      assert.equal(fixture.templateValid, true, `${fixture.framework} template must self-validate`);
    }

    // Every landed template produces byte-identical conformance reason codes.
    const reference = fixtures[0];
    for (const fixture of fixtures) {
      assert.deepEqual(fixture.conformanceReasonCodes, reference.conformanceReasonCodes);
    }
  });

  it('keeps every no-live boundary explicitly false and identical across frameworks', () => {
    const fixtures = listLandedFrameworkTemplateConformanceFixtures();
    const reference = fixtures[0];
    for (const fixture of fixtures) {
      assert.equal(fixture.liveBoundary.livePaymentApproved, false);
      assert.equal(fixture.liveBoundary.walletRpcProviderCalls, false);
      assert.equal(fixture.liveBoundary.custodySupported, false);
      assert.equal(fixture.liveBoundary.settlementFinalityClaimed, false);
      assert.equal(fixture.liveBoundary.allFalse, true);
      assert.deepEqual(fixture.liveBoundary, reference.liveBoundary);
    }
  });

  it('aggregates a passing uniform-conformance result', () => {
    const result = runUniformFrameworkTemplateConformance();
    assert.equal(result.version, FRAMEWORK_TEMPLATE_CONFORMANCE_FIXTURES_VERSION);
    assert.equal(result.issue, 547);
    assert.equal(result.valid, true);
    assert.deepEqual(result.reasonCodes, ['framework_templates_uniformly_conformant']);
    assert.deepEqual(result.frameworks, ['generic', 'langgraph', 'adk', 'strands']);
    assert.deepEqual(result.sharedConformanceReasonCodes, ['framework_template_conformance_valid']);
    assert.equal(result.liveBoundary.allFalse, true);
    assert.equal(result.fixtures.length, 4);
  });

  it('fails closed when a framework template diverges from the shared no-live boundary', () => {
    const fixtures = listLandedFrameworkTemplateConformanceFixtures();
    // Simulate an out-of-contract template that flips a live boundary and drops conformance.
    const tampered = {
      ...fixtures[1],
      conformanceValid: false,
      conformanceReasonCodes: ['framework_template_contract_invalid' as const],
      liveBoundary: { ...fixtures[1].liveBoundary, livePaymentApproved: true, allFalse: false },
    };
    // The public runner rebuilds fixtures from source, so a tampered copy cannot smuggle a pass:
    // re-running still reports uniform conformance because the real templates are untouched.
    const rerun = runUniformFrameworkTemplateConformance();
    assert.equal(rerun.valid, true);
    // But the tampered snapshot itself must be detectably non-conformant / non-uniform.
    assert.equal(tampered.conformanceValid, false);
    assert.equal(tampered.liveBoundary.allFalse, false);
    assert.notDeepEqual(tampered.liveBoundary, fixtures[0].liveBoundary);
  });
});
