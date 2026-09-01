import { createHash } from 'node:crypto';

export const REDDI_PAYMENT_CANONICALIZATION = 'reddi.canonical-json.sha256.v1' as const;
export const REDDI_PAYMENT_JOB_SCHEMA_VERSION = 'reddi.payment-job.v1' as const;
export const REDDI_PAYMENT_AGREEMENT_SCHEMA_VERSION = 'reddi.payment-agreement.v1' as const;
export const REDDI_PAYMENT_INTENT_SCHEMA_VERSION = 'reddi.payment-intent.v1' as const;
export const REDDI_PAYMENT_OBSERVATION_SCHEMA_VERSION = 'reddi.payment-observation.v1' as const;
export const REDDI_REFUND_RECORD_SCHEMA_VERSION = 'reddi.refund-record.v1' as const;

export type ReddiPaymentEnvironmentLabel =
  | 'deterministic-fixture'
  | 'local-test-mint'
  | 'devnet-unverified'
  | 'mainnet-gated'
  | 'controlled-live';

export type ReddiPaymentEligibilityLabel =
  | 'non_eligible'
  | 'pending_partner_acceptance'
  | 'eligible'
  | 'excluded';

export type ReddiPaymentRecordLabels = {
  environment: ReddiPaymentEnvironmentLabel;
  eligibility: ReddiPaymentEligibilityLabel;
  exclusionReason?: string;
  partnerAcceptanceRef?: string;
};

export type ReddiCanonicalNetworkRef = {
  caip2: string;
  rapAlias?: string;
};

export type ReddiPaymentRecordValidationErrorCode =
  | 'malformed_record'
  | 'malformed_labels'
  | 'non_live_evidence_marked_eligible'
  | 'mainnet_partner_acceptance_missing'
  | 'model_spend_authority_rejected';

export type ReddiPaymentRecordValidationError = {
  code: ReddiPaymentRecordValidationErrorCode;
  path: string;
  message: string;
};

export type ReddiPaymentRecordValidationResult<T> =
  | { ok: true; record: T }
  | { ok: false; errors: ReddiPaymentRecordValidationError[] };

export type ReddiPaymentJobRecord = {
  schemaVersion: typeof REDDI_PAYMENT_JOB_SCHEMA_VERSION;
  id: string;
  canonicalization: typeof REDDI_PAYMENT_CANONICALIZATION;
  labels: ReddiPaymentRecordLabels;
  requestDisclosureHash: string;
  sourceId: string;
  specialistId: string;
  nonce: string;
  createdAt?: string;
};

export type ReddiPaymentAgreementRecord = {
  schemaVersion: typeof REDDI_PAYMENT_AGREEMENT_SCHEMA_VERSION;
  id: string;
  canonicalization: typeof REDDI_PAYMENT_CANONICALIZATION;
  labels: ReddiPaymentRecordLabels;
  jobId: string;
  signedOfferHash: string;
  buyerPolicyDecisionHash: string;
  sellerTermsHash: string;
  quoteExpiresAt: string;
  createdAt?: string;
};

export type ReddiPaymentIntentAuthorizationState = 'model_draft' | 'policy_approved' | 'operator_approved';

export type ReddiPaymentIntentAuthorization = {
  state: ReddiPaymentIntentAuthorizationState;
  /** The model may draft an intent, but it is never a spending authority. */
  modelMayAuthorize: false;
  operatorApprovalRequired: boolean;
  policyDecisionRef?: string;
  operatorApprovalRef?: string;
  approvedAt?: string;
};

export type ReddiPaymentIntentRecord = {
  schemaVersion: typeof REDDI_PAYMENT_INTENT_SCHEMA_VERSION;
  id: string;
  canonicalization: typeof REDDI_PAYMENT_CANONICALIZATION;
  labels: ReddiPaymentRecordLabels;
  agreementId: string;
  network: ReddiCanonicalNetworkRef;
  asset: {
    symbol: string;
    mint?: string;
    tokenProgram?: string;
    decimals?: number;
    amountBaseUnits: string;
  };
  payTo: string;
  destinationTokenAccount?: string;
  memo?: string;
  evidenceRequired: boolean;
  quoteExpiresAt: string;
  expiresAt: string;
  refundPolicy: {
    mode: 'none' | 'automatic' | 'manual_review';
    description: string;
    refundAddress?: string;
  };
  authorization: ReddiPaymentIntentAuthorization;
  createdAt?: string;
};

export type ReddiPaymentObservationRecord = {
  schemaVersion: typeof REDDI_PAYMENT_OBSERVATION_SCHEMA_VERSION;
  id: string;
  canonicalization: typeof REDDI_PAYMENT_CANONICALIZATION;
  labels: ReddiPaymentRecordLabels;
  paymentIntentId?: string;
  agreementId?: string;
  observedAt: string;
  verifier: {
    name: string;
    version: string;
  };
  payment: {
    rail: string;
    network: ReddiCanonicalNetworkRef;
    asset: string;
    mint?: string;
    tokenProgram?: string;
    amountBaseUnits: string;
    payTo: string;
    sourceTokenAccount?: string;
    destinationTokenAccount: string;
    authority?: string;
    signature: string;
    instructionIndex: string;
    memo?: string;
    paymentProofRef: string;
  };
  confirmation: {
    slot: number;
    blockTime?: number;
    commitment: 'confirmed' | 'finalized';
  };
  status: 'observed_confirmed' | 'observed_failed' | 'observation_inconclusive';
};

export type ReddiRefundRecord = {
  schemaVersion: typeof REDDI_REFUND_RECORD_SCHEMA_VERSION;
  id: string;
  canonicalization: typeof REDDI_PAYMENT_CANONICALIZATION;
  labels: ReddiPaymentRecordLabels;
  originalPaymentObservationId: string;
  refundObservationId?: string;
  refundSignature?: string;
  amountBaseUnits: string;
  reason: string;
  state: 'requested' | 'operator_approved' | 'observed_confirmed' | 'failed' | 'manual_review';
  createdAt: string;
};

export type ReddiPaymentIdKind = 'job' | 'agreement' | 'payment-intent' | 'payment-observation' | 'refund';

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const POSITIVE_AMOUNT_PATTERN = /^[1-9]\d*$/;
const ID_PREFIXES: Record<ReddiPaymentIdKind, string> = {
  job: 'reddi.job',
  agreement: 'reddi.agreement',
  'payment-intent': 'reddi.payment-intent',
  'payment-observation': 'reddi.payment-observation',
  refund: 'reddi.refund',
};
const NON_ELIGIBLE_ENVIRONMENTS = new Set<ReddiPaymentEnvironmentLabel>([
  'deterministic-fixture',
  'local-test-mint',
  'devnet-unverified',
]);

export function canonicalizePaymentObject(value: unknown): string {
  return canonicalize(value);
}

export function canonicalPaymentHash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalize(value)).digest('hex')}`;
}

export function deriveReddiPaymentId(kind: ReddiPaymentIdKind, payload: unknown): string {
  const hash = createHash('sha256')
    .update(canonicalize({ kind, payload }))
    .digest('hex');
  return `${ID_PREFIXES[kind]}:${hash}`;
}

export function validatePaymentRecordLabels(labels: unknown, path = '$.labels'): ReddiPaymentRecordValidationResult<ReddiPaymentRecordLabels> {
  const errors: ReddiPaymentRecordValidationError[] = [];
  if (!isPlainObject(labels)) {
    return { ok: false, errors: [error('malformed_labels', path, 'payment record labels are required')] };
  }
  const record = labels as ReddiPaymentRecordLabels;
  if (!isPaymentEnvironment(record.environment)) {
    errors.push(error('malformed_labels', `${path}.environment`, 'environment label is invalid'));
  }
  if (!isPaymentEligibility(record.eligibility)) {
    errors.push(error('malformed_labels', `${path}.eligibility`, 'eligibility label is invalid'));
  }
  if (isPaymentEnvironment(record.environment) && record.eligibility === 'eligible' && NON_ELIGIBLE_ENVIRONMENTS.has(record.environment)) {
    errors.push(error(
      'non_live_evidence_marked_eligible',
      `${path}.eligibility`,
      `${record.environment} payment evidence is not eligible for grant-volume claims`,
    ));
  }
  if (record.environment === 'mainnet-gated' && record.eligibility === 'eligible' && !isNonEmptyString(record.partnerAcceptanceRef)) {
    errors.push(error(
      'mainnet_partner_acceptance_missing',
      `${path}.partnerAcceptanceRef`,
      'mainnet AUDD evidence cannot be marked eligible without partner acceptance provenance',
    ));
  }
  if (record.exclusionReason !== undefined && !isNonEmptyString(record.exclusionReason)) {
    errors.push(error('malformed_labels', `${path}.exclusionReason`, 'exclusionReason must be non-empty when present'));
  }
  if (record.partnerAcceptanceRef !== undefined && !isNonEmptyString(record.partnerAcceptanceRef)) {
    errors.push(error('malformed_labels', `${path}.partnerAcceptanceRef`, 'partnerAcceptanceRef must be non-empty when present'));
  }
  return errors.length === 0 ? { ok: true, record } : { ok: false, errors };
}

export function createPaymentJobRecord(input: Omit<ReddiPaymentJobRecord, 'schemaVersion' | 'id' | 'canonicalization'> & { id?: string }): ReddiPaymentJobRecord {
  const id = input.id ?? deriveReddiPaymentId('job', {
    requestDisclosureHash: input.requestDisclosureHash,
    sourceId: input.sourceId,
    specialistId: input.specialistId,
    nonce: input.nonce,
  });
  const record: ReddiPaymentJobRecord = {
    schemaVersion: REDDI_PAYMENT_JOB_SCHEMA_VERSION,
    id,
    canonicalization: REDDI_PAYMENT_CANONICALIZATION,
    labels: input.labels,
    requestDisclosureHash: input.requestDisclosureHash,
    sourceId: input.sourceId,
    specialistId: input.specialistId,
    nonce: input.nonce,
    createdAt: input.createdAt,
  };
  throwIfInvalid(validatePaymentJobRecord(record), 'invalid_payment_job_record');
  return record;
}

export function validatePaymentJobRecord(input: unknown): ReddiPaymentRecordValidationResult<ReddiPaymentJobRecord> {
  const errors: ReddiPaymentRecordValidationError[] = [];
  if (!isPlainObject(input)) return { ok: false, errors: [error('malformed_record', '$', 'payment job record must be an object')] };
  const record = input as ReddiPaymentJobRecord;
  requireLiteral(record.schemaVersion, REDDI_PAYMENT_JOB_SCHEMA_VERSION, '$.schemaVersion', errors);
  requirePrefix(record.id, 'reddi.job:', '$.id', errors);
  requireLiteral(record.canonicalization, REDDI_PAYMENT_CANONICALIZATION, '$.canonicalization', errors);
  appendLabelErrors(validatePaymentRecordLabels(record.labels), errors);
  requireHash(record.requestDisclosureHash, '$.requestDisclosureHash', errors);
  requireString(record.sourceId, '$.sourceId', errors);
  requireString(record.specialistId, '$.specialistId', errors);
  requireString(record.nonce, '$.nonce', errors);
  validateOptionalTimestamp(record.createdAt, '$.createdAt', errors);
  return errors.length === 0 ? { ok: true, record } : { ok: false, errors };
}

export function createPaymentAgreementRecord(input: Omit<ReddiPaymentAgreementRecord, 'schemaVersion' | 'id' | 'canonicalization'> & { id?: string }): ReddiPaymentAgreementRecord {
  const id = input.id ?? deriveReddiPaymentId('agreement', {
    jobId: input.jobId,
    signedOfferHash: input.signedOfferHash,
    buyerPolicyDecisionHash: input.buyerPolicyDecisionHash,
    sellerTermsHash: input.sellerTermsHash,
    quoteExpiresAt: input.quoteExpiresAt,
  });
  const record: ReddiPaymentAgreementRecord = {
    schemaVersion: REDDI_PAYMENT_AGREEMENT_SCHEMA_VERSION,
    id,
    canonicalization: REDDI_PAYMENT_CANONICALIZATION,
    labels: input.labels,
    jobId: input.jobId,
    signedOfferHash: input.signedOfferHash,
    buyerPolicyDecisionHash: input.buyerPolicyDecisionHash,
    sellerTermsHash: input.sellerTermsHash,
    quoteExpiresAt: input.quoteExpiresAt,
    createdAt: input.createdAt,
  };
  throwIfInvalid(validatePaymentAgreementRecord(record), 'invalid_payment_agreement_record');
  return record;
}

export function validatePaymentAgreementRecord(input: unknown): ReddiPaymentRecordValidationResult<ReddiPaymentAgreementRecord> {
  const errors: ReddiPaymentRecordValidationError[] = [];
  if (!isPlainObject(input)) return { ok: false, errors: [error('malformed_record', '$', 'payment agreement record must be an object')] };
  const record = input as ReddiPaymentAgreementRecord;
  requireLiteral(record.schemaVersion, REDDI_PAYMENT_AGREEMENT_SCHEMA_VERSION, '$.schemaVersion', errors);
  requirePrefix(record.id, 'reddi.agreement:', '$.id', errors);
  requireLiteral(record.canonicalization, REDDI_PAYMENT_CANONICALIZATION, '$.canonicalization', errors);
  appendLabelErrors(validatePaymentRecordLabels(record.labels), errors);
  requirePrefix(record.jobId, 'reddi.job:', '$.jobId', errors);
  requireHash(record.signedOfferHash, '$.signedOfferHash', errors);
  requireHash(record.buyerPolicyDecisionHash, '$.buyerPolicyDecisionHash', errors);
  requireHash(record.sellerTermsHash, '$.sellerTermsHash', errors);
  validateTimestamp(record.quoteExpiresAt, '$.quoteExpiresAt', errors);
  validateOptionalTimestamp(record.createdAt, '$.createdAt', errors);
  return errors.length === 0 ? { ok: true, record } : { ok: false, errors };
}

export function createPaymentIntentRecord(input: Omit<ReddiPaymentIntentRecord, 'schemaVersion' | 'id' | 'canonicalization'> & { id?: string }): ReddiPaymentIntentRecord {
  const id = input.id ?? deriveReddiPaymentId('payment-intent', {
    agreementId: input.agreementId,
    network: input.network.caip2,
    mint: input.asset.mint,
    tokenProgram: input.asset.tokenProgram,
    amountBaseUnits: input.asset.amountBaseUnits,
    payTo: input.payTo,
    destinationTokenAccount: input.destinationTokenAccount,
    memo: input.memo,
    validUntil: input.expiresAt,
  });
  const record: ReddiPaymentIntentRecord = {
    schemaVersion: REDDI_PAYMENT_INTENT_SCHEMA_VERSION,
    id,
    canonicalization: REDDI_PAYMENT_CANONICALIZATION,
    labels: input.labels,
    agreementId: input.agreementId,
    network: input.network,
    asset: input.asset,
    payTo: input.payTo,
    destinationTokenAccount: input.destinationTokenAccount,
    memo: input.memo,
    evidenceRequired: input.evidenceRequired,
    quoteExpiresAt: input.quoteExpiresAt,
    expiresAt: input.expiresAt,
    refundPolicy: input.refundPolicy,
    authorization: input.authorization,
    createdAt: input.createdAt,
  };
  throwIfInvalid(validatePaymentIntentRecord(record), 'invalid_payment_intent_record');
  return record;
}

export function createPaymentIntentDraft(input: Omit<ReddiPaymentIntentRecord, 'schemaVersion' | 'id' | 'canonicalization' | 'authorization'> & {
  id?: string;
  policyDecisionRef?: string;
  operatorApprovalRequired?: boolean;
}): ReddiPaymentIntentRecord {
  return createPaymentIntentRecord({
    ...input,
    authorization: {
      state: 'model_draft',
      modelMayAuthorize: false,
      operatorApprovalRequired: input.operatorApprovalRequired ?? input.labels.environment !== 'deterministic-fixture',
      policyDecisionRef: input.policyDecisionRef,
    },
  });
}

export function validatePaymentIntentRecord(input: unknown): ReddiPaymentRecordValidationResult<ReddiPaymentIntentRecord> {
  const errors: ReddiPaymentRecordValidationError[] = [];
  if (!isPlainObject(input)) return { ok: false, errors: [error('malformed_record', '$', 'payment intent record must be an object')] };
  const record = input as ReddiPaymentIntentRecord;
  requireLiteral(record.schemaVersion, REDDI_PAYMENT_INTENT_SCHEMA_VERSION, '$.schemaVersion', errors);
  requirePrefix(record.id, 'reddi.payment-intent:', '$.id', errors);
  requireLiteral(record.canonicalization, REDDI_PAYMENT_CANONICALIZATION, '$.canonicalization', errors);
  appendLabelErrors(validatePaymentRecordLabels(record.labels), errors);
  requirePrefix(record.agreementId, 'reddi.agreement:', '$.agreementId', errors);
  validateNetwork(record.network, '$.network', errors);
  requireString(record.asset?.symbol, '$.asset.symbol', errors);
  requirePositiveAmount(record.asset?.amountBaseUnits, '$.asset.amountBaseUnits', errors);
  validateOptionalNumber(record.asset?.decimals, '$.asset.decimals', errors);
  validateOptionalString(record.asset?.mint, '$.asset.mint', errors);
  validateOptionalString(record.asset?.tokenProgram, '$.asset.tokenProgram', errors);
  requireString(record.payTo, '$.payTo', errors);
  validateOptionalString(record.destinationTokenAccount, '$.destinationTokenAccount', errors);
  validateOptionalString(record.memo, '$.memo', errors);
  if (typeof record.evidenceRequired !== 'boolean') errors.push(error('malformed_record', '$.evidenceRequired', 'evidenceRequired must be boolean'));
  validateTimestamp(record.quoteExpiresAt, '$.quoteExpiresAt', errors);
  validateTimestamp(record.expiresAt, '$.expiresAt', errors);
  validateRefundPolicy(record.refundPolicy, '$.refundPolicy', errors);
  validateAuthorization(record.authorization, '$.authorization', errors);
  validateOptionalTimestamp(record.createdAt, '$.createdAt', errors);
  return errors.length === 0 ? { ok: true, record } : { ok: false, errors };
}

export function formatPaymentObservationProofRef(input: {
  network: ReddiCanonicalNetworkRef;
  asset: string;
  signature: string;
  instructionIndex: string | number;
  mint?: string;
  amountBaseUnits: string;
}): string {
  const network = input.network.rapAlias ?? input.network.caip2;
  const params = new URLSearchParams();
  params.set('ix', String(input.instructionIndex));
  if (input.mint) params.set('mint', input.mint);
  params.set('amount', input.amountBaseUnits);
  return `${network}:${input.asset}:${input.signature}#${params.toString()}`;
}

export function createPaymentObservationRecord(input: Omit<ReddiPaymentObservationRecord, 'schemaVersion' | 'id' | 'canonicalization' | 'payment'> & {
  id?: string;
  payment: Omit<ReddiPaymentObservationRecord['payment'], 'paymentProofRef'> & { paymentProofRef?: string };
}): ReddiPaymentObservationRecord {
  const paymentProofRef = input.payment.paymentProofRef ?? formatPaymentObservationProofRef({
    network: input.payment.network,
    asset: input.payment.asset,
    signature: input.payment.signature,
    instructionIndex: input.payment.instructionIndex,
    mint: input.payment.mint,
    amountBaseUnits: input.payment.amountBaseUnits,
  });
  const id = input.id ?? deriveReddiPaymentId('payment-observation', {
    network: input.payment.network.caip2,
    signature: input.payment.signature,
    instructionIndex: input.payment.instructionIndex,
    mint: input.payment.mint,
    amountBaseUnits: input.payment.amountBaseUnits,
    destinationTokenAccount: input.payment.destinationTokenAccount,
  });
  const record: ReddiPaymentObservationRecord = {
    schemaVersion: REDDI_PAYMENT_OBSERVATION_SCHEMA_VERSION,
    id,
    canonicalization: REDDI_PAYMENT_CANONICALIZATION,
    labels: input.labels,
    paymentIntentId: input.paymentIntentId,
    agreementId: input.agreementId,
    observedAt: input.observedAt,
    verifier: input.verifier,
    payment: {
      ...input.payment,
      paymentProofRef,
    },
    confirmation: input.confirmation,
    status: input.status,
  };
  throwIfInvalid(validatePaymentObservationRecord(record), 'invalid_payment_observation_record');
  return record;
}

export function validatePaymentObservationRecord(input: unknown): ReddiPaymentRecordValidationResult<ReddiPaymentObservationRecord> {
  const errors: ReddiPaymentRecordValidationError[] = [];
  if (!isPlainObject(input)) return { ok: false, errors: [error('malformed_record', '$', 'payment observation record must be an object')] };
  const record = input as ReddiPaymentObservationRecord;
  requireLiteral(record.schemaVersion, REDDI_PAYMENT_OBSERVATION_SCHEMA_VERSION, '$.schemaVersion', errors);
  requirePrefix(record.id, 'reddi.payment-observation:', '$.id', errors);
  requireLiteral(record.canonicalization, REDDI_PAYMENT_CANONICALIZATION, '$.canonicalization', errors);
  appendLabelErrors(validatePaymentRecordLabels(record.labels), errors);
  validateOptionalPrefix(record.paymentIntentId, 'reddi.payment-intent:', '$.paymentIntentId', errors);
  validateOptionalPrefix(record.agreementId, 'reddi.agreement:', '$.agreementId', errors);
  validateTimestamp(record.observedAt, '$.observedAt', errors);
  requireString(record.verifier?.name, '$.verifier.name', errors);
  requireString(record.verifier?.version, '$.verifier.version', errors);
  requireString(record.payment?.rail, '$.payment.rail', errors);
  validateNetwork(record.payment?.network, '$.payment.network', errors);
  requireString(record.payment?.asset, '$.payment.asset', errors);
  requirePositiveAmount(record.payment?.amountBaseUnits, '$.payment.amountBaseUnits', errors);
  validateOptionalString(record.payment?.mint, '$.payment.mint', errors);
  validateOptionalString(record.payment?.tokenProgram, '$.payment.tokenProgram', errors);
  requireString(record.payment?.payTo, '$.payment.payTo', errors);
  validateOptionalString(record.payment?.sourceTokenAccount, '$.payment.sourceTokenAccount', errors);
  requireString(record.payment?.destinationTokenAccount, '$.payment.destinationTokenAccount', errors);
  validateOptionalString(record.payment?.authority, '$.payment.authority', errors);
  requireString(record.payment?.signature, '$.payment.signature', errors);
  requireString(record.payment?.instructionIndex, '$.payment.instructionIndex', errors);
  validateOptionalString(record.payment?.memo, '$.payment.memo', errors);
  requireString(record.payment?.paymentProofRef, '$.payment.paymentProofRef', errors);
  if (!isPlainObject(record.confirmation)) {
    errors.push(error('malformed_record', '$.confirmation', 'confirmation metadata is required'));
  } else {
    if (!Number.isSafeInteger(record.confirmation.slot) || record.confirmation.slot <= 0) {
      errors.push(error('malformed_record', '$.confirmation.slot', 'slot must be a positive safe integer'));
    }
    validateOptionalNumber(record.confirmation.blockTime, '$.confirmation.blockTime', errors);
    if (!['confirmed', 'finalized'].includes(String(record.confirmation.commitment))) {
      errors.push(error('malformed_record', '$.confirmation.commitment', 'commitment must be confirmed or finalized'));
    }
  }
  if (!['observed_confirmed', 'observed_failed', 'observation_inconclusive'].includes(String(record.status))) {
    errors.push(error('malformed_record', '$.status', 'observation status is invalid'));
  }
  return errors.length === 0 ? { ok: true, record } : { ok: false, errors };
}

export function createRefundRecord(input: Omit<ReddiRefundRecord, 'schemaVersion' | 'id' | 'canonicalization'> & { id?: string }): ReddiRefundRecord {
  const id = input.id ?? deriveReddiPaymentId('refund', {
    originalPaymentObservationId: input.originalPaymentObservationId,
    refundObservationId: input.refundObservationId,
    refundSignature: input.refundSignature,
    amountBaseUnits: input.amountBaseUnits,
    reason: input.reason,
  });
  const record: ReddiRefundRecord = {
    schemaVersion: REDDI_REFUND_RECORD_SCHEMA_VERSION,
    id,
    canonicalization: REDDI_PAYMENT_CANONICALIZATION,
    labels: input.labels,
    originalPaymentObservationId: input.originalPaymentObservationId,
    refundObservationId: input.refundObservationId,
    refundSignature: input.refundSignature,
    amountBaseUnits: input.amountBaseUnits,
    reason: input.reason,
    state: input.state,
    createdAt: input.createdAt,
  };
  throwIfInvalid(validateRefundRecord(record), 'invalid_refund_record');
  return record;
}

export function validateRefundRecord(input: unknown): ReddiPaymentRecordValidationResult<ReddiRefundRecord> {
  const errors: ReddiPaymentRecordValidationError[] = [];
  if (!isPlainObject(input)) return { ok: false, errors: [error('malformed_record', '$', 'refund record must be an object')] };
  const record = input as ReddiRefundRecord;
  requireLiteral(record.schemaVersion, REDDI_REFUND_RECORD_SCHEMA_VERSION, '$.schemaVersion', errors);
  requirePrefix(record.id, 'reddi.refund:', '$.id', errors);
  requireLiteral(record.canonicalization, REDDI_PAYMENT_CANONICALIZATION, '$.canonicalization', errors);
  appendLabelErrors(validatePaymentRecordLabels(record.labels), errors);
  requirePrefix(record.originalPaymentObservationId, 'reddi.payment-observation:', '$.originalPaymentObservationId', errors);
  validateOptionalPrefix(record.refundObservationId, 'reddi.payment-observation:', '$.refundObservationId', errors);
  validateOptionalString(record.refundSignature, '$.refundSignature', errors);
  requirePositiveAmount(record.amountBaseUnits, '$.amountBaseUnits', errors);
  requireString(record.reason, '$.reason', errors);
  if (!['requested', 'operator_approved', 'observed_confirmed', 'failed', 'manual_review'].includes(String(record.state))) {
    errors.push(error('malformed_record', '$.state', 'refund state is invalid'));
  }
  validateTimestamp(record.createdAt, '$.createdAt', errors);
  return errors.length === 0 ? { ok: true, record } : { ok: false, errors };
}

function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonicalize_non_finite_number');
    return JSON.stringify(value);
  }
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  if (!isPlainObject(value)) throw new Error('canonicalize_unsupported_value');
  const entries = Object.entries(value)
    .filter(([, nested]) => nested !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${canonicalize(nested)}`).join(',')}}`;
}

function validateAuthorization(value: unknown, path: string, errors: ReddiPaymentRecordValidationError[]): void {
  if (!isPlainObject(value)) {
    errors.push(error('malformed_record', path, 'authorization metadata is required'));
    return;
  }
  const authorization = value as ReddiPaymentIntentAuthorization;
  if (!['model_draft', 'policy_approved', 'operator_approved'].includes(String(authorization.state))) {
    errors.push(error('malformed_record', `${path}.state`, 'authorization state is invalid'));
  }
  if (authorization.modelMayAuthorize !== false) {
    errors.push(error('model_spend_authority_rejected', `${path}.modelMayAuthorize`, 'models may draft payment intents but must never authorize spend'));
  }
  if (typeof authorization.operatorApprovalRequired !== 'boolean') {
    errors.push(error('malformed_record', `${path}.operatorApprovalRequired`, 'operatorApprovalRequired must be boolean'));
  }
  validateOptionalString(authorization.policyDecisionRef, `${path}.policyDecisionRef`, errors);
  validateOptionalString(authorization.operatorApprovalRef, `${path}.operatorApprovalRef`, errors);
  validateOptionalTimestamp(authorization.approvedAt, `${path}.approvedAt`, errors);
  if (authorization.state === 'operator_approved' && !isNonEmptyString(authorization.operatorApprovalRef)) {
    errors.push(error('malformed_record', `${path}.operatorApprovalRef`, 'operator-approved intents require an operator approval reference'));
  }
}

function validateRefundPolicy(value: unknown, path: string, errors: ReddiPaymentRecordValidationError[]): void {
  if (!isPlainObject(value)) {
    errors.push(error('malformed_record', path, 'refund policy is required'));
    return;
  }
  if (!['none', 'automatic', 'manual_review'].includes(String(value.mode))) {
    errors.push(error('malformed_record', `${path}.mode`, 'refund mode is invalid'));
  }
  requireString(value.description, `${path}.description`, errors);
  validateOptionalString(value.refundAddress, `${path}.refundAddress`, errors);
}

function validateNetwork(value: unknown, path: string, errors: ReddiPaymentRecordValidationError[]): void {
  if (!isPlainObject(value)) {
    errors.push(error('malformed_record', path, 'network ref is required'));
    return;
  }
  requireString(value.caip2, `${path}.caip2`, errors);
  validateOptionalString(value.rapAlias, `${path}.rapAlias`, errors);
}

function appendLabelErrors(result: ReddiPaymentRecordValidationResult<ReddiPaymentRecordLabels>, errors: ReddiPaymentRecordValidationError[]): void {
  if (!result.ok) errors.push(...result.errors);
}

function throwIfInvalid<T>(result: ReddiPaymentRecordValidationResult<T>, prefix: string): asserts result is { ok: true; record: T } {
  if (!result.ok) throw new Error(`${prefix}:${result.errors.map((item) => `${item.code}:${item.path}`).join(',')}`);
}

function requireLiteral(value: unknown, expected: string, path: string, errors: ReddiPaymentRecordValidationError[]): void {
  if (value !== expected) errors.push(error('malformed_record', path, `expected ${expected}`));
}

function requirePrefix(value: unknown, prefix: string, path: string, errors: ReddiPaymentRecordValidationError[]): void {
  if (!isNonEmptyString(value) || !value.startsWith(prefix)) errors.push(error('malformed_record', path, `expected id prefix ${prefix}`));
}

function validateOptionalPrefix(value: unknown, prefix: string, path: string, errors: ReddiPaymentRecordValidationError[]): void {
  if (value !== undefined && (!isNonEmptyString(value) || !value.startsWith(prefix))) {
    errors.push(error('malformed_record', path, `expected id prefix ${prefix}`));
  }
}

function requireHash(value: unknown, path: string, errors: ReddiPaymentRecordValidationError[]): void {
  if (!isNonEmptyString(value) || !HASH_PATTERN.test(value)) errors.push(error('malformed_record', path, 'expected sha256:<hex> hash'));
}

function requireString(value: unknown, path: string, errors: ReddiPaymentRecordValidationError[]): void {
  if (!isNonEmptyString(value)) errors.push(error('malformed_record', path, 'required string is missing'));
}

function validateOptionalString(value: unknown, path: string, errors: ReddiPaymentRecordValidationError[]): void {
  if (value !== undefined && !isNonEmptyString(value)) errors.push(error('malformed_record', path, 'must be a non-empty string when present'));
}

function requirePositiveAmount(value: unknown, path: string, errors: ReddiPaymentRecordValidationError[]): void {
  if (!isNonEmptyString(value) || !POSITIVE_AMOUNT_PATTERN.test(value)) {
    errors.push(error('malformed_record', path, 'amount must be a positive integer string in base units'));
  }
}

function validateOptionalNumber(value: unknown, path: string, errors: ReddiPaymentRecordValidationError[]): void {
  if (value !== undefined && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)) {
    errors.push(error('malformed_record', path, 'must be a non-negative safe integer when present'));
  }
}

function validateTimestamp(value: unknown, path: string, errors: ReddiPaymentRecordValidationError[]): void {
  if (!isNonEmptyString(value) || Number.isNaN(Date.parse(value))) {
    errors.push(error('malformed_record', path, 'timestamp must be an ISO-parseable string'));
  }
}

function validateOptionalTimestamp(value: unknown, path: string, errors: ReddiPaymentRecordValidationError[]): void {
  if (value !== undefined) validateTimestamp(value, path, errors);
}

function isPaymentEnvironment(value: unknown): value is ReddiPaymentEnvironmentLabel {
  return ['deterministic-fixture', 'local-test-mint', 'devnet-unverified', 'mainnet-gated', 'controlled-live'].includes(String(value));
}

function isPaymentEligibility(value: unknown): value is ReddiPaymentEligibilityLabel {
  return ['non_eligible', 'pending_partner_acceptance', 'eligible', 'excluded'].includes(String(value));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function error(code: ReddiPaymentRecordValidationErrorCode, path: string, message: string): ReddiPaymentRecordValidationError {
  return { code, path, message };
}
