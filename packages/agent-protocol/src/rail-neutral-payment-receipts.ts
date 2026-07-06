import type {
  PayShSandboxEvidenceFixture,
} from './pay-sh-sandbox-evidence.js';
import type {
  MppTempoReceiptShapeFixture,
} from './mpp-tempo-receipt-shapes.js';
import type { ReceiptEvidenceSourceRef } from './receipt-evidence-binding.js';
import {
  normalizeAirwallexWebhookFixture,
  type AirwallexWebhookFixture,
  type AirwallexWebhookNormalizationReasonCode,
} from './airwallex-webhook-receipt-normalization.js';

export const RAIL_NEUTRAL_PAYMENT_RECEIPT_SCHEMA_VERSION = 'reddi.rail-neutral-payment-receipt.v1' as const;

export type RailNeutralPaymentReceiptRail = 'pay-sh-sandbox' | 'mpp-tempo' | 'airwallex-hosted-checkout';

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
    unit: 'microusd' | 'base-units' | 'fiat-minor-units';
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
  bindingIntegration:
    | {
      schemaVersion: 'reddi.receipt-evidence-binding.v1';
      compatible: true;
      requiredReceiptSchemaVersion: 'reddi.receipt.v1';
    }
    | {
      schemaVersion: 'reddi.receipt-evidence-binding.v1';
      /**
       * probe_only receipts are NOT receipt-v1 binding candidates. Reasons are
       * recorded per-rail (e.g. Airwallex: fiat network outside the receipt v1
       * network table; card receipts revocable with no receipt-v1
       * revoked/contested state — #338 gap; frozen union not widened here).
       */
      compatible: false;
      requiredReceiptSchemaVersion: 'reddi.receipt.v1';
      incompatibilityReasons: string[];
    };
  claimBoundary: string[];
  guardrails: RailNeutralPaymentReceiptGuardrails;
};

export type RailNeutralPaymentReceiptInput =
  | { rail: 'pay-sh-sandbox'; fixture: PayShSandboxEvidenceFixture }
  | { rail: 'mpp-tempo'; fixture: MppTempoReceiptShapeFixture }
  | { rail: 'airwallex-hosted-checkout'; fixture: AirwallexWebhookFixture };

export type RailNeutralPaymentReceiptErrorCode =
  | 'malformed_receipt'
  | 'unsupported_asset_network'
  | 'policy_denied'
  | 'unsupported_fixture_state'
  | 'live_path_rejected'
  | 'revocable_event_rejected'
  | 'pii_rejected';

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
    : input.rail === 'mpp-tempo'
      ? fromMppTempo(input.fixture, options, errors)
      : fromAirwallexWebhook(input.fixture, errors);

  if (!candidate) return { ok: false, errors };

  // probe_only rails (Airwallex hosted checkout) are deliberately NOT gated on
  // the receipt v1 network table — being outside it is one of the reasons they
  // cap at probe_only in the first place. Binding candidates must still pass.
  if (candidate.supportState === 'receipt_binding_candidate') {
    const networkAsset = `${candidate.payment.network}:${candidate.payment.asset}`;
    if (!RECEIPT_V1_SUPPORTED_NETWORK_ASSETS.has(networkAsset)) {
      errors.push(error('unsupported_asset_network', '$.payment', `${networkAsset} is not supported by Reddi receipt v1 binding`));
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    receipt: {
      schemaVersion: RAIL_NEUTRAL_PAYMENT_RECEIPT_SCHEMA_VERSION,
      rail: candidate.rail,
      case: candidate.case,
      supportState: candidate.supportState,
      source: candidate.source,
      payment: candidate.payment,
      bindingRefs: candidate.bindingRefs,
      policy: {
        allowed: true,
        reasonCodes: policy.reasonCodes,
        auditNotes: policy.auditNotes ?? [],
      },
      bindingIntegration: candidate.bindingIntegration,
      claimBoundary: candidate.claimBoundary,
      guardrails: RAIL_NEUTRAL_PAYMENT_RECEIPT_GUARDRAILS,
    },
  };
}

type RailNeutralPaymentReceiptCandidate = Omit<RailNeutralPaymentReceipt, 'schemaVersion' | 'policy' | 'guardrails'>;

const BINDING_CANDIDATE_INTEGRATION = {
  schemaVersion: 'reddi.receipt-evidence-binding.v1',
  compatible: true,
  requiredReceiptSchemaVersion: 'reddi.receipt.v1',
} as const;

function fromPayShSandbox(
  fixture: PayShSandboxEvidenceFixture,
  options: RailNeutralPaymentReceiptOptions,
  errors: RailNeutralPaymentReceiptError[],
): RailNeutralPaymentReceiptCandidate | undefined {
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
    supportState: 'receipt_binding_candidate',
    bindingIntegration: BINDING_CANDIDATE_INTEGRATION,
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
): RailNeutralPaymentReceiptCandidate | undefined {
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
    supportState: 'receipt_binding_candidate',
    bindingIntegration: BINDING_CANDIDATE_INTEGRATION,
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

/**
 * Rail-neutral error codes for Airwallex webhook-fixture rejections. The
 * fine-grained reason codes live on `normalizeAirwallexWebhookFixture` (the
 * primary surface); here they map onto the shared rail-neutral vocabulary.
 */
const AIRWALLEX_REASON_TO_ERROR_CODE: Record<AirwallexWebhookNormalizationReasonCode, RailNeutralPaymentReceiptErrorCode> = {
  airwallex_webhook_probe_only_receipt: 'malformed_receipt', // success code; never mapped on the failure path
  webhook_fixture_malformed: 'malformed_receipt',
  non_synthetic_fixture_rejected: 'live_path_rejected',
  unknown_event_rejected: 'unsupported_fixture_state',
  revocation_event_not_receipt: 'revocable_event_rejected',
  signature_missing_or_not_fixture_asserted: 'malformed_receipt',
  live_signature_verification_rejected: 'live_path_rejected',
  merchant_secret_material_rejected: 'live_path_rejected',
  credential_material_rejected: 'live_path_rejected',
  live_url_rejected: 'live_path_rejected',
  pan_shaped_string_rejected: 'pii_rejected',
  email_shaped_string_rejected: 'pii_rejected',
  custody_claim_rejected: 'live_path_rejected',
  settlement_finality_claim_rejected: 'live_path_rejected',
};

/**
 * Static Airwallex webhook fixtures normalize to AT MOST `probe_only` (#580):
 * card-rail receipts are revocable and `reddi.receipt.v1` has no
 * revoked/contested state (#338 gap — the frozen union is not widened here),
 * the fiat network sits outside the receipt v1 network table, and webhook
 * HMAC signatures are fixture-asserted (no merchant secret is ever held).
 * Refund/dispute/reversal events are explicitly NOT receipts and fail closed.
 */
function fromAirwallexWebhook(
  fixture: AirwallexWebhookFixture,
  errors: RailNeutralPaymentReceiptError[],
): RailNeutralPaymentReceiptCandidate | undefined {
  const normalized = normalizeAirwallexWebhookFixture(fixture);
  if (!normalized.ok) {
    normalized.reasonCodes.forEach((reasonCode, index) => {
      errors.push(error(
        AIRWALLEX_REASON_TO_ERROR_CODE[reasonCode],
        '$.fixture',
        `${reasonCode}: ${normalized.auditNotes[index] ?? 'Airwallex webhook fixture rejected (fail closed).'}`,
      ));
    });
    return undefined;
  }
  const receipt = normalized.receipt;
  return {
    rail: 'airwallex-hosted-checkout',
    case: 'airwallex_webhook_probe_only',
    supportState: 'probe_only',
    bindingIntegration: {
      schemaVersion: 'reddi.receipt-evidence-binding.v1',
      compatible: false,
      requiredReceiptSchemaVersion: 'reddi.receipt.v1',
      incompatibilityReasons: [
        `Fiat rail (${receipt.payment.fiatAssetNamespace}) sits outside the Reddi receipt v1 network table (Solana-only).`,
        'Card-rail receipts are revocable; reddi.receipt.v1 has no revoked/contested state for reversible rails — gap tracked in issue #338; the frozen receipt v1 union is not widened.',
        'Webhook HMAC signatures are fixture-asserted only; RAP never holds a merchant webhook secret, so no live verification backs this shape.',
      ],
    },
    source: {
      kind: 'static-fixture',
      sourceId: `airwallex-webhook-fixture:${receipt.eventRef.eventId}`,
      fixtureRef: receipt.bindingRefs.evidenceRef,
    },
    payment: {
      network: 'airwallex-hosted-checkout',
      asset: receipt.payment.currency,
      amount: receipt.payment.amount,
      unit: receipt.payment.unit,
      paymentProofRef: receipt.payment.paymentProofRef,
    },
    bindingRefs: { ...receipt.bindingRefs },
    claimBoundary: [
      ...receipt.claimBoundary,
      'Rail-neutral normalization of Airwallex webhook fixtures caps at probe_only and never produces a final, settled, or binding receipt.',
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
