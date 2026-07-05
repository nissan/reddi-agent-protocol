import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ONBOARDING_ANALYSER_FIXTURE_MATRIX_SCHEMA_VERSION,
  ONBOARDING_ANALYSER_GUARDRAILS,
  ONBOARDING_ANALYSER_HANDOFF_ISSUE,
  ONBOARDING_ANALYSER_HANDOFF_PARENT_ISSUES,
  ONBOARDING_ANALYSER_HANDOFF_SCHEMA_VERSION,
  ONBOARDING_CAPABILITY_INVENTORY_SCHEMA_VERSION,
  ONBOARDING_FIXTURE_CLASSES,
  ONBOARDING_INTAKE_DESCRIPTOR_SCHEMA_VERSION,
  ONBOARDING_LISTING_EXPORT_DRAFT_SCHEMA_VERSION,
  ONBOARDING_RAP_PROFILE_DRAFT_SCHEMA_VERSION,
  ONBOARDING_READINESS_LANES,
  ONBOARDING_READINESS_RESULT_SCHEMA_VERSION,
  ONBOARDING_SELLER_WRAPPER_DRAFT_SCHEMA_VERSION,
  listOnboardingAnalyserFixtureMatrix,
  partitionOnboardingEntryFieldsByProvenance,
  runOnboardingAnalyserHandoff,
  validateOnboardingIntakeDescriptor,
  verifyOnboardingField,
  type OnboardingAnalyserHandoffSuccess,
  type OnboardingIntakeDescriptor,
  type OnboardingIntakeValidationErrorCode,
} from '../dist/index.js';

function uniqueSortedCodes(codes: OnboardingIntakeValidationErrorCode[]): OnboardingIntakeValidationErrorCode[] {
  return [...new Set(codes)].sort();
}

function validFixtureDescriptor(key: string): OnboardingIntakeDescriptor {
  const fixture = listOnboardingAnalyserFixtureMatrix().find((item) => item.key === key);
  assert.ok(fixture, `fixture ${key} must exist`);
  const validation = validateOnboardingIntakeDescriptor(fixture.descriptor);
  assert.ok(validation.ok, `fixture ${key} must validate`);
  return validation.descriptor;
}

function successfulHandoff(key: string): OnboardingAnalyserHandoffSuccess {
  const fixture = listOnboardingAnalyserFixtureMatrix().find((item) => item.key === key);
  assert.ok(fixture, `fixture ${key} must exist`);
  const result = runOnboardingAnalyserHandoff(fixture.descriptor);
  assert.ok(result.ok, `fixture ${key} must produce a successful handoff`);
  return result;
}

describe('onboarding analyser handoff contracts (#509)', () => {
  it('anchors the contract to its issue map', () => {
    assert.equal(ONBOARDING_ANALYSER_HANDOFF_ISSUE, 509);
    assert.equal(ONBOARDING_ANALYSER_HANDOFF_PARENT_ISSUES.onboardingAssistantEpic, 370);
    assert.equal(ONBOARDING_ANALYSER_HANDOFF_PARENT_ISSUES.capabilityInventoryFeature, 371);
    assert.equal(ONBOARDING_ANALYSER_HANDOFF_PARENT_ISSUES.rapProfileSchemaTask, 372);
    assert.equal(ONBOARDING_ANALYSER_HANDOFF_PARENT_ISSUES.readinessAnalysisFeature, 373);
    assert.equal(ONBOARDING_ANALYSER_HANDOFF_PARENT_ISSUES.liveAdapterSplitTask, 459);
    assert.equal(ONBOARDING_ANALYSER_FIXTURE_MATRIX_SCHEMA_VERSION, 'reddi.onboarding-analyser-fixture-matrix.v1');
  });

  it('keeps every no-live guardrail explicitly false', () => {
    const values = Object.values(ONBOARDING_ANALYSER_GUARDRAILS);
    assert.ok(values.length >= 12);
    for (const value of values) {
      assert.equal(value, false);
    }
    assert.equal(ONBOARDING_ANALYSER_GUARDRAILS.networkFetchAllowed, false);
    assert.equal(ONBOARDING_ANALYSER_GUARDRAILS.paidCallAllowed, false);
    assert.equal(ONBOARDING_ANALYSER_GUARDRAILS.walletOrRpcAllowed, false);
    assert.equal(ONBOARDING_ANALYSER_GUARDRAILS.publicationAllowed, false);
    assert.equal(ONBOARDING_ANALYSER_GUARDRAILS.liveAuthRegistrationAllowed, false);
  });

  describe('no-network golden fixture matrix', () => {
    it('covers every required fixture class', () => {
      const matrix = listOnboardingAnalyserFixtureMatrix();
      const coveredClasses = new Set(matrix.map((fixture) => fixture.fixtureClass));
      for (const fixtureClass of ONBOARDING_FIXTURE_CLASSES) {
        assert.ok(coveredClasses.has(fixtureClass), `fixture matrix must cover class ${fixtureClass}`);
      }
      assert.equal(ONBOARDING_FIXTURE_CLASSES.length, 9);
    });

    it('validates every fixture case exactly as declared', () => {
      for (const fixture of listOnboardingAnalyserFixtureMatrix()) {
        const validation = validateOnboardingIntakeDescriptor(fixture.descriptor);
        assert.equal(validation.ok, fixture.expectedValid, `fixture ${fixture.key} validity mismatch`);
        if (!validation.ok) {
          assert.deepEqual(
            uniqueSortedCodes(validation.errors.map((error) => error.code)),
            uniqueSortedCodes(fixture.expectedErrorCodes),
            `fixture ${fixture.key} error codes mismatch`,
          );
        } else {
          assert.deepEqual(fixture.expectedErrorCodes, []);
          assert.equal(validation.descriptor.schemaVersion, ONBOARDING_INTAKE_DESCRIPTOR_SCHEMA_VERSION);
          assert.equal(validation.descriptor.ingestionMode, 'static-fixture');
          assert.equal(validation.descriptor.staticOnly, true);
        }
      }
    });

    it('runs the full handoff for every valid fixture with declared readiness outcomes', () => {
      for (const fixture of listOnboardingAnalyserFixtureMatrix()) {
        const result = runOnboardingAnalyserHandoff(fixture.descriptor);
        assert.equal(result.ok, fixture.expectedValid, `fixture ${fixture.key} handoff outcome mismatch`);
        if (!result.ok) {
          assert.equal(result.failClosed, true);
          assert.ok(result.errors.length > 0);
          assert.deepEqual(result.guardrails, ONBOARDING_ANALYSER_GUARDRAILS);
          continue;
        }
        assert.equal(result.schemaVersion, ONBOARDING_ANALYSER_HANDOFF_SCHEMA_VERSION);
        assert.equal(result.capabilityInventory.schemaVersion, ONBOARDING_CAPABILITY_INVENTORY_SCHEMA_VERSION);
        assert.equal(result.rapProfileDraft.schemaVersion, ONBOARDING_RAP_PROFILE_DRAFT_SCHEMA_VERSION);
        assert.equal(result.readiness.schemaVersion, ONBOARDING_READINESS_RESULT_SCHEMA_VERSION);
        assert.equal(result.sellerWrapperDraft.schemaVersion, ONBOARDING_SELLER_WRAPPER_DRAFT_SCHEMA_VERSION);
        assert.equal(result.listingExportDraft.schemaVersion, ONBOARDING_LISTING_EXPORT_DRAFT_SCHEMA_VERSION);
        if (fixture.expectedOverallReadiness) {
          assert.equal(result.readiness.overall, fixture.expectedOverallReadiness, `fixture ${fixture.key} readiness mismatch`);
        }
        for (const reason of fixture.expectedFailClosedReasons ?? []) {
          assert.ok(
            result.readiness.failClosedReasons.includes(reason),
            `fixture ${fixture.key} must fail closed with ${reason}`,
          );
        }
      }
    });

    it('is deterministic: identical inputs produce identical handoffs', () => {
      for (const fixture of listOnboardingAnalyserFixtureMatrix()) {
        assert.deepEqual(
          runOnboardingAnalyserHandoff(fixture.descriptor),
          runOnboardingAnalyserHandoff(fixture.descriptor),
          `fixture ${fixture.key} must be deterministic`,
        );
      }
    });
  });

  describe('handoff stage chaining', () => {
    it('chains intake -> inventory -> profile -> readiness -> wrapper -> listing by stable refs', () => {
      const result = successfulHandoff('mcp_metadata_full');
      assert.equal(result.capabilityInventory.intakeRef, result.intake.intakeId);
      assert.equal(result.rapProfileDraft.intakeRef, result.intake.intakeId);
      assert.equal(result.readiness.profileRef, result.rapProfileDraft.profileId);
      assert.equal(result.sellerWrapperDraft.profileRef, result.rapProfileDraft.profileId);
      assert.equal(result.listingExportDraft.profileRef, result.rapProfileDraft.profileId);
      assert.equal(result.listingExportDraft.readinessRef, result.readiness.profileRef);
      assert.deepEqual(result.rapProfileDraft.rawSnapshotRefs, result.capabilityInventory.rawSnapshotRefs);
      assert.ok(result.capabilityInventory.rawSnapshotRefs.length > 0);
    });

    it('produces every readiness lane exactly once', () => {
      const result = successfulHandoff('openapi_service');
      assert.deepEqual(
        result.readiness.lanes.map((lane) => lane.lane),
        [...ONBOARDING_READINESS_LANES],
      );
      assert.equal(ONBOARDING_READINESS_LANES.length, 11);
    });

    it('never emits publish_ready from the static contract path', () => {
      for (const fixture of listOnboardingAnalyserFixtureMatrix()) {
        const result = runOnboardingAnalyserHandoff(fixture.descriptor);
        if (result.ok) {
          assert.notEqual(result.readiness.overall, 'publish_ready');
          assert.equal(result.listingExportDraft.publicationDisabled, true);
          assert.equal(result.listingExportDraft.operatorReviewRequired, true);
          assert.equal(result.sellerWrapperDraft.paymentPlan.activation, 'disabled');
          assert.equal(result.sellerWrapperDraft.paymentPlan.livePaymentApproved, false);
          assert.equal(result.rapProfileDraft.invocation.invocationAllowed, false);
          assert.equal(result.rapProfileDraft.healthChecks.probesAllowed, false);
        }
      }
    });
  });

  describe('field provenance separation', () => {
    it('separates discovered, inferred, user-provided, verified, and blocked fields', () => {
      const result = successfulHandoff('partial_metadata');
      const entry = result.capabilityInventory.entries[0];
      assert.ok(entry);
      const partition = partitionOnboardingEntryFieldsByProvenance(entry);
      assert.deepEqual(Object.keys(partition).sort(), [
        'blocked',
        'discovered',
        'inferred',
        'user_provided',
        'verified',
      ]);
      assert.ok(partition.discovered.includes('name'));
      assert.ok(partition.inferred.includes('sideEffectRisk'));
      assert.ok(partition.blocked.includes('inputShape'));
      assert.ok(partition.blocked.includes('outputShape'));
      assert.ok(partition.blocked.includes('endpointUrl'));
      assert.ok(partition.blocked.includes('authHints'));
      assert.deepEqual(partition.verified, []);
      for (const field of [entry.inputShape, entry.outputShape, entry.endpointUrl, entry.authHints]) {
        assert.equal(field.provenance, 'blocked');
        assert.equal(field.blockedReason, 'missing_evidence');
        assert.equal(field.value, undefined);
      }
    });

    it('marks operator-supplied identity fields as user_provided', () => {
      const result = successfulHandoff('manual_descriptor_operator');
      assert.equal(result.rapProfileDraft.identity.displayName.provenance, 'user_provided');
      assert.equal(result.rapProfileDraft.identity.displayName.value, 'Manually Described Agent');
      assert.equal(result.rapProfileDraft.identity.publisherContactRef.provenance, 'user_provided');
    });

    it('marks discovered metadata as discovered and never verified', () => {
      const result = successfulHandoff('mcp_metadata_full');
      for (const entry of result.capabilityInventory.entries) {
        assert.equal(entry.name.provenance, 'discovered');
        assert.equal(entry.contentTrustBoundary, 'untrusted_imported_content');
        const partition = partitionOnboardingEntryFieldsByProvenance(entry);
        assert.deepEqual(partition.verified, []);
      }
    });

    it('only upgrades a field to verified with non-empty evidence refs', () => {
      const result = successfulHandoff('mcp_metadata_full');
      const entry = result.capabilityInventory.entries[0];
      assert.ok(entry);

      const missingEvidence = verifyOnboardingField(entry.name, []);
      assert.equal(missingEvidence.ok, false);
      assert.ok(!missingEvidence.ok && missingEvidence.reasonCode === 'missing_evidence');

      const blankEvidence = verifyOnboardingField(entry.name, ['   ']);
      assert.equal(blankEvidence.ok, false);

      const verified = verifyOnboardingField(entry.name, ['evidence:operator-review:1']);
      assert.ok(verified.ok);
      assert.equal(verified.field.provenance, 'verified');
      assert.deepEqual(verified.field.evidenceRefs, ['evidence:operator-review:1']);

      const blockedField = entry.endpointUrl.provenance === 'blocked' ? entry.endpointUrl : entry.inputShape;
      if (blockedField.value === undefined) {
        const blockedVerify = verifyOnboardingField(blockedField, ['evidence:x']);
        assert.equal(blockedVerify.ok, false);
      }
    });
  });

  describe('fail-closed negative cases', () => {
    it('rejects credential leakage in metadata values', () => {
      const validation = validateOnboardingIntakeDescriptor(
        listOnboardingAnalyserFixtureMatrix().find((fixture) => fixture.key === 'credential_shaped_input')?.descriptor,
      );
      assert.ok(!validation.ok);
      assert.deepEqual(uniqueSortedCodes(validation.errors.map((error) => error.code)), ['credential_leakage_rejected']);
    });

    it('rejects credential-shaped URL query keys and embedded userinfo', () => {
      const base = validFixtureDescriptor('openapi_service');
      const withQueryKey = structuredClone(base);
      withQueryKey.declaredMetadata.endpointUrls = ['https://api.example.com/invoke?api_key=fixture'];
      const queryValidation = validateOnboardingIntakeDescriptor(withQueryKey);
      assert.ok(!queryValidation.ok);
      assert.ok(queryValidation.errors.some((error) => error.code === 'credential_leakage_rejected'));

      const withUserInfo = structuredClone(base);
      withUserInfo.declaredMetadata.endpointUrls = ['https://user:pass1234@api.example.com/invoke'];
      const userInfoValidation = validateOnboardingIntakeDescriptor(withUserInfo);
      assert.ok(!userInfoValidation.ok);
      assert.ok(userInfoValidation.errors.some((error) => error.code === 'credential_leakage_rejected'));
    });

    it('rejects private, localhost, link-local, and non-HTTPS URLs', () => {
      const base = validFixtureDescriptor('openapi_service');
      for (const url of [
        'http://example.com/api',
        'https://localhost/api',
        'https://127.0.0.1/api',
        'https://10.0.0.5/api',
        'https://192.168.0.9/api',
        'https://172.20.1.2/api',
        'https://169.254.1.1/api',
        'https://agent.internal/api',
        'https://box.local/api',
      ]) {
        const mutated = structuredClone(base);
        mutated.declaredMetadata.endpointUrls = [url];
        const validation = validateOnboardingIntakeDescriptor(mutated);
        assert.ok(!validation.ok, `${url} must be rejected`);
        assert.ok(
          validation.errors.some((error) => error.code === 'private_url_blocked'),
          `${url} must be blocked as private`,
        );
      }
    });

    it('rejects executable metadata: command execution and plugin install requests', () => {
      const base = validFixtureDescriptor('mcp_metadata_full');
      const mutated = structuredClone(base);
      mutated.requestedOperations = ['command_execution'];
      const validation = validateOnboardingIntakeDescriptor(mutated);
      assert.ok(!validation.ok);
      assert.deepEqual(uniqueSortedCodes(validation.errors.map((error) => error.code)), ['command_execution_rejected']);
    });

    it('rejects paid-call requests', () => {
      const base = validFixtureDescriptor('openapi_service');
      const mutated = structuredClone(base);
      mutated.requestedOperations = ['paid_call'];
      const validation = validateOnboardingIntakeDescriptor(mutated);
      assert.ok(!validation.ok);
      assert.deepEqual(uniqueSortedCodes(validation.errors.map((error) => error.code)), ['paid_call_rejected']);
    });

    it('rejects wallet/RPC requests', () => {
      const base = validFixtureDescriptor('a2a_card_missing_payment');
      const mutated = structuredClone(base);
      mutated.requestedOperations = ['wallet_rpc'];
      const validation = validateOnboardingIntakeDescriptor(mutated);
      assert.ok(!validation.ok);
      assert.deepEqual(uniqueSortedCodes(validation.errors.map((error) => error.code)), ['wallet_rpc_rejected']);
    });

    it('rejects every other forbidden operation fail-closed', () => {
      const base = validFixtureDescriptor('openapi_service');
      for (const operation of [
        'network_fetch',
        'mcp_call',
        'endpoint_invocation',
        'secret_read',
        'hosted_write',
        'publication',
        'reputation_mutation',
        'totally_unknown_operation',
      ]) {
        const mutated = structuredClone(base);
        mutated.requestedOperations = [operation];
        const validation = validateOnboardingIntakeDescriptor(mutated);
        assert.ok(!validation.ok, `${operation} must be rejected`);
      }
    });

    it('rejects imported content that self-asserts trust (unverified claims)', () => {
      const fixture = listOnboardingAnalyserFixtureMatrix().find((item) => item.key === 'untrusted_trust_claim_rejected');
      assert.ok(fixture);
      const validation = validateOnboardingIntakeDescriptor(fixture.descriptor);
      assert.ok(!validation.ok);
      assert.deepEqual(
        uniqueSortedCodes(validation.errors.map((error) => error.code)),
        ['untrusted_imported_content_rejected'],
      );
    });

    it('fails closed on missing payment metadata at readiness, with activation kept disabled', () => {
      const result = successfulHandoff('a2a_card_missing_payment');
      const paymentLane = result.readiness.lanes.find((lane) => lane.lane === 'payment_readiness');
      assert.ok(paymentLane);
      assert.equal(paymentLane.status, 'blocked');
      assert.deepEqual(paymentLane.reasonCodes, ['missing_payment_metadata']);
      assert.equal(result.readiness.overall, 'blocked');
      assert.equal(result.rapProfileDraft.payment.status, 'missing_payment_metadata');
      assert.deepEqual(
        result.rapProfileDraft.payment.missingFields,
        ['settlementAddress', 'network', 'price', 'currency'],
      );
      assert.equal(result.sellerWrapperDraft.paymentPlan.status, 'draft_incomplete');
      assert.equal(result.listingExportDraft.status, 'blocked');
      assert.ok(result.listingExportDraft.states.some((state) => state.code === 'missing_payment' && state.severity === 'blocked'));
      assert.equal(result.listingExportDraft.exportFragments.aiCatalog.payment.status, 'missing_payment_setup');
    });

    it('fails closed on missing evidence and keeps trust evidence unverified', () => {
      const result = successfulHandoff('static_agent_stack_snapshot');
      const trustLane = result.readiness.lanes.find((lane) => lane.lane === 'trust_evidence');
      assert.ok(trustLane);
      assert.notEqual(trustLane.status, 'ready');
      assert.deepEqual(trustLane.reasonCodes, ['missing_evidence']);
      assert.ok(result.readiness.failClosedReasons.includes('missing_evidence'));
    });

    it('never treats source authenticity or catalog relevance as content trust', () => {
      const result = successfulHandoff('ard_ai_catalog_entry');
      const authenticityLane = result.readiness.lanes.find((lane) => lane.lane === 'static_source_authenticity');
      const contentTrustLane = result.readiness.lanes.find((lane) => lane.lane === 'imported_content_trust');
      assert.ok(authenticityLane && contentTrustLane);
      assert.equal(authenticityLane.status, 'ready');
      assert.equal(contentTrustLane.status, 'needs_operator_review');
      assert.equal(result.rapProfileDraft.trust.sourceAuthenticity, 'snapshot_recorded');
      assert.equal(result.rapProfileDraft.trust.importedContentTrust, 'untrusted');
      assert.equal(result.rapProfileDraft.trust.verifiedProviderTrust, false);
      assert.equal(result.rapProfileDraft.reputation.status, 'unproven');
      assert.deepEqual(result.rapProfileDraft.reputation.receiptRefs, []);
      assert.equal(result.listingExportDraft.exportFragments.aiCatalog.trust.status, 'unverified');
    });

    it('rejects live-probe ingestion modes in the contract path', () => {
      const base = validFixtureDescriptor('mcp_metadata_full');
      const mutated: Record<string, unknown> = structuredClone(base);
      mutated.ingestionMode = 'live-probe';
      const validation = validateOnboardingIntakeDescriptor(mutated);
      assert.ok(!validation.ok);
      assert.ok(validation.errors.some((error) => error.code === 'malformed_intake_descriptor'));
    });
  });

  describe('forbidden import / no-live route-graph guard', () => {
    it('is offline-only: the contract module imports nothing and references no network/fs/exec/payment surface', () => {
      const sourcePath = fileURLToPath(new URL('../src/onboarding-analyser-handoff.ts', import.meta.url));
      const source = readFileSync(sourcePath, 'utf8');
      assert.ok(!/^\s*import\s/m.test(source), 'contract module must have zero imports');
      assert.ok(!/\brequire\s*\(/.test(source), 'contract module must not use require()');
      for (const banned of [
        'node:http',
        'node:https',
        'node:net',
        'node:fs',
        'node:child_process',
        'child_process',
        'fetch(',
        'XMLHttpRequest',
        'WebSocket',
        '@solana/web3.js',
        'Connection(',
        'sendTransaction',
        'signTransaction',
        'ethers',
        'viem',
        'process.env',
      ]) {
        assert.ok(!source.includes(banned), `contract module must not reference ${banned}`);
      }
      assert.ok(!/\basync\b/.test(source), 'contract module must not contain async code');
      assert.ok(!/\bawait\b/.test(source), 'contract module must not contain await');
    });
  });
});
