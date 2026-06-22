import type {
  PayShSandboxEvidenceFixture,
} from './pay-sh-sandbox-evidence.js';
import type {
  MppTempoReceiptShapeFixture,
} from './mpp-tempo-receipt-shapes.js';
import type { ReceiptEvidenceSourceRef } from './receipt-evidence-binding.js';

export const RAIL_NEUTRAL_PAYMENT_RECEIPT_SCHEMA_VERSION = 'reddi.rail-neutral-payment-receipt.v1' as const;

export type RailNeutralPaymentReceiptRail = 'pay-sh-sandbox' | 'mpp-tempo';

export type RailNeutralPaymentReceiptSupportState =
  | 'receipt_binding_candidate'
  | 'probe_only'
  | 'unsupported_receipt_v1_network';

export type RailNeutralPaymentReceiptGuardrails = {
  fixtureOnly: true;
  livePaymentExecuted: false;
  walletSigning: false;
  rpcCall: false;
  providerCall: false;
  hostedRegistryWrite: false;
  marketplacePublication: false;
  trustUpgrade: false;
  reputationMutation: false;
  settlementProof: false;
  custodyClaim: false;
};

export type RailNeutralPaymentReceiptPolicyInput = {
  allowed: boolean;
  reasonCodes: string[];
  auditNotes?: string[];
};

export type RailNeutralPaymentReceiptOptions = {
  policy?: RailNeutralPaymentReceiptPolicyInput;
  networkOverride?: string;
  assetOverride?: string;
};

export type RailNeutralPaymentReceipt = {
  schemaVersion: typeof RAIL_NEUTRAL_PAYMENT_RECEIPT_SCHEMA_VERSION;
  rail: RailNeutralPaymentReceiptRail;
  case: string;
  supportState: RailNeutralPaymentReceiptSupportState;
  source: ReceiptEvidenceSourceRef;
  payment: {
    network: string;
    asset: string;
    amount: string;
    unit: 'microusd' | 'base-units';
    paymentProofRef: string;
    receiptRef?: string;
  };
  bindingRefs: {
    evidenceRef: string;
    requestHash: string;
    responseHash: string;
    recipientRef: string;
    nonceRef: string;
    operatorApprovalRef: string;
  };
  policy: {
    allowed: true;
    reasonCodes: string[];
    auditNotes: string[];
  };
  bindingIntegration: {
    schemaVersion: 'reddi.receipt-evidence-binding.v1';
    compatible: true;
    requiredReceiptSchemaVersion: 'reddi.receipt.v1';
  };
  claimBoundary: string[];
  guardrails: RailNeutralPaymentReceiptGuardrails;
};

export type RailNeutralPaymentReceiptInput =
  | { rail: 'pay-sh-sandbox'; fixture: PayShSandboxEvidenceFixture }
  | { rail: 'mpp-tempo'; fixture: MppTempoReceiptShapeFixture };

export type RailNeutralPaymentReceiptErrorCode =
  | 'malformed_receipt'
  | 'unsupported_asset_network'
  | 'policy_denied'
  | 'unsupported_fixture_state'
  | 'live_path_rejected';

export type RailNeutralPaymentReceiptError = {
  code: RailNeutralPaymentReceiptErrorCode;
  path: string;
  message: string;
};

export type RailNeutralPaymentReceiptResult =
  | { ok: true; receipt: RailNeutralPaymentReceipt }
  | { ok: false; errors: RailNeutralPaymentReceiptError[] };

export const RAIL_NEUTRAL_PAYMENT_RECEIPT_GUARDRAILS: RailNeutralPaymentReceiptGuardrails = {
  fixtureOnly: true,
  livePaymentExecuted: false,
  walletSigning: false,
  rpcCall: false,
  providerCall: false,
  hostedRegistryWrite: false,
  marketplacePublication: false,
  trustUpgrade: false,
  reputationMutation: false,
  settlementProof: false,
  custodyClaim: false,
};

const RECEIPT_V1_SUPPORTED_NETWORK_ASSETS = new Set([
  'solana-devnet:USDC',
  'solana-testnet:USDC',
  'solana-mainnet-beta:USDC',
]);
const PAY_SH_SINGLE_CHARGE_MICRO_USD = '10000';

export function createRailNeutralPaymentReceipt(
  input: RailNeutralPaymentReceiptInput,
  options: RailNeutralPaymentReceiptOptions = {},
): RailNeutralPaymentReceipt {
  const result = deriveRailNeutralPaymentReceipt(input, options);
  if (!result.ok) {
    throw new Error(`invalid_rail_neutral_payment_receipt:${result.errors.map((item) => `${item.code}:${item.path}`).join(',')}`);
  }
  return result.receipt;
}

export function deriveRailNeutralPaymentReceipt(
  input: RailNeutralPaymentReceiptInput,
  options: RailNeutralPaymentReceiptOptions = {},
): RailNeutralPaymentReceiptResult {
  const errors: RailNeutralPaymentReceiptError[] = [];
  const policy = options.policy ?? {
    allowed: true,
    reasonCodes: ['allowed'],
    auditNotes: ['Rail-neutral receipt normalization is fixture-only.'],
  };

  if (!policy.allowed) {
    errors.push(error('policy_denied', '$.policy.allowed', 'policy denial blocks receipt/evidence binding normalization'));
  }
  if (!Array.isArray(policy.reasonCodes) || policy.reasonCodes.length === 0 || !policy.reasonCodes.every(isNonEmptyString)) {
    errors.push(error('policy_denied', '$.policy.reasonCodes', 'policy reason codes are required'));
  }

  validateNoLivePath(input, errors);

  const candidate = input.rail === 'pay-sh-sandbox'
    ? fromPayShSandbox(input.fixture, options, errors)
    : fromMppTempo(input.fixture, options, errors);

  if (!candidate) return { ok: false, errors };

  const networkAsset = `${candidate.payment.network}:${candidate.payment.asset}`;
  if (!RECEIPT_V1_SUPPORTED_NETWORK_ASSETS.has(networkAsset)) {
    errors.push(error('unsupported_asset_network', '$.payment', `${networkAsset} is not supported by Reddi receipt v1 binding`));
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    receipt: {
      schemaVersion: RAIL_NEUTRAL_PAYMENT_RECEIPT_SCHEMA_VERSION,
      rail: candidate.rail,
      case: candidate.case,
      supportState: 'receipt_binding_candidate',
      source: candidate.source,
      payment: candidate.payment,
      bindingRefs: candidate.bindingRefs,
      policy: {
        allowed: true,
        reasonCodes: policy.reasonCodes,
        auditNotes: policy.auditNotes ?? [],
      },
      bindingIntegration: {
        schemaVersion: 'reddi.receipt-evidence-binding.v1',
        compatible: true,
        requiredReceiptSchemaVersion: 'reddi.receipt.v1',
      },
      claimBoundary: candidate.claimBoundary,
      guardrails: RAIL_NEUTRAL_PAYMENT_RECEIPT_GUARDRAILS,
    },
  };
}

function fromPayShSandbox(
  fixture: PayShSandboxEvidenceFixture,
  options: RailNeutralPaymentReceiptOptions,
  errors: RailNeutralPaymentReceiptError[],
): Omit<RailNeutralPaymentReceipt, 'schemaVersion' | 'supportState' | 'policy' | 'bindingIntegration' | 'guardrails'> | undefined {
  if (fixture.status !== 'proven_single_charge' || fixture.case !== 'single_charge') {
    errors.push(error('unsupported_fixture_state', '$.fixture.status', 'only proven Pay.sh sandbox single-charge evidence can become a binding candidate'));
    return undefined;
  }
  if (!fixture.receipt || fixture.receipt.status !== 'success' || fixture.receipt.method !== 'solana' || !isNonEmptyString(fixture.bindingRefs.receiptRef)) {
    errors.push(error('malformed_receipt', '$.fixture.receipt', 'Pay.sh sandbox single-charge evidence requires a successful Solana receipt ref'));
    return undefined;
  }
  return {
    rail: 'pay-sh-sandbox',
    case: fixture.case,
    source: fixture.bindingRefs.source,
    payment: {
      network: options.networkOverride ?? 'solana-devnet',
      asset: options.assetOverride ?? 'USDC',
      amount: PAY_SH_SINGLE_CHARGE_MICRO_USD,
      unit: 'microusd',
      paymentProofRef: fixture.bindingRefs.paymentProofRef,
      receiptRef: fixture.bindingRefs.receiptRef,
    },
    bindingRefs: {
      evidenceRef: fixture.bindingRefs.evidenceRef,
      requestHash: fixture.bindingRefs.requestHash,
      responseHash: fixture.bindingRefs.responseHash,
      recipientRef: fixture.bindingRefs.recipientRef,
      nonceRef: fixture.bindingRefs.nonceRef,
      operatorApprovalRef: fixture.bindingRefs.operatorApprovalRef,
    },
    claimBoundary: [
      ...fixture.claimBoundary,
      'Rail-neutral normalization does not prove settlement finality, custody, trust, reputation, publication, provider execution, wallet signing, or RPC activity.',
    ],
  };
}

function fromMppTempo(
  fixture: MppTempoReceiptShapeFixture,
  options: RailNeutralPaymentReceiptOptions,
  errors: RailNeutralPaymentReceiptError[],
): Omit<RailNeutralPaymentReceipt, 'schemaVersion' | 'supportState' | 'policy' | 'bindingIntegration' | 'guardrails'> | undefined {
  if (fixture.supportState !== 'binding_candidate' || fixture.case !== 'mpp_single_charge_tempo_candidate') {
    errors.push(error('unsupported_fixture_state', '$.fixture.supportState', 'only MPP Tempo single-charge binding candidates can be normalized'));
    return undefined;
  }
  if (!fixture.receipt || fixture.receipt.status !== 'success' || fixture.receipt.nonce !== fixture.challenge.nonce) {
    errors.push(error('malformed_receipt', '$.fixture.receipt', 'MPP Tempo candidate requires a successful receipt bound to the challenge nonce'));
    return undefined;
  }
  return {
    rail: 'mpp-tempo',
    case: fixture.case,
    source: {
      kind: 'static-fixture',
      sourceId: fixture.bindingRefs.sourceId,
      fixtureRef: fixture.artifactPath,
      rawSnapshotRef: fixture.bindingRefs.challengeRef,
    },
    payment: {
      network: options.networkOverride ?? fixture.challenge.network,
      asset: options.assetOverride ?? fixture.challenge.asset,
      amount: fixture.challenge.amount,
      unit: fixture.challenge.unit,
      paymentProofRef: fixture.bindingRefs.paymentProofRef,
      receiptRef: fixture.receipt.receiptRef,
    },
    bindingRefs: {
      evidenceRef: fixture.bindingRefs.evidenceRef,
      requestHash: fixture.bindingRefs.requestHash,
      responseHash: fixture.bindingRefs.responseHash,
      recipientRef: fixture.bindingRefs.recipientRef,
      nonceRef: fixture.bindingRefs.nonceRef,
      operatorApprovalRef: fixture.bindingRefs.operatorApprovalRef,
    },
    claimBoundary: [
      ...fixture.claimBoundary,
      'Rail-neutral normalization does not accept Tempo as Reddi receipt v1 settlement proof until a separate verifier and network allowlist lane is approved.',
    ],
  };
}

function validateNoLivePath(input: RailNeutralPaymentReceiptInput, errors: RailNeutralPaymentReceiptError[]): void {
  const serialized = JSON.stringify(input).toLowerCase();
  const rejectedMarkers = [
    'wallet_private_key',
    'private_key',
    'rpc_url',
    'provider call completed',
    'provider call performed',
    'hosted-registry-write',
    'hosted registry write completed',
    'hosted registry write performed',
    'marketplace publication completed',
    'marketplace publication performed',
    'trust upgrade completed',
    'trust upgrade performed',
    'reputation mutation completed',
    'reputation mutation performed',
    'custody accepted',
    'settlement finality proven',
    'live payment completed',
    'live pay.sh activation',
    'live tempo payment accepted',
  ];
  for (const marker of rejectedMarkers) {
    if (serialized.includes(marker)) {
      errors.push(error('live_path_rejected', '$', `rail-neutral receipt input contains rejected live-path marker: ${marker}`));
    }
  }
}

function error(code: RailNeutralPaymentReceiptErrorCode, path: string, message: string): RailNeutralPaymentReceiptError {
  return { code, path, message };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
