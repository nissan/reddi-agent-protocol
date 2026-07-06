import type { AuddPaymentPlanPreflightDecision } from './audd-payment-plan.js';
import {
  airwallexWebhookFixtures,
  type AirwallexWebhookFixture,
} from './airwallex-webhook-receipt-normalization.js';
import {
  createEvidenceArchiveRecord,
  type EvidenceArchiveRecord,
} from './evidence-archive.js';
import {
  mppTempoReceiptShapeFixtures,
  type MppTempoReceiptShapeFixture,
} from './mpp-tempo-receipt-shapes.js';
import {
  payShSandboxEvidenceFixtures,
  type PayShSandboxEvidenceFixture,
} from './pay-sh-sandbox-evidence.js';
import { policyDecisionFromBudgetPolicyDecision } from './policy.js';
import {
  createRailNeutralPaymentReceipt,
  deriveRailNeutralPaymentReceipt,
  type RailNeutralPaymentReceipt,
  type RailNeutralPaymentReceiptError,
  type RailNeutralPaymentReceiptInput,
  type RailNeutralPaymentReceiptOptions,
} from './rail-neutral-payment-receipts.js';
import {
  createReceiptEvidenceBinding,
  type ReceiptEvidenceBinding,
} from './receipt-evidence-binding.js';
import {
  createReddiReceipt,
  type ReddiReceipt,
} from './receipts.js';

export const RAIL_NEUTRAL_PROOF_CHAIN_FIXTURE_SCHEMA_VERSION = 'reddi.rail-neutral-proof-chain-fixture.v1' as const;

export type RailNeutralProofChainFixtureCase =
  | 'pay_sh_sandbox_single_charge_binding'
  | 'mpp_tempo_unsupported_network'
  | 'unsupported_asset_network'
  | 'malformed_receipt'
  | 'policy_denied'
  | 'live_path_overclaim'
  | 'airwallex_webhook_probe_only_cap';

export type RailNeutralProofChainFixtureStatus = 'binding_ready' | 'blocked';

export type RailNeutralProofChainFixtureGuardrails = {
  fixtureOnly: true;
  rawPromptStored: false;
  rawOutputStored: false;
  credentialMaterialStored: false;
  walletSigning: false;
  rpcCall: false;
  providerCall: false;
  paidRequest: false;
  sandboxExecution: false;
  hostedRegistryWrite: false;
  marketplacePublication: false;
  trustUpgrade: false;
  reputationMutation: false;
  custodyClaim: false;
  settlementFinalityProof: false;
  livePayment: false;
};

export type RailNeutralProofChainFailure = {
  code: RailNeutralPaymentReceiptError['code'];
  path: string;
  message: string;
};

export type RailNeutralProofChainSourceRef = {
  rail: RailNeutralPaymentReceiptInput['rail'];
  case: string;
  sourceId: string;
  artifactPath: string;
};

export type RailNeutralProofChainFixture = {
  schemaVersion: typeof RAIL_NEUTRAL_PROOF_CHAIN_FIXTURE_SCHEMA_VERSION;
  case: RailNeutralProofChainFixtureCase;
  status: RailNeutralProofChainFixtureStatus;
  sourceRef: RailNeutralProofChainSourceRef;
  railNeutralReceipt?: RailNeutralPaymentReceipt;
  redactedReceipt?: ReddiReceipt;
  evidence?: EvidenceArchiveRecord;
  binding?: ReceiptEvidenceBinding;
  blockedBy?: RailNeutralProofChainFailure[];
  bindingRefs: {
    sourceRef: string;
    quoteRef?: string;
    paymentProofRef?: string;
    requestHash?: string;
    responseHash?: string;
    evidenceRef?: string;
    nonceRef?: string;
    recipientRef?: string;
    operatorApprovalRef?: string;
  };
  claimBoundaryLabels: string[];
  guardrails: RailNeutralProofChainFixtureGuardrails;
};

export type RailNeutralProofChainFixtureInput = {
  case: RailNeutralProofChainFixtureCase;
  receiptInput: RailNeutralPaymentReceiptInput;
  options?: RailNeutralPaymentReceiptOptions;
  createdAt?: string;
};

export const RAIL_NEUTRAL_PROOF_CHAIN_FIXTURE_GUARDRAILS: RailNeutralProofChainFixtureGuardrails = {
  fixtureOnly: true,
  rawPromptStored: false,
  rawOutputStored: false,
  credentialMaterialStored: false,
  walletSigning: false,
  rpcCall: false,
  providerCall: false,
  paidRequest: false,
  sandboxExecution: false,
  hostedRegistryWrite: false,
  marketplacePublication: false,
  trustUpgrade: false,
  reputationMutation: false,
  custodyClaim: false,
  settlementFinalityProof: false,
  livePayment: false,
};

const CREATED_AT = '2026-06-22T10:20:00.000Z';
const SPECIALIST_ID = 'pay-sh:reddi-x402-economic-demo';
const PAYER_ID = 'buyer:fixture';

export function createRailNeutralProofChainFixture(input: RailNeutralProofChainFixtureInput): RailNeutralProofChainFixture {
  const result = deriveRailNeutralPaymentReceipt(input.receiptInput, input.options);
  const refs = bindingRefsFromInput(input.receiptInput.fixture);

  if (!result.ok) {
    return blockedFixture(input.case, input.receiptInput.fixture, refs, result.errors);
  }

  const receipt = result.receipt;

  // Fail-closed probe-only cap (#580): only receipt_binding_candidate receipts
  // may bridge into a redacted reddi.receipt.v1. probe_only receipts (e.g.
  // Airwallex webhook fixtures — revocable card-rail receipts with no
  // receipt-v1 revoked/contested state, a documented #338 gap) must NEVER
  // produce a receipt v1 envelope, an evidence record, or a binding.
  if (receipt.supportState !== 'receipt_binding_candidate') {
    return blockedFixture(input.case, input.receiptInput.fixture, refs, [{
      code: 'unsupported_fixture_state',
      path: '$.receipt.supportState',
      message: `rail-neutral receipt supportState '${receipt.supportState}' is capped below receipt_binding_candidate; `
        + 'probe_only receipts never bridge into reddi.receipt.v1 (revocable rails have no receipt-v1 revoked/contested state — #338 gap)',
    }]);
  }

  const createdAt = input.createdAt ?? CREATED_AT;
  const policyDecision = policyDecisionFromBudgetPolicyDecision({
    allowed: true,
    reasonCodes: ['allowed'],
    quotedAmount: {
      amount: receipt.payment.amount,
      asset: receipt.payment.asset,
      network: receipt.payment.network,
      source: receipt.source.sourceId,
      specialist: SPECIALIST_ID,
    },
    remainingBudget: { perRequest: receipt.payment.amount },
    auditNotes: ['Allowed by fixture-only rail-neutral proof-chain bridge.'],
  });

  const redactedReceipt = createReddiReceipt({
    schemaVersion: 'reddi.receipt.v1',
    job: { id: `job:${receipt.rail}:${receipt.case}`, type: 'fixture-only-rail-neutral-proof-chain' },
    source: {
      id: receipt.source.sourceId,
      type: receipt.source.kind,
      uri: receipt.source.catalogRef ?? receipt.source.fixtureRef ?? receipt.source.rawSnapshotRef,
    },
    payer: { id: PAYER_ID },
    specialist: { id: SPECIALIST_ID },
    protocol: { name: 'Reddi Agent Protocol', version: '0.1.0' },
    payment: {
      network: receipt.payment.network,
      asset: receipt.payment.asset,
      amount: receipt.payment.amount,
      paymentProofRef: receipt.payment.paymentProofRef,
    },
    requestHash: receipt.bindingRefs.requestHash,
    responseHash: receipt.bindingRefs.responseHash,
    evidenceRef: receipt.bindingRefs.evidenceRef,
    policyDecision,
    attestationStatus: 'not_requested',
    createdAt,
    metadata: {
      rail: receipt.rail,
      railNeutralReceiptSchema: receipt.schemaVersion,
      supportState: receipt.supportState,
      receiptRef: receipt.payment.receiptRef,
      quoteRef: refs.quoteRef,
      nonceRef: receipt.bindingRefs.nonceRef,
      recipientRef: receipt.bindingRefs.recipientRef,
      operatorApprovalRef: receipt.bindingRefs.operatorApprovalRef,
      claimBoundaryLabels: receipt.claimBoundary,
    },
  });

  const evidencePayload = {
    schemaVersion: RAIL_NEUTRAL_PROOF_CHAIN_FIXTURE_SCHEMA_VERSION,
    railNeutralReceipt: {
      schemaVersion: receipt.schemaVersion,
      rail: receipt.rail,
      case: receipt.case,
      supportState: receipt.supportState,
      sourceId: receipt.source.sourceId,
      payment: receipt.payment,
      bindingRefs: receipt.bindingRefs,
      claimBoundaryLabels: receipt.claimBoundary,
    },
    redaction: {
      rawPromptStored: false,
      rawOutputStored: false,
      credentialMaterialStored: false,
      providerResponseBodyStored: false,
      walletKeyStored: false,
      rpcUrlStored: false,
    },
  };

  const evidence = createEvidenceArchiveRecord({
    id: `evidence:${receipt.rail}:${receipt.case}`,
    receiptId: redactedReceipt.job.id,
    sourceId: receipt.source.sourceId,
    requestHash: receipt.bindingRefs.requestHash,
    responseHash: receipt.bindingRefs.responseHash,
    evidenceRef: receipt.bindingRefs.evidenceRef,
    evidencePayload,
    createdAt,
    metadata: {
      railNeutralReceiptSchema: receipt.schemaVersion,
      operatorApprovalRef: receipt.bindingRefs.operatorApprovalRef,
      fixtureOnly: true,
    },
  });

  const paymentPreflight = {
    allowed: true,
    reasonCodes: ['audd_payment_plan_allowed'],
    paymentProofRef: receipt.payment.paymentProofRef,
    policyDecision,
    paymentPlan: {
      schemaVersion: 'reddi.audd-payment-plan.v1',
      asset: receipt.payment.asset,
      network: receipt.payment.network,
      mint: 'fixture-mint:rail-neutral-usdc',
      payee: receipt.bindingRefs.recipientRef,
      settlementAccount: 'fixture-settlement:rail-neutral-proof-chain',
      amount: receipt.payment.amount,
      quoteExpiresAt: '2026-06-22T11:20:00.000Z',
      failurePolicy: { mode: 'no_charge_on_failure', description: 'Fixture bridge never charges.' },
      refundPolicy: { mode: 'manual_review', description: 'Fixture bridge has no live refund path.' },
      evidenceRequired: true,
      paymentMode: 'dry-run',
    },
    auditNotes: ['Structural fixture bridge for receipt/evidence binding; no AUDD or live payment path is invoked.'],
  } as unknown as AuddPaymentPlanPreflightDecision;

  const binding = createReceiptEvidenceBinding({
    id: `binding:${receipt.rail}:${receipt.case}`,
    source: receipt.source,
    receipt: redactedReceipt,
    evidence,
    evidencePayload,
    paymentPreflight,
    createdAt,
  });

  return {
    schemaVersion: RAIL_NEUTRAL_PROOF_CHAIN_FIXTURE_SCHEMA_VERSION,
    case: input.case,
    status: 'binding_ready',
    sourceRef: sourceRefFromInput(input.receiptInput),
    railNeutralReceipt: receipt,
    redactedReceipt,
    evidence,
    binding,
    bindingRefs: {
      ...refs,
      paymentProofRef: receipt.payment.paymentProofRef,
      requestHash: receipt.bindingRefs.requestHash,
      responseHash: receipt.bindingRefs.responseHash,
      evidenceRef: receipt.bindingRefs.evidenceRef,
      nonceRef: receipt.bindingRefs.nonceRef,
      recipientRef: receipt.bindingRefs.recipientRef,
      operatorApprovalRef: receipt.bindingRefs.operatorApprovalRef,
    },
    claimBoundaryLabels: receipt.claimBoundary,
    guardrails: RAIL_NEUTRAL_PROOF_CHAIN_FIXTURE_GUARDRAILS,
  };
}

export const railNeutralProofChainFixtures = {
  payShSandboxSingleChargeBinding: createRailNeutralProofChainFixture({
    case: 'pay_sh_sandbox_single_charge_binding',
    receiptInput: { rail: 'pay-sh-sandbox', fixture: payShSandboxEvidenceFixtures.singleCharge },
  }),
  mppTempoUnsupportedNetwork: createRailNeutralProofChainFixture({
    case: 'mpp_tempo_unsupported_network',
    receiptInput: { rail: 'mpp-tempo', fixture: mppTempoReceiptShapeFixtures.tempoSingleChargeCandidate },
  }),
  unsupportedAssetNetwork: createRailNeutralProofChainFixture({
    case: 'unsupported_asset_network',
    receiptInput: { rail: 'pay-sh-sandbox', fixture: payShSandboxEvidenceFixtures.singleCharge },
    options: { networkOverride: 'base-mainnet' },
  }),
  malformedReceipt: createRailNeutralProofChainFixture({
    case: 'malformed_receipt',
    receiptInput: {
      rail: 'pay-sh-sandbox',
      fixture: {
        ...payShSandboxEvidenceFixtures.singleCharge,
        receipt: undefined,
      },
    },
  }),
  policyDenied: createRailNeutralProofChainFixture({
    case: 'policy_denied',
    receiptInput: { rail: 'pay-sh-sandbox', fixture: payShSandboxEvidenceFixtures.singleCharge },
    options: {
      policy: {
        allowed: false,
        reasonCodes: ['operator_denied'],
        auditNotes: ['Operator denied this fixture-only proof-chain bridge.'],
      },
    },
  }),
  airwallexWebhookProbeOnlyCap: createRailNeutralProofChainFixture({
    case: 'airwallex_webhook_probe_only_cap',
    receiptInput: { rail: 'airwallex-hosted-checkout', fixture: airwallexWebhookFixtures.paymentIntentSucceeded },
  }),
  livePathOverclaim: createRailNeutralProofChainFixture({
    case: 'live_path_overclaim',
    receiptInput: {
      rail: 'pay-sh-sandbox',
      fixture: {
        ...payShSandboxEvidenceFixtures.singleCharge,
        claimBoundary: [
          'provider call performed with hosted registry write completed, trust upgrade performed, reputation mutation performed, settlement finality proven, custody accepted, and live Pay.sh activation',
        ],
      },
    },
  }),
} as const;

function blockedFixture(
  fixtureCase: RailNeutralProofChainFixtureCase,
  sourceFixture: RailNeutralPaymentReceiptInput['fixture'],
  refs: RailNeutralProofChainFixture['bindingRefs'],
  errors: RailNeutralPaymentReceiptError[],
): RailNeutralProofChainFixture {
  return {
    schemaVersion: RAIL_NEUTRAL_PROOF_CHAIN_FIXTURE_SCHEMA_VERSION,
    case: fixtureCase,
    status: 'blocked',
    sourceRef: sourceRefFromFixture(refs.sourceRef, sourceFixture),
    blockedBy: errors.map((item) => ({
      code: item.code,
      path: item.path,
      message: blockedMessage(item),
    })),
    bindingRefs: refs,
    claimBoundaryLabels: [
      'Fail-closed fixture state only.',
      'No Reddi receipt v1 settlement proof, custody, trust upgrade, reputation mutation, marketplace publication, provider execution, wallet signing, RPC, spend, sandbox execution, or live payment is claimed.',
    ],
    guardrails: RAIL_NEUTRAL_PROOF_CHAIN_FIXTURE_GUARDRAILS,
  };
}

function blockedMessage(error: RailNeutralPaymentReceiptError): string {
  if (error.code === 'live_path_rejected') {
    return 'Rail-neutral proof-chain fixture rejected imported live-path overclaim text.';
  }
  return error.message;
}

function sourceRefFromInput(input: RailNeutralPaymentReceiptInput): RailNeutralProofChainSourceRef {
  const refs = bindingRefsFromInput(input.fixture);
  return sourceRefFromFixture(refs.sourceRef, input.fixture, input.rail);
}

function sourceRefFromFixture(
  sourceId: string,
  fixture: RailNeutralPaymentReceiptInput['fixture'],
  rail?: RailNeutralPaymentReceiptInput['rail'],
): RailNeutralProofChainSourceRef {
  if (isAirwallexWebhookFixture(fixture)) {
    return {
      rail: rail ?? 'airwallex-hosted-checkout',
      case: fixture.event?.name ?? 'airwallex_webhook_fixture',
      sourceId,
      artifactPath: fixture.bindingRefs?.evidenceRef ?? 'fixture:artifact:airwallex-webhook',
    };
  }
  return {
    rail: rail ?? (isPayShSandboxEvidenceFixture(fixture) ? 'pay-sh-sandbox' : 'mpp-tempo'),
    case: fixture.case,
    sourceId,
    artifactPath: fixture.artifactPath,
  };
}

function bindingRefsFromInput(
  fixture: RailNeutralPaymentReceiptInput['fixture'],
): RailNeutralProofChainFixture['bindingRefs'] {
  if (isAirwallexWebhookFixture(fixture)) return {
    sourceRef: `airwallex-webhook-fixture:${fixture.event?.id ?? 'malformed'}`,
    requestHash: fixture.bindingRefs?.requestHash,
    responseHash: fixture.bindingRefs?.responseHash,
    evidenceRef: fixture.bindingRefs?.evidenceRef,
    nonceRef: fixture.bindingRefs?.nonceRef,
    recipientRef: fixture.bindingRefs?.recipientRef,
    operatorApprovalRef: fixture.bindingRefs?.operatorApprovalRef,
  };
  if (isPayShSandboxEvidenceFixture(fixture)) return {
    sourceRef: fixture.bindingRefs.source.sourceId,
    quoteRef: fixture.bindingRefs.quoteRef,
    paymentProofRef: fixture.bindingRefs.paymentProofRef,
    requestHash: fixture.bindingRefs.requestHash,
    responseHash: fixture.bindingRefs.responseHash,
    evidenceRef: fixture.bindingRefs.evidenceRef,
    nonceRef: fixture.bindingRefs.nonceRef,
    recipientRef: fixture.bindingRefs.recipientRef,
    operatorApprovalRef: fixture.bindingRefs.operatorApprovalRef,
  };
  return {
    sourceRef: fixture.bindingRefs.sourceId,
    paymentProofRef: fixture.bindingRefs.paymentProofRef,
    requestHash: fixture.bindingRefs.requestHash,
    responseHash: fixture.bindingRefs.responseHash,
    evidenceRef: fixture.bindingRefs.evidenceRef,
    nonceRef: fixture.bindingRefs.nonceRef,
    recipientRef: fixture.bindingRefs.recipientRef,
    operatorApprovalRef: fixture.bindingRefs.operatorApprovalRef,
  };
}

function isAirwallexWebhookFixture(
  fixture: RailNeutralPaymentReceiptInput['fixture'],
): fixture is AirwallexWebhookFixture {
  return (fixture as AirwallexWebhookFixture)?.rail === 'airwallex-hosted-checkout';
}

function isPayShSandboxEvidenceFixture(
  fixture: PayShSandboxEvidenceFixture | MppTempoReceiptShapeFixture,
): fixture is PayShSandboxEvidenceFixture {
  return 'source' in fixture.bindingRefs;
}
