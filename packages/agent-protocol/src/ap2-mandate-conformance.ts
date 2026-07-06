import {
  AP2_AUTHORIZATION_NETWORK,
  AP2_MANDATE_INGESTION_FIXTURE_NOW,
  AP2_MANDATE_INGESTION_SCHEMA_VERSION,
  ap2FixtureCentiUnits,
  ap2MandateFixtures,
  bindMandateToReceipt,
  composeAp2MandateWithLocalPolicy,
  hashAp2Mandate,
  ingestAp2Mandate,
  type Ap2BindingReasonCode,
  type Ap2CompositionReasonCode,
  type Ap2IngestReasonCode,
  type Ap2MandateFixture,
  type Ap2MandateIngestionResult,
  type Ap2MandateRef,
  type Ap2SupportState,
} from './ap2-mandate-ingestion.js';
import {
  evaluateBuyerAuthorityPolicy,
  type BuyerAuthorityPolicy,
} from './buyer-authority-policy.js';
import { reddiReceiptFixtures } from './fixtures.js';
import { validateReddiReceipt } from './receipts.js';

/**
 * `reddi.ap2-mandate-conformance.v1` — NO-LIVE conformance surface for the
 * `reddi.ap2-mandate-ingestion.v1` adapter (#563, mirrors the ERC-8004
 * conformance convention from #562).
 *
 * Proves the AP2 round-trip entirely offline and deterministically: static
 * signed-mandate fixture → ingestion result → verified field-by-field back
 * against the mandate source (including hash recomputation, which makes
 * tampering on either side fail a named check) → policy-gate composition where
 * the LOCAL policy always wins → receipt binding that carries only a
 * non-secret mandate reference.
 *
 * No network, no wallet, no RPC, no live VDC verification, no key handling
 * anywhere. AP2 field shapes remain unverified external-draft references
 * (see `AP2_EXTERNAL_STANDARD`); signature verification is FIXTURE-ASSERTED
 * only and no settlement-finality claim exists in any fixture or check.
 */
export const AP2_MANDATE_CONFORMANCE_SCHEMA_VERSION = 'reddi.ap2-mandate-conformance.v1' as const;

export type Ap2RoundTripCheck = {
  id: string;
  ok: boolean;
  detail: string;
};

export type Ap2RoundTripResult = {
  schemaVersion: typeof AP2_MANDATE_CONFORMANCE_SCHEMA_VERSION;
  ok: boolean;
  checks: Ap2RoundTripCheck[];
};

const EXPECTED_RESULT_TOP_LEVEL_KEYS = new Set([
  'schemaVersion',
  'draft',
  'externalStandard',
  'supportState',
  'mandateRef',
  'derived',
  'reasonCodes',
  'auditNotes',
  'guardrails',
]);

const AP2_CURRENCY_TO_RAP_ASSET: Record<string, string> = {
  USDC: 'USDC',
  AUDD: 'AUDD',
  SOL: 'SOL',
};

/**
 * Verify an AP2 ingestion result FIELD-BY-FIELD against the mandate it was
 * ingested from — the offline "round-trip" of #563. Deterministic and pure:
 * every check recomputes the expected value from the mandate source and
 * compares it to the emitted result. Tampering with either side (e.g. a cart
 * total edited after ingestion) fails the `mandate_hash_recomputes` check.
 *
 * A non-authorizing result (probe-only / rejected) never round-trips — callers
 * asserting fail-closed lanes should check reason codes instead.
 */
export function verifyAp2IngestionAgainstMandate(
  result: Ap2MandateIngestionResult,
  mandate: Ap2MandateFixture,
): Ap2RoundTripResult {
  const checks: Ap2RoundTripCheck[] = [];
  const check = (id: string, ok: boolean, detail: string): void => {
    checks.push({ id, ok, detail });
  };

  check(
    'ingestion_authorizing',
    result?.supportState === 'ap2_mandate_fixture' && result?.derived !== null,
    'a non-authorizing result (probe-only / rejected) has no source round-trip; fail-closed lanes are asserted via reason codes',
  );
  if (result?.supportState !== 'ap2_mandate_fixture' || result?.derived === null) {
    return { schemaVersion: AP2_MANDATE_CONFORMANCE_SCHEMA_VERSION, ok: false, checks };
  }

  check('schema_version', result.schemaVersion === AP2_MANDATE_INGESTION_SCHEMA_VERSION, `schemaVersion must be ${AP2_MANDATE_INGESTION_SCHEMA_VERSION}`);
  check(
    'promoted_external_standard_honest',
    result.draft === false
      && result.externalStandard?.fieldShapesVerified === false
      && result.externalStandard?.signatureVerification === 'fixture-asserted'
      && result.externalStandard?.settlementRail === false,
    'RAP-side contract is promoted (draft:false) while AP2 field shapes stay marked unverified, signatures fixture-asserted, and no settlement rail is claimed',
  );
  check(
    'no_unknown_top_level_keys',
    Object.keys(result).every((key) => EXPECTED_RESULT_TOP_LEVEL_KEYS.has(key)),
    'result must not invent fields outside the reddi.ap2-mandate-ingestion.v1 contract',
  );
  check(
    'guardrails_all_safe',
    result.guardrails.fixtureOnly === true
      && result.guardrails.vdcSignatureVerifiedLive === false
      && result.guardrails.keyMaterialHeld === false
      && result.guardrails.livePaymentExecuted === false
      && result.guardrails.walletSigning === false
      && result.guardrails.rpcCall === false
      && result.guardrails.custodyClaim === false
      && result.guardrails.settlementFinalityClaim === false,
    'no guardrail may imply live verification, key handling, custody, payment, or settlement',
  );

  // Tamper evidence: the mandate hash must recompute from the (signature-stripped,
  // canonicalized) mandate source. Editing either side breaks this check.
  const expectedHash = hashAp2Mandate(mandate);
  check('mandate_hash_recomputes', result.mandateRef.mandateHash === expectedHash, `mandateRef.mandateHash must recompute to ${expectedHash} from the mandate source`);

  // The opaque VDC signature never leaks into the result, and the ref makes no claims.
  const serialized = JSON.stringify(result);
  check('no_signature_leakage', !serialized.includes(mandate.vdc.signatureB64), 'the opaque VDC signature bytes must never appear anywhere in the result');
  check(
    'ref_consistent_and_claimless',
    result.mandateRef.mandateType === mandate.mandateType
      && result.mandateRef.supportState === result.supportState
      && result.mandateRef.humanPresent === mandate.humanPresent
      && result.mandateRef.vdcVerification === 'fixture-asserted'
      && result.mandateRef.settlementFinalityClaimed === false,
    'the mandate ref must mirror the mandate type / support state, stay fixture-asserted, and claim no settlement finality',
  );

  // Derived constraints recompute from the mandate source.
  const derived = result.derived;
  const expectedCurrency = AP2_CURRENCY_TO_RAP_ASSET[
    String(mandate.payment?.currency ?? mandate.cart?.total.currency ?? '').trim().toUpperCase()
  ];
  check(
    'derived_currency_recomputes',
    derived.allowedCurrencies.length === 1 && derived.allowedCurrencies[0] === expectedCurrency,
    `allowedCurrencies must recompute to [${expectedCurrency}] from the mandate payment/cart currency`,
  );
  const expectedCap = ap2FixtureCentiUnits(
    mandate.payment?.budgetCap ?? mandate.payment?.amount ?? mandate.cart?.total.amount ?? '0',
  );
  check(
    'derived_cap_recomputes',
    derived.spendCaps.length === 1
      && expectedCap !== null
      && derived.spendCaps[0].maxAmountUnits === expectedCap
      && derived.spendCaps[0].asset === expectedCurrency
      && derived.spendCaps[0].network === AP2_AUTHORIZATION_NETWORK
      && derived.spendCaps[0].window === 'per_request',
    'the derived spend cap must recompute from budgetCap → amount → cart total, per_request, on the ap2-authorization-fixture lane',
  );
  const expectedSellerIds = mandate.merchant?.id ? [`ap2-merchant:${mandate.merchant.id}`] : [];
  const expectedEndpointIds = mandate.merchant?.id ? [`ap2-merchant-endpoint:${mandate.merchant.id}`] : [];
  check(
    'derived_merchant_refs_recompute',
    JSON.stringify(derived.sellerAllowlistAdditions.sellerIds) === JSON.stringify(expectedSellerIds)
      && JSON.stringify(derived.sellerAllowlistAdditions.endpointIds) === JSON.stringify(expectedEndpointIds),
    'seller refs must recompute as namespaced ap2-merchant refs from the mandate merchant id',
  );
  check('derived_expiry_recomputes', derived.expiresAt === mandate.expiresAt, 'derived expiry must equal the mandate expiry');
  check(
    'derived_operator_approval_recomputes',
    derived.operatorApprovalRequired === (mandate.humanPresent === false),
    'operator approval must be required exactly when the mandate was human-not-present',
  );

  const ok = checks.every((entry) => entry.ok);
  return { schemaVersion: AP2_MANDATE_CONFORMANCE_SCHEMA_VERSION, ok, checks };
}

// ---------------------------------------------------------------------------
// Local buyer-authority policy fixture for composition cases. The local policy
// is the AUTHORITY CEILING — every composition fixture proves the mandate can
// only narrow it. Amounts live in the ap2-authorization-fixture lane's shared
// fixture unit space (no cross-unit arithmetic anywhere).
// ---------------------------------------------------------------------------

export function ap2LocalBuyerAuthorityPolicyFixture(
  overrides: Partial<BuyerAuthorityPolicy> = {},
): BuyerAuthorityPolicy {
  return {
    schemaVersion: 'reddi.buyer-authority-policy.v1',
    issue: 549,
    policyId: 'buyer-authority:ap2-local-lane',
    mode: 'allow',
    buyerAgentId: 'buyer-agent:ap2-composition-demo',
    expiresAt: '2026-12-31T00:00:00.000Z',
    allowedRails: [
      { asset: 'USDC', network: AP2_AUTHORIZATION_NETWORK, supportStates: ['proof-metadata-only'] },
    ],
    allowedCurrencies: ['USDC'],
    spendCaps: [
      {
        asset: 'USDC',
        network: AP2_AUTHORIZATION_NETWORK,
        // Integer centi-units in the shared AP2 fixture unit space (= 40.00).
        maxAmountUnits: '4000',
        window: 'per_request',
      },
    ],
    sellerAllowlist: {
      sellerIds: ['ap2-merchant:seller:listing-writer'],
      endpointIds: ['ap2-merchant-endpoint:seller:listing-writer'],
    },
    receiptEvidence: {
      receiptRequired: true,
      evidenceRequired: true,
      evidenceArchiveRequired: true,
    },
    refundFailurePolicy: {
      failureMode: 'no_charge_on_failure',
      refundMode: 'manual_review',
      operatorReviewRequired: true,
    },
    operatorApproval: { required: false, approvalState: 'not_required' },
    supportStateConstraints: {
      allowLivePayment: false,
      allowedRuntimeStates: ['proof-metadata-only'],
      forbidCustody: true,
      forbidSettlementFinality: true,
    },
    notes: ['Local AP2-lane buyer authority; fixture amounts, no-live.'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Conformance fixtures — deterministic, offline, self-checking (#563).
// ---------------------------------------------------------------------------

export type Ap2ConformanceFixture =
  | {
    kind: 'ingestion';
    case: string;
    description: string;
    mandateKey: keyof typeof ap2MandateFixtures;
    expected: {
      supportState: Ap2SupportState;
      reasonCodes: Ap2IngestReasonCode[];
      /** When true the fixture must pass the full source round-trip. */
      roundTrip: boolean;
    };
  }
  | {
    kind: 'tamper';
    case: string;
    description: string;
    mandateKey: keyof typeof ap2MandateFixtures;
    /** Applied to a CLONE of the mandate after ingestion — the round-trip must then fail. */
    tamper: (mandate: Ap2MandateFixture) => void;
    expected: { failedCheckId: string };
  }
  | {
    kind: 'composition';
    case: string;
    description: string;
    mandateKey: keyof typeof ap2MandateFixtures;
    localPolicy: () => BuyerAuthorityPolicy;
    expected: {
      ok: boolean;
      reasonCodes: Ap2CompositionReasonCode[];
      /** Composed per-request cap on the AP2 lane, proven equal to min(local, mandate). */
      composedCapUnits?: string;
    };
  }
  | {
    kind: 'binding';
    case: string;
    description: string;
    ref: () => Ap2MandateRef;
    expected: {
      ok: boolean;
      reasonCodes: Ap2BindingReasonCode[];
    };
  };

const NOW = AP2_MANDATE_INGESTION_FIXTURE_NOW;

function authorizedRef(mandateKey: keyof typeof ap2MandateFixtures): Ap2MandateRef {
  return ingestAp2Mandate(structuredClone(ap2MandateFixtures[mandateKey]) as Ap2MandateFixture, NOW).mandateRef;
}

/**
 * The #563 conformance fixture set. Deterministic, self-describing, and
 * executable via `runAp2MandateConformanceSuite()`. Nothing here touches a
 * network, wallet, key, or live service.
 */
export function listAp2ConformanceFixtures(): Ap2ConformanceFixture[] {
  return [
    {
      kind: 'ingestion',
      case: 'valid_mandate_round_trip',
      description: 'a finalized Checkout/Payment mandate ingests into buyer-authority constraints that verify field-by-field (including hash recomputation) against the mandate source',
      mandateKey: 'checkoutClosedPaymentClosedValid',
      expected: { supportState: 'ap2_mandate_fixture', reasonCodes: ['ap2_mandate_ingested'], roundTrip: true },
    },
    {
      kind: 'ingestion',
      case: 'probe_only_open_mandate',
      description: 'an open/cart-less mandate is probe-only: no derived authorization, never composes, never binds',
      mandateKey: 'paymentOpenProbeOnly',
      expected: { supportState: 'ap2_mandate_probe_only', reasonCodes: ['probe_only_no_cart_binding'], roundTrip: false },
    },
    {
      kind: 'ingestion',
      case: 'expired_mandate_fails_closed',
      description: 'an expired mandate derives nothing',
      mandateKey: 'expiredMandate',
      expected: { supportState: 'ap2_mandate_probe_only', reasonCodes: ['mandate_expired'], roundTrip: false },
    },
    {
      kind: 'ingestion',
      case: 'over_cap_mandate_fails_closed',
      description: 'a mandate whose amount exceeds its own budget cap derives nothing',
      mandateKey: 'overBudgetMandate',
      expected: { supportState: 'ap2_mandate_probe_only', reasonCodes: ['mandate_over_cap'], roundTrip: false },
    },
    {
      kind: 'ingestion',
      case: 'unsupported_currency_fails_closed',
      description: 'a currency outside the AUDD/USDC/SOL fixture rails derives nothing',
      mandateKey: 'railMismatchMandate',
      expected: { supportState: 'ap2_mandate_probe_only', reasonCodes: ['unsupported_currency_rail'], roundTrip: false },
    },
    {
      kind: 'ingestion',
      case: 'unsupported_mandate_type_fails_closed',
      description: 'a mandate type outside the supported vocabulary is never coerced into an authorizing stage',
      mandateKey: 'unsupportedTypeMandate',
      expected: { supportState: 'ap2_mandate_probe_only', reasonCodes: ['unsupported_mandate_type'], roundTrip: false },
    },
    {
      kind: 'ingestion',
      case: 'signature_material_rejected',
      description: 'signature/JWS material outside the opaque vdc.signatureB64 slot is rejected — RAP does no key handling and holds no Visa/Mastercard/FIDO material',
      mandateKey: 'signatureMaterialMandate',
      expected: { supportState: 'unsupported_live_ap2_settlement', reasonCodes: ['signature_material_rejected'], roundTrip: false },
    },
    {
      kind: 'ingestion',
      case: 'settlement_finality_claim_rejected',
      description: 'a mandate asserting settlement finality is rejected — AP2 is a trust/authorization layer, not a settlement rail',
      mandateKey: 'settlementClaimMandate',
      expected: { supportState: 'unsupported_live_ap2_settlement', reasonCodes: ['settlement_finality_claim_rejected'], roundTrip: false },
    },
    {
      kind: 'ingestion',
      case: 'pan_credential_leak_rejected',
      description: 'PAN- or credential-shaped material anywhere in the mandate is rejected',
      mandateKey: 'panLeakMandate',
      expected: { supportState: 'unsupported_live_ap2_settlement', reasonCodes: ['mandate_contains_credentials'], roundTrip: false },
    },
    {
      kind: 'tamper',
      case: 'tampered_payload_hash_mismatch',
      description: 'editing the cart total after ingestion makes the hash recomputation fail — tamper evidence on either side',
      mandateKey: 'checkoutClosedPaymentClosedValid',
      tamper: (mandate) => {
        if (mandate.cart) mandate.cart.total.amount = '26.00';
      },
      expected: { failedCheckId: 'mandate_hash_recomputes' },
    },
    {
      kind: 'composition',
      case: 'mandate_wider_cap_local_wins',
      description: 'a mandate cap (5000 centi-units = 50.00) wider than the local cap (4000 = 40.00) never widens local authority — the composed cap is the local cap',
      mandateKey: 'checkoutClosedPaymentClosedValid',
      localPolicy: () => ap2LocalBuyerAuthorityPolicyFixture(),
      expected: {
        ok: true,
        reasonCodes: ['ap2_composition_ok', 'mandate_cap_wider_than_local_cap', 'mandate_expiry_later_than_local'],
        composedCapUnits: '4000',
      },
    },
    {
      kind: 'composition',
      case: 'mandate_tighter_cap_narrows',
      description: 'a mandate cap (5000 centi-units = 50.00) tighter than the local cap (10000 = 100.00) narrows the composed cap to the mandate cap',
      mandateKey: 'checkoutClosedPaymentClosedValid',
      localPolicy: () => ap2LocalBuyerAuthorityPolicyFixture({
        spendCaps: [{ asset: 'USDC', network: AP2_AUTHORIZATION_NETWORK, maxAmountUnits: '10000', window: 'per_request' }],
      }),
      expected: {
        ok: true,
        reasonCodes: ['ap2_composition_ok', 'mandate_expiry_later_than_local'],
        composedCapUnits: '5000',
      },
    },
    {
      kind: 'composition',
      case: 'merchant_not_allowlisted_blocks',
      description: 'a mandate merchant outside the local seller allowlist blocks composition — a mandate never widens local authority',
      mandateKey: 'checkoutClosedPaymentClosedValid',
      localPolicy: () => ap2LocalBuyerAuthorityPolicyFixture({
        sellerAllowlist: {
          sellerIds: ['ap2-merchant:seller:other-writer'],
          endpointIds: ['ap2-merchant-endpoint:seller:other-writer'],
        },
      }),
      expected: { ok: false, reasonCodes: ['mandate_merchant_not_allowlisted_locally'] },
    },
    {
      kind: 'composition',
      case: 'currency_not_permitted_blocks',
      description: 'a mandate currency outside the local allowed currencies blocks composition',
      mandateKey: 'checkoutClosedPaymentClosedValid',
      localPolicy: () => ap2LocalBuyerAuthorityPolicyFixture({
        allowedCurrencies: ['AUDD'],
        allowedRails: [{ asset: 'AUDD', network: AP2_AUTHORIZATION_NETWORK, supportStates: ['proof-metadata-only'] }],
        spendCaps: [{ asset: 'AUDD', network: AP2_AUTHORIZATION_NETWORK, maxAmountUnits: '40.00', window: 'per_request' }],
      }),
      expected: { ok: false, reasonCodes: ['mandate_currency_not_permitted_locally'] },
    },
    {
      kind: 'composition',
      case: 'missing_local_cap_blocks',
      description: 'absence of a local AP2-lane cap never becomes unlimited authority — composition blocks',
      mandateKey: 'checkoutClosedPaymentClosedValid',
      localPolicy: () => ap2LocalBuyerAuthorityPolicyFixture({
        spendCaps: [{ asset: 'USDC', network: 'solana-devnet', maxAmountUnits: '2500000', window: 'per_request' }],
      }),
      expected: { ok: false, reasonCodes: ['local_cap_missing_for_mandate_currency'] },
    },
    {
      kind: 'composition',
      case: 'probe_only_mandate_never_composes',
      description: 'a probe-only mandate authorized nothing and never composes with a local policy',
      mandateKey: 'paymentOpenProbeOnly',
      localPolicy: () => ap2LocalBuyerAuthorityPolicyFixture(),
      expected: { ok: false, reasonCodes: ['mandate_not_authorizing'] },
    },
    {
      kind: 'composition',
      case: 'human_not_present_escalates_approval',
      description: 'a human-not-present mandate escalates operator approval on the composed policy; approval never de-escalates',
      mandateKey: 'humanNotPresent',
      localPolicy: () => ap2LocalBuyerAuthorityPolicyFixture(),
      expected: {
        ok: true,
        reasonCodes: ['ap2_composition_ok', 'mandate_cap_wider_than_local_cap', 'mandate_expiry_later_than_local', 'operator_approval_escalated'],
        composedCapUnits: '4000',
      },
    },
    {
      kind: 'binding',
      case: 'authorizing_ref_binds',
      description: 'an authorizing mandate ref binds onto a receipt as non-secret provenance (hash + type + support-state) and the receipt still validates',
      ref: () => authorizedRef('checkoutClosedPaymentClosedValid'),
      expected: { ok: true, reasonCodes: ['ap2_mandate_ref_bound'] },
    },
    {
      kind: 'binding',
      case: 'probe_only_ref_never_binds',
      description: 'a probe-only ref never binds — a probe-only mandate authorized nothing',
      ref: () => authorizedRef('paymentOpenProbeOnly'),
      expected: { ok: false, reasonCodes: ['probe_only_ref_not_bindable'] },
    },
    {
      kind: 'binding',
      case: 'rejected_ref_never_binds',
      description: 'a rejected mandate ref (settlement claim) never binds to a receipt',
      ref: () => authorizedRef('settlementClaimMandate'),
      expected: { ok: false, reasonCodes: ['rejected_mandate_ref_not_bindable'] },
    },
    {
      kind: 'binding',
      case: 'signature_bearing_ref_rejected',
      description: 'a ref smuggling signature material never binds — receipts never carry signature material',
      ref: () => ({
        ...authorizedRef('checkoutClosedPaymentClosedValid'),
        mandateSignature: 'eyJhbGciOiJFUzI1NiJ9.eyJyZWYiOiJsZWFrIn0.c2lnbmF0dXJlLWJ5dGVzLWZpeHR1cmU',
      } as unknown as Ap2MandateRef),
      expected: { ok: false, reasonCodes: ['signature_material_rejected'] },
    },
  ];
}

export type Ap2ConformanceCaseResult = {
  case: string;
  kind: 'ingestion' | 'tamper' | 'composition' | 'binding';
  pass: boolean;
  failures: string[];
  roundTrip?: Ap2RoundTripResult;
};

export type Ap2ConformanceSuiteResult = {
  schemaVersion: typeof AP2_MANDATE_CONFORMANCE_SCHEMA_VERSION;
  ok: boolean;
  cases: Ap2ConformanceCaseResult[];
};

/**
 * Execute every conformance fixture offline and verify its expectation:
 * ingestion fixtures assert support state + exact reason codes (+ full source
 * round-trip where expected); the tamper fixture asserts hash-mismatch
 * detection; composition fixtures prove the local policy always wins or
 * blocks (including via the real `evaluateBuyerAuthorityPolicy` gate); binding
 * fixtures assert the fail-closed receipt-reference contract. Pure and
 * deterministic — safe to run anywhere, no live access of any kind.
 */
export function runAp2MandateConformanceSuite(): Ap2ConformanceSuiteResult {
  const cases: Ap2ConformanceCaseResult[] = [];

  for (const fixture of listAp2ConformanceFixtures()) {
    const failures: string[] = [];
    let roundTrip: Ap2RoundTripResult | undefined;

    if (fixture.kind === 'ingestion') {
      const mandate = structuredClone(ap2MandateFixtures[fixture.mandateKey]) as Ap2MandateFixture;
      const result = ingestAp2Mandate(mandate, NOW);
      if (result.supportState !== fixture.expected.supportState) {
        failures.push(`expected supportState=${fixture.expected.supportState}, got ${result.supportState}`);
      }
      for (const code of fixture.expected.reasonCodes) {
        if (!result.reasonCodes.includes(code)) failures.push(`missing expected reason code ${code}`);
      }
      if (result.mandateRef.settlementFinalityClaimed !== false) {
        failures.push('mandateRef must never claim settlement finality');
      }
      if (fixture.expected.roundTrip) {
        roundTrip = verifyAp2IngestionAgainstMandate(result, mandate);
        if (!roundTrip.ok) {
          for (const failed of roundTrip.checks.filter((entry) => !entry.ok)) {
            failures.push(`round-trip check ${failed.id} failed: ${failed.detail}`);
          }
        }
      } else if (result.derived !== null) {
        failures.push('a fail-closed / probe-only ingestion must derive no authorization');
      }
      cases.push({ case: fixture.case, kind: fixture.kind, pass: failures.length === 0, failures, roundTrip });
      continue;
    }

    if (fixture.kind === 'tamper') {
      const mandate = structuredClone(ap2MandateFixtures[fixture.mandateKey]) as Ap2MandateFixture;
      const result = ingestAp2Mandate(mandate, NOW);
      const tampered = structuredClone(mandate) as Ap2MandateFixture;
      fixture.tamper(tampered);
      roundTrip = verifyAp2IngestionAgainstMandate(result, tampered);
      if (roundTrip.ok) {
        failures.push('round-trip must fail against a tampered mandate');
      }
      const failedIds = roundTrip.checks.filter((entry) => !entry.ok).map((entry) => entry.id);
      if (!failedIds.includes(fixture.expected.failedCheckId)) {
        failures.push(`expected failed check ${fixture.expected.failedCheckId}, got [${failedIds.join(',')}]`);
      }
      cases.push({ case: fixture.case, kind: fixture.kind, pass: failures.length === 0, failures, roundTrip });
      continue;
    }

    if (fixture.kind === 'composition') {
      const mandate = structuredClone(ap2MandateFixtures[fixture.mandateKey]) as Ap2MandateFixture;
      const ingestion = ingestAp2Mandate(mandate, NOW);
      const local = fixture.localPolicy();
      const composition = composeAp2MandateWithLocalPolicy(local, ingestion);
      if (composition.ok !== fixture.expected.ok) {
        failures.push(`expected ok=${fixture.expected.ok}, got ${composition.ok}`);
      }
      for (const code of fixture.expected.reasonCodes) {
        if (!composition.reasonCodes.includes(code)) failures.push(`missing expected reason code ${code}`);
      }
      if (!fixture.expected.ok && composition.composedPolicy !== null) {
        failures.push('a blocked composition must not emit a composed policy');
      }
      if (fixture.expected.ok && composition.composedPolicy !== null) {
        const composed = composition.composedPolicy;
        const localCap = local.spendCaps.find((cap) => cap.network === AP2_AUTHORIZATION_NETWORK);
        const composedCap = composed.spendCaps[0];
        if (fixture.expected.composedCapUnits !== undefined && composedCap?.maxAmountUnits !== fixture.expected.composedCapUnits) {
          failures.push(`expected composed cap ${fixture.expected.composedCapUnits}, got ${composedCap?.maxAmountUnits}`);
        }
        // NEVER-WIDEN invariants, proven numerically inside the shared fixture unit space.
        if (localCap && Number(composedCap?.maxAmountUnits) > Number(localCap.maxAmountUnits)) {
          failures.push('composed cap exceeds the local cap — the mandate widened local authority');
        }
        if (Date.parse(composed.expiresAt) > Date.parse(local.expiresAt)) {
          failures.push('composed expiry is later than the local expiry — the mandate widened local authority');
        }
        if (!composed.allowedCurrencies.every((asset) => local.allowedCurrencies.includes(asset))) {
          failures.push('composed currencies escape the local currency set');
        }
        if (!composed.sellerAllowlist.sellerIds.every((id) => local.sellerAllowlist.sellerIds.includes(id))) {
          failures.push('composed seller allowlist escapes the local allowlist');
        }
        if (local.operatorApproval.required && !composed.operatorApproval.required) {
          failures.push('composition de-escalated operator approval');
        }
        // The composed policy must be enforceable by the real buyer-authority gate:
        // a request just above the composed cap is denied.
        const overCap = evaluateBuyerAuthorityPolicy(composed, {
          sellerId: composed.sellerAllowlist.sellerIds[0],
          endpointId: composed.sellerAllowlist.endpointIds[0],
          asset: composed.allowedCurrencies[0],
          network: AP2_AUTHORIZATION_NETWORK,
          amountUnits: String(BigInt(composedCap?.maxAmountUnits ?? '0') + 1n),
          supportState: 'proof-metadata-only',
          receiptPresented: true,
          evidencePresented: true,
          now: NOW,
          operatorApprovalState: 'approved',
        });
        if (overCap.allowed || !overCap.reasonCodes.includes('spend_cap_exceeded')) {
          failures.push('the real buyer-authority gate must deny a request above the composed cap');
        }
      }
      cases.push({ case: fixture.case, kind: fixture.kind, pass: failures.length === 0, failures });
      continue;
    }

    // kind === 'binding'
    const ref = fixture.ref();
    const receipt = structuredClone(reddiReceiptFixtures.happyPath);
    const binding = bindMandateToReceipt(receipt, ref);
    if (binding.ok !== fixture.expected.ok) {
      failures.push(`expected ok=${fixture.expected.ok}, got ${binding.ok}`);
    }
    for (const code of fixture.expected.reasonCodes) {
      if (!binding.reasonCodes.includes(code)) failures.push(`missing expected reason code ${code}`);
    }
    if (!fixture.expected.ok && binding.receipt !== null) {
      failures.push('a fail-closed binding must not emit a receipt');
    }
    if (fixture.expected.ok && binding.receipt !== null) {
      const bound = binding.receipt;
      const validation = validateReddiReceipt(bound);
      if (!validation.ok) failures.push('the bound receipt must still pass reddi.receipt.v1 validation');
      const bindingMeta = bound.metadata?.ap2MandateRef as Record<string, unknown> | undefined;
      if (!bindingMeta || bindingMeta.mandateHash !== ref.mandateHash) {
        failures.push('the bound receipt must carry the mandate hash reference');
      }
      const boundSerialized = JSON.stringify(bound);
      if (boundSerialized.includes('signatureB64') || /\bey[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/.test(boundSerialized)) {
        failures.push('the bound receipt must never carry signature material');
      }
      if (bindingMeta && bindingMeta.settlementFinalityClaimed !== false) {
        failures.push('the receipt binding must never claim settlement finality');
      }
    }
    cases.push({ case: fixture.case, kind: fixture.kind, pass: failures.length === 0, failures });
  }

  return {
    schemaVersion: AP2_MANDATE_CONFORMANCE_SCHEMA_VERSION,
    ok: cases.every((entry) => entry.pass),
    cases,
  };
}
