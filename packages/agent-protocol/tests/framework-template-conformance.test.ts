import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FRAMEWORK_TEMPLATE_CONFORMANCE_CHECK_VERSION,
  frameworkTemplateFixtures,
  listFrameworkTemplateConformanceCases,
  runFrameworkTemplateNoLiveConformanceCheck,
  type FrameworkTemplateConformanceCase,
  type FrameworkTemplateContract,
} from '../dist/index.js';

describe('framework-template no-live conformance checker', () => {
  it('passes the built-in lifecycle and profile-mode conformance cases', () => {
    const cases = listFrameworkTemplateConformanceCases();
    const result = runFrameworkTemplateNoLiveConformanceCheck({ cases });

    assert.equal(result.version, FRAMEWORK_TEMPLATE_CONFORMANCE_CHECK_VERSION);
    assert.equal(result.issue, 553);
    assert.equal(result.valid, true);
    assert.deepEqual(result.reasonCodes, ['framework_template_conformance_valid']);
    assert.equal(result.checkedCases.length, 11);
    assert.deepEqual(result.requiredLifecycle.sort(), [
      'denial',
      'discovery',
      'failure',
      'invocation',
      'operator-approval',
      'preflight',
      'quote',
      'receipt-evidence',
    ]);
    assert.deepEqual(result.requiredProfileModes.sort(), ['buyer-enabled', 'dual-mode', 'seller-enabled']);
    assert.equal(result.downstreamIssues.sharedContract, 552);
    assert.equal(result.downstreamIssues.langGraphTemplate, 544);
    assert.equal(result.downstreamIssues.strandsTemplate, 545);
    assert.equal(result.downstreamIssues.adkTemplate, 546);
    assert.equal(result.downstreamIssues.comparisonDocs, 547);
  });

  it('fails closed when required lifecycle or profile cases are missing', () => {
    const onlyLifecycle = listFrameworkTemplateConformanceCases().filter((item) => item.kind.startsWith('lifecycle:'));
    assert.deepEqual(runFrameworkTemplateNoLiveConformanceCheck({ cases: onlyLifecycle }).reasonCodes, [
      'missing_required_profile_mode',
    ]);

    const onlyModes = listFrameworkTemplateConformanceCases().filter((item) => item.kind.startsWith('mode:'));
    assert.deepEqual(runFrameworkTemplateNoLiveConformanceCheck({ cases: onlyModes }).reasonCodes, [
      'missing_required_lifecycle_fixture',
    ]);
  });

  it('fails closed when case labels spoof lifecycle or profile coverage', () => {
    const spoofedLifecycle = conformanceCase('lifecycle:failure', () => {});
    assert.deepEqual(runFrameworkTemplateNoLiveConformanceCheck({ cases: [spoofedLifecycle] }).checkedCases[0]?.reasonCodes, [
      'conformance_case_kind_mismatch',
    ]);

    const spoofedMode = conformanceCase('mode:buyer-enabled', (contract) => {
      contract.agentIdentity.templateMode = 'dual-mode';
    });
    assert.deepEqual(runFrameworkTemplateNoLiveConformanceCheck({ cases: [spoofedMode] }).checkedCases[0]?.reasonCodes, [
      'conformance_case_kind_mismatch',
    ]);
  });

  it('validates buyer, seller, and dual-mode required fields', () => {
    const buyerMissingPolicy = conformanceCase('mode:buyer-enabled', (contract) => {
      contract.agentIdentity.templateMode = 'buyer-enabled';
      contract.sellerProfile = undefined;
      contract.buyerAuthorityPolicy = undefined;
    });
    assert.deepEqual(runFrameworkTemplateNoLiveConformanceCheck({ cases: [buyerMissingPolicy] }).checkedCases[0]?.reasonCodes, [
      'framework_template_contract_invalid',
      'missing_mode_required_buyer_authority_policy',
    ]);

    const sellerMissingProfile = conformanceCase('mode:seller-enabled', (contract) => {
      contract.agentIdentity.templateMode = 'seller-enabled';
      contract.buyerAuthorityPolicy = undefined;
      contract.sellerProfile = undefined;
    });
    assert.deepEqual(runFrameworkTemplateNoLiveConformanceCheck({ cases: [sellerMissingProfile] }).checkedCases[0]?.reasonCodes, [
      'missing_mode_required_seller_profile',
    ]);

    const dualMissingSeller = conformanceCase('mode:dual-mode', (contract) => {
      contract.agentIdentity.templateMode = 'dual-mode';
      contract.sellerProfile = undefined;
    });
    assert.deepEqual(runFrameworkTemplateNoLiveConformanceCheck({ cases: [dualMissingSeller] }).checkedCases[0]?.reasonCodes, [
      'missing_mode_required_seller_profile',
    ]);
  });

  it('fails closed for missing identity, invocation modes, receipt/evidence refs, and failure state', () => {
    const missingIdentity = conformanceCase('lifecycle:preflight', (contract) => {
      contract.agentIdentity.agentId = '';
      contract.agentIdentity.capabilityTags = [];
    });
    assert.ok(runFrameworkTemplateNoLiveConformanceCheck({ cases: [missingIdentity] }).reasonCodes.includes('missing_agent_identity_fields'));

    const missingInvocationModes = conformanceCase('lifecycle:preflight', (contract) => {
      contract.invocationModes = [];
    });
    assert.ok(runFrameworkTemplateNoLiveConformanceCheck({ cases: [missingInvocationModes] }).reasonCodes.includes('missing_invocation_modes'));

    const missingReceipt = conformanceCase('lifecycle:invocation', (contract) => {
      contract.receiptEvidenceRefs.receiptRef = undefined;
    });
    assert.ok(runFrameworkTemplateNoLiveConformanceCheck({ cases: [missingReceipt] }).reasonCodes.includes('missing_receipt_evidence_refs'));

    const missingFailureState = conformanceCase('lifecycle:failure', (contract) => {
      contract.failureRefundState.state = '' as FrameworkTemplateContract['failureRefundState']['state'];
    });
    assert.ok(runFrameworkTemplateNoLiveConformanceCheck({ cases: [missingFailureState] }).reasonCodes.includes('missing_failure_refund_state'));
  });

  it('rejects secret, live, wallet/RPC/provider, custody, transfer, and finality regressions', () => {
    const credential = conformanceCase('lifecycle:preflight', (contract) => {
      (contract as FrameworkTemplateContract & { providerSecret?: string }).providerSecret = 'sk-test-secret';
    });
    assert.ok(runFrameworkTemplateNoLiveConformanceCheck({ cases: [credential] }).reasonCodes.includes('framework_template_contains_credentials'));

    const missingBoundary = conformanceCase('lifecycle:preflight', (contract) => {
      const metadata = contract.supportStateMetadata as Partial<FrameworkTemplateContract['supportStateMetadata']>;
      delete metadata.walletRpcProviderCalls;
    });
    assert.ok(runFrameworkTemplateNoLiveConformanceCheck({ cases: [missingBoundary] }).reasonCodes.includes('unsafe_support_state_metadata'));

    const liveBoundary = conformanceCase('lifecycle:preflight', (contract) => {
      (contract.supportStateMetadata as unknown as { livePaymentApproved: boolean }).livePaymentApproved = true;
    });
    assert.ok(runFrameworkTemplateNoLiveConformanceCheck({ cases: [liveBoundary] }).reasonCodes.includes('live_boundary_rejected'));

    const unsafeState = conformanceCase('lifecycle:preflight', (contract) => {
      contract.supportStateMetadata.runtimeState = 'live-payment-approved' as FrameworkTemplateContract['supportStateMetadata']['runtimeState'];
    });
    assert.ok(runFrameworkTemplateNoLiveConformanceCheck({ cases: [unsafeState] }).reasonCodes.includes('unsafe_support_state_metadata'));

    const rpc = conformanceCase('lifecycle:preflight', (contract) => {
      contract.notes.push('Use https://api.mainnet-beta.solana.com as the provider endpoint.');
    });
    assert.ok(runFrameworkTemplateNoLiveConformanceCheck({ cases: [rpc] }).reasonCodes.includes('framework_template_contract_invalid'));

    const custody = conformanceCase('lifecycle:preflight', (contract) => {
      contract.notes.push('AUDD is held in custody by this template.');
    });
    assert.ok(runFrameworkTemplateNoLiveConformanceCheck({ cases: [custody] }).reasonCodes.includes('framework_template_contract_invalid'));

    const transfer = conformanceCase('lifecycle:preflight', (contract) => {
      contract.notes.push('Submit the AUDD payment transaction.');
    });
    assert.ok(runFrameworkTemplateNoLiveConformanceCheck({ cases: [transfer] }).reasonCodes.includes('framework_template_contract_invalid'));

    const finality = conformanceCase('lifecycle:preflight', (contract) => {
      contract.notes.push('Template confirms settlement finality.');
    });
    assert.ok(runFrameworkTemplateNoLiveConformanceCheck({ cases: [finality] }).reasonCodes.includes('framework_template_contract_invalid'));
  });
});

function conformanceCase(
  kind: FrameworkTemplateConformanceCase['kind'],
  mutate: (contract: FrameworkTemplateContract) => void,
): FrameworkTemplateConformanceCase {
  const contract = structuredClone(frameworkTemplateFixtures.preflight.contract) as FrameworkTemplateContract;
  mutate(contract);
  return {
    kind,
    description: `${kind} mutated test case`,
    contract,
  };
}
