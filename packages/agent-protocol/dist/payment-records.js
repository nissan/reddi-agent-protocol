import { createHash } from 'node:crypto';
export const REDDI_PAYMENT_CANONICALIZATION = 'reddi.canonical-json.sha256.v1';
export const REDDI_PAYMENT_JOB_SCHEMA_VERSION = 'reddi.payment-job.v1';
export const REDDI_PAYMENT_AGREEMENT_SCHEMA_VERSION = 'reddi.payment-agreement.v1';
export const REDDI_PAYMENT_INTENT_SCHEMA_VERSION = 'reddi.payment-intent.v1';
export const REDDI_PAYMENT_OBSERVATION_SCHEMA_VERSION = 'reddi.payment-observation.v1';
export const REDDI_REFUND_RECORD_SCHEMA_VERSION = 'reddi.refund-record.v1';
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const POSITIVE_AMOUNT_PATTERN = /^[1-9]\d*$/;
const ID_PREFIXES = {
    job: 'reddi.job',
    agreement: 'reddi.agreement',
    'payment-intent': 'reddi.payment-intent',
    'payment-observation': 'reddi.payment-observation',
    refund: 'reddi.refund',
};
const NON_ELIGIBLE_ENVIRONMENTS = new Set([
    'deterministic-fixture',
    'local-test-mint',
    'devnet-unverified',
]);
const PARTNER_ACCEPTANCE_ENVIRONMENTS = new Set([
    'mainnet-gated',
    'controlled-live',
]);
export function canonicalizePaymentObject(value) {
    return canonicalize(value);
}
export function canonicalPaymentHash(value) {
    return `sha256:${createHash('sha256').update(canonicalize(value)).digest('hex')}`;
}
export function deriveReddiPaymentId(kind, payload) {
    const hash = createHash('sha256')
        .update(canonicalize({ kind, payload }))
        .digest('hex');
    return `${ID_PREFIXES[kind]}:${hash}`;
}
export function validatePaymentRecordLabels(labels, path = '$.labels') {
    const errors = [];
    if (!isPlainObject(labels)) {
        return { ok: false, errors: [error('malformed_labels', path, 'payment record labels are required')] };
    }
    const record = labels;
    if (!isPaymentEnvironment(record.environment)) {
        errors.push(error('malformed_labels', `${path}.environment`, 'environment label is invalid'));
    }
    if (!isPaymentEligibility(record.eligibility)) {
        errors.push(error('malformed_labels', `${path}.eligibility`, 'eligibility label is invalid'));
    }
    if (isPaymentEnvironment(record.environment) && record.eligibility === 'eligible' && NON_ELIGIBLE_ENVIRONMENTS.has(record.environment)) {
        errors.push(error('non_live_evidence_marked_eligible', `${path}.eligibility`, `${record.environment} payment evidence is not eligible for grant-volume claims`));
    }
    if (isPaymentEnvironment(record.environment) && PARTNER_ACCEPTANCE_ENVIRONMENTS.has(record.environment) && record.eligibility === 'eligible' && !isNonEmptyString(record.partnerAcceptanceRef)) {
        errors.push(error('mainnet_partner_acceptance_missing', `${path}.partnerAcceptanceRef`, `${record.environment} AUDD evidence cannot be marked eligible without partner acceptance provenance`));
    }
    if (record.exclusionReason !== undefined && !isNonEmptyString(record.exclusionReason)) {
        errors.push(error('malformed_labels', `${path}.exclusionReason`, 'exclusionReason must be non-empty when present'));
    }
    if (record.partnerAcceptanceRef !== undefined && !isNonEmptyString(record.partnerAcceptanceRef)) {
        errors.push(error('malformed_labels', `${path}.partnerAcceptanceRef`, 'partnerAcceptanceRef must be non-empty when present'));
    }
    return errors.length === 0 ? { ok: true, record } : { ok: false, errors };
}
export function createPaymentJobRecord(input) {
    const id = input.id ?? deriveReddiPaymentId('job', {
        requestDisclosureHash: input.requestDisclosureHash,
        sourceId: input.sourceId,
        specialistId: input.specialistId,
        nonce: input.nonce,
    });
    const record = {
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
export function validatePaymentJobRecord(input) {
    const errors = [];
    if (!isPlainObject(input))
        return { ok: false, errors: [error('malformed_record', '$', 'payment job record must be an object')] };
    const record = input;
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
export function createPaymentAgreementRecord(input) {
    const id = input.id ?? deriveReddiPaymentId('agreement', {
        jobId: input.jobId,
        signedOfferHash: input.signedOfferHash,
        buyerPolicyDecisionHash: input.buyerPolicyDecisionHash,
        sellerTermsHash: input.sellerTermsHash,
        quoteExpiresAt: input.quoteExpiresAt,
    });
    const record = {
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
export function validatePaymentAgreementRecord(input) {
    const errors = [];
    if (!isPlainObject(input))
        return { ok: false, errors: [error('malformed_record', '$', 'payment agreement record must be an object')] };
    const record = input;
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
export function createPaymentIntentRecord(input) {
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
    const record = {
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
export function createPaymentIntentDraft(input) {
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
export function validatePaymentIntentRecord(input) {
    const errors = [];
    if (!isPlainObject(input))
        return { ok: false, errors: [error('malformed_record', '$', 'payment intent record must be an object')] };
    const record = input;
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
    if (typeof record.evidenceRequired !== 'boolean')
        errors.push(error('malformed_record', '$.evidenceRequired', 'evidenceRequired must be boolean'));
    validateTimestamp(record.quoteExpiresAt, '$.quoteExpiresAt', errors);
    validateTimestamp(record.expiresAt, '$.expiresAt', errors);
    validateRefundPolicy(record.refundPolicy, '$.refundPolicy', errors);
    validateAuthorization(record.authorization, '$.authorization', errors);
    validateOptionalTimestamp(record.createdAt, '$.createdAt', errors);
    return errors.length === 0 ? { ok: true, record } : { ok: false, errors };
}
export function formatPaymentObservationProofRef(input) {
    const network = input.network.rapAlias ?? input.network.caip2;
    const params = new URLSearchParams();
    params.set('ix', String(input.instructionIndex));
    if (input.mint)
        params.set('mint', input.mint);
    params.set('amount', input.amountBaseUnits);
    return `${network}:${input.asset}:${input.signature}#${params.toString()}`;
}
export function createPaymentObservationRecord(input) {
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
    const record = {
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
export function validatePaymentObservationRecord(input) {
    const errors = [];
    if (!isPlainObject(input))
        return { ok: false, errors: [error('malformed_record', '$', 'payment observation record must be an object')] };
    const record = input;
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
    }
    else {
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
export function createRefundRecord(input) {
    const id = input.id ?? deriveReddiPaymentId('refund', {
        originalPaymentObservationId: input.originalPaymentObservationId,
        refundObservationId: input.refundObservationId,
        refundSignature: input.refundSignature,
        amountBaseUnits: input.amountBaseUnits,
        reason: input.reason,
    });
    const record = {
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
export function validateRefundRecord(input) {
    const errors = [];
    if (!isPlainObject(input))
        return { ok: false, errors: [error('malformed_record', '$', 'refund record must be an object')] };
    const record = input;
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
function canonicalize(value) {
    if (value === null)
        return 'null';
    if (typeof value === 'string' || typeof value === 'boolean')
        return JSON.stringify(value);
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            throw new Error('canonicalize_non_finite_number');
        return JSON.stringify(value);
    }
    if (typeof value === 'bigint')
        return JSON.stringify(value.toString());
    if (Array.isArray(value))
        return `[${value.map((item) => canonicalize(item)).join(',')}]`;
    if (!isPlainObject(value))
        throw new Error('canonicalize_unsupported_value');
    const entries = Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${canonicalize(nested)}`).join(',')}}`;
}
function validateAuthorization(value, path, errors) {
    if (!isPlainObject(value)) {
        errors.push(error('malformed_record', path, 'authorization metadata is required'));
        return;
    }
    const authorization = value;
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
function validateRefundPolicy(value, path, errors) {
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
function validateNetwork(value, path, errors) {
    if (!isPlainObject(value)) {
        errors.push(error('malformed_record', path, 'network ref is required'));
        return;
    }
    requireString(value.caip2, `${path}.caip2`, errors);
    validateOptionalString(value.rapAlias, `${path}.rapAlias`, errors);
}
function appendLabelErrors(result, errors) {
    if (!result.ok)
        errors.push(...result.errors);
}
function throwIfInvalid(result, prefix) {
    if (!result.ok)
        throw new Error(`${prefix}:${result.errors.map((item) => `${item.code}:${item.path}`).join(',')}`);
}
function requireLiteral(value, expected, path, errors) {
    if (value !== expected)
        errors.push(error('malformed_record', path, `expected ${expected}`));
}
function requirePrefix(value, prefix, path, errors) {
    if (!isNonEmptyString(value) || !value.startsWith(prefix))
        errors.push(error('malformed_record', path, `expected id prefix ${prefix}`));
}
function validateOptionalPrefix(value, prefix, path, errors) {
    if (value !== undefined && (!isNonEmptyString(value) || !value.startsWith(prefix))) {
        errors.push(error('malformed_record', path, `expected id prefix ${prefix}`));
    }
}
function requireHash(value, path, errors) {
    if (!isNonEmptyString(value) || !HASH_PATTERN.test(value))
        errors.push(error('malformed_record', path, 'expected sha256:<hex> hash'));
}
function requireString(value, path, errors) {
    if (!isNonEmptyString(value))
        errors.push(error('malformed_record', path, 'required string is missing'));
}
function validateOptionalString(value, path, errors) {
    if (value !== undefined && !isNonEmptyString(value))
        errors.push(error('malformed_record', path, 'must be a non-empty string when present'));
}
function requirePositiveAmount(value, path, errors) {
    if (!isNonEmptyString(value) || !POSITIVE_AMOUNT_PATTERN.test(value)) {
        errors.push(error('malformed_record', path, 'amount must be a positive integer string in base units'));
    }
}
function validateOptionalNumber(value, path, errors) {
    if (value !== undefined && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)) {
        errors.push(error('malformed_record', path, 'must be a non-negative safe integer when present'));
    }
}
function validateTimestamp(value, path, errors) {
    if (!isNonEmptyString(value) || Number.isNaN(Date.parse(value))) {
        errors.push(error('malformed_record', path, 'timestamp must be an ISO-parseable string'));
    }
}
function validateOptionalTimestamp(value, path, errors) {
    if (value !== undefined)
        validateTimestamp(value, path, errors);
}
function isPaymentEnvironment(value) {
    return ['deterministic-fixture', 'local-test-mint', 'devnet-unverified', 'mainnet-gated', 'controlled-live'].includes(String(value));
}
function isPaymentEligibility(value) {
    return ['non_eligible', 'pending_partner_acceptance', 'eligible', 'excluded'].includes(String(value));
}
function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function error(code, path, message) {
    return { code, path, message };
}
