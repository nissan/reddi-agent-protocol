import { validateAttestationRecord, } from './attestation-reputation.js';
import { validateEvidenceArchiveRecord, } from './evidence-archive.js';
import { validatePaymentObservationRecord, } from './payment-records.js';
import { validateReddiReceipt, } from './receipts.js';
export const RECEIPT_EVIDENCE_BINDING_SCHEMA_VERSION = 'reddi.receipt-evidence-binding.v1';
const SENSITIVE_KEY_PATTERN = /(^|[_-])(api[_-]?key|authorization|bearer|cookie|credential|mnemonic|password|private[_-]?key|refresh[_-]?token|secret|seed|session[_-]?token|signature|sig|signed|token)($|[_-])|apiKey|accessToken|refreshToken|sessionToken|privateKey|X-Goog-Signature|X-Amz-Signature/i;
const SENSITIVE_VALUE_PATTERN = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|authorization:\s*bearer\s+|bearer\s+[a-z0-9._-]{8,}|sk-[a-z0-9_-]{8,})/i;
const RAW_PAYLOAD_KEY_PATTERN = /(^|[_-])(raw[_-]?prompt|prompt|completion|raw[_-]?output|output|transcript)($|[_-])/i;
export function createReceiptEvidenceBinding(input) {
    const result = deriveReceiptEvidenceBinding(input);
    if (!result.ok) {
        throw new Error(`invalid_receipt_evidence_binding:${result.errors.map((item) => `${item.code}:${item.path}`).join(',')}`);
    }
    return result.binding;
}
export function deriveReceiptEvidenceBinding(input) {
    const errors = [];
    if (!isNonEmptyString(input.id)) {
        errors.push(error('malformed_binding', '$.id', 'binding id is required'));
    }
    if (!isNonEmptyString(input.createdAt) || Number.isNaN(Date.parse(input.createdAt))) {
        errors.push(error('malformed_binding', '$.createdAt', 'createdAt must be an ISO timestamp'));
    }
    validateSource(input.source, errors);
    const receiptValidation = validateReddiReceipt(input.receipt);
    if (!receiptValidation.ok) {
        errors.push(...receiptValidation.errors.map((item) => error(mapReceiptError(item.code), `$.receipt${item.path.slice(1)}`, item.message)));
    }
    const evidenceValidation = validateEvidenceArchiveRecord(input.evidence, input.evidencePayload);
    if (!evidenceValidation.ok) {
        errors.push(...evidenceValidation.errors.map((item) => error(mapEvidenceError(item.code), `$.evidence${item.path.slice(1)}`, item.message)));
    }
    if (containsRawPayload(input.evidencePayload)) {
        errors.push(error('raw_payload_leakage_rejected', '$.evidencePayload', 'raw prompt/output payloads must be replaced by hashes or references before binding'));
    }
    if (containsCredentialMaterial(input.source)) {
        errors.push(error('credential_leakage_rejected', '$.source', 'source refs must not contain credential-shaped material'));
    }
    validatePaymentPreflight(input, errors);
    validatePaymentObservation(input, errors);
    validateRecordLinks(input, errors);
    validateAttestation(input, errors);
    validateReputationEvent(input, errors);
    if (errors.length > 0)
        return { ok: false, errors };
    const plan = input.paymentPreflight.paymentPlan;
    if (!plan || !input.paymentPreflight.paymentProofRef) {
        return {
            ok: false,
            errors: [error('missing_payment_preflight', '$.paymentPreflight', 'payment preflight proof is required')],
        };
    }
    return {
        ok: true,
        binding: {
            schemaVersion: RECEIPT_EVIDENCE_BINDING_SCHEMA_VERSION,
            id: input.id,
            source: input.source,
            receipt: {
                id: input.receipt.job.id,
                sourceId: input.receipt.source.id,
                policyDecision: input.receipt.policyDecision,
                paymentProofRef: input.receipt.payment.paymentProofRef,
                requestHash: input.receipt.requestHash,
                responseHash: input.receipt.responseHash,
                evidenceRef: input.receipt.evidenceRef,
                attestationStatus: input.receipt.attestationStatus,
            },
            evidence: {
                id: input.evidence.id,
                receiptId: input.evidence.receiptId,
                evidenceRef: input.evidence.evidenceRef,
                evidenceHash: input.evidence.evidenceHash,
                externalArchivePointer: input.evidence.externalArchivePointer,
            },
            payment: {
                preflightAllowed: input.paymentPreflight.allowed,
                reasonCodes: input.paymentPreflight.reasonCodes,
                paymentProofRef: input.paymentPreflight.paymentProofRef,
                planRef: {
                    asset: plan.asset,
                    network: plan.network,
                    amount: plan.amount,
                    paymentMode: plan.paymentMode,
                    evidenceRequired: plan.evidenceRequired,
                },
                observationRef: input.paymentObservation
                    ? {
                        id: input.paymentObservation.id,
                        environment: input.paymentObservation.labels.environment,
                        eligibility: input.paymentObservation.labels.eligibility,
                        paymentProofRef: input.paymentObservation.payment.paymentProofRef,
                        signature: input.paymentObservation.payment.signature,
                        mint: input.paymentObservation.payment.mint,
                        tokenProgram: input.paymentObservation.payment.tokenProgram,
                        instructionIndex: input.paymentObservation.payment.instructionIndex,
                    }
                    : undefined,
            },
            attestation: input.attestation
                ? {
                    id: input.attestation.id,
                    status: input.receipt.attestationStatus,
                    verdict: input.attestation.verdict,
                    trustBoundary: input.attestation.trustBoundary,
                }
                : undefined,
            reputationEventDraft: input.reputationEventDraft,
            guardrails: {
                rawPromptStored: false,
                rawOutputStored: false,
                livePaymentExecuted: false,
                walletSigning: false,
                rpcCall: false,
                hostedRegistryRequired: false,
                reputationMutated: false,
            },
            createdAt: input.createdAt,
        },
    };
}
function validateSource(source, errors) {
    if (!source || !['ai-catalog', 'ard-registry', 'hosted-rap-registry', 'source-adapter', 'static-fixture'].includes(String(source.kind))) {
        errors.push(error('missing_source_ref', '$.source.kind', 'source kind is required'));
    }
    if (!isNonEmptyString(source?.sourceId)) {
        errors.push(error('missing_source_ref', '$.source.sourceId', 'source id is required'));
    }
    if (![source?.catalogRef, source?.fixtureRef, source?.listingId, source?.profileId, source?.rawSnapshotRef].some(isNonEmptyString)) {
        errors.push(error('missing_source_ref', '$.source', 'source must include catalog, fixture, listing, profile, or raw snapshot ref'));
    }
}
function validatePaymentPreflight(input, errors) {
    const proof = input.paymentPreflight;
    if (!proof || typeof proof.allowed !== 'boolean') {
        errors.push(error('missing_payment_preflight', '$.paymentPreflight', 'AUDD payment plan preflight proof is required'));
        return;
    }
    if (!proof.allowed) {
        errors.push(error('payment_preflight_denied', '$.paymentPreflight.allowed', 'payment preflight must be allowed before binding'));
    }
    if (!isNonEmptyString(proof.paymentProofRef)) {
        errors.push(error('missing_payment_preflight', '$.paymentPreflight.paymentProofRef', 'payment proof ref is required'));
    }
    else if (proof.paymentProofRef !== input.receipt.payment.paymentProofRef) {
        errors.push(error('payment_proof_mismatch', '$.paymentPreflight.paymentProofRef', 'payment preflight proof must match receipt payment proof'));
    }
    if (!proof.paymentPlan) {
        errors.push(error('missing_payment_preflight', '$.paymentPreflight.paymentPlan', 'payment plan metadata is required'));
        return;
    }
    if (proof.paymentPlan.asset !== input.receipt.payment.asset
        || proof.paymentPlan.network !== input.receipt.payment.network
        || proof.paymentPlan.amount !== input.receipt.payment.amount) {
        errors.push(error('payment_plan_mismatch', '$.paymentPreflight.paymentPlan', 'payment plan asset/network/amount must match receipt payment'));
    }
    if (proof.policyDecision && proof.policyDecision !== input.receipt.policyDecision) {
        const policy = proof.policyDecision;
        if (policy.allowed !== input.receipt.policyDecision.allowed
            || policy.asset !== input.receipt.policyDecision.asset
            || policy.network !== input.receipt.policyDecision.network
            || policy.approvalState !== input.receipt.policyDecision.approvalState) {
            errors.push(error('payment_plan_mismatch', '$.paymentPreflight.policyDecision', 'payment preflight policy decision must match receipt policy decision'));
        }
    }
}
function validatePaymentObservation(input, errors) {
    if (!input.paymentObservation)
        return;
    const observationValidation = validatePaymentObservationRecord(input.paymentObservation);
    if (!observationValidation.ok) {
        errors.push(...observationValidation.errors.map((item) => error(item.code === 'non_live_evidence_marked_eligible' ? 'payment_observation_ineligible' : 'payment_observation_mismatch', `$.paymentObservation${item.path.slice(1)}`, item.message)));
        return;
    }
    const observation = input.paymentObservation;
    if (observation.labels.eligibility === 'eligible' && ['deterministic-fixture', 'local-test-mint', 'devnet-unverified'].includes(observation.labels.environment)) {
        errors.push(error('payment_observation_ineligible', '$.paymentObservation.labels.eligibility', 'fixture, local-test-mint, and devnet payment observations are not eligible for grant-volume claims'));
    }
    if (observation.status !== 'observed_confirmed') {
        errors.push(error('payment_observation_mismatch', '$.paymentObservation.status', 'payment observation must be confirmed before receipt/evidence binding'));
    }
    if (observation.payment.paymentProofRef !== input.receipt.payment.paymentProofRef || observation.payment.paymentProofRef !== input.paymentPreflight.paymentProofRef) {
        errors.push(error('payment_observation_mismatch', '$.paymentObservation.payment.paymentProofRef', 'payment observation proof ref must match the receipt and payment preflight proof ref'));
    }
    if (observation.payment.asset !== input.receipt.payment.asset
        || (observation.payment.network.rapAlias ?? observation.payment.network.caip2) !== input.receipt.payment.network
        || observation.payment.amountBaseUnits !== input.receipt.payment.amount) {
        errors.push(error('payment_observation_mismatch', '$.paymentObservation.payment', 'payment observation asset/network/amount must match the receipt payment'));
    }
    if (input.paymentPreflight.paymentPlan) {
        const plan = input.paymentPreflight.paymentPlan;
        if (observation.payment.asset !== plan.asset
            || (observation.payment.network.rapAlias ?? observation.payment.network.caip2) !== plan.network
            || observation.payment.amountBaseUnits !== plan.amount
            || observation.payment.mint !== plan.mint
            || (plan.tokenProgram !== undefined && observation.payment.tokenProgram !== plan.tokenProgram)
            || observation.payment.payTo !== plan.payee
            || observation.payment.destinationTokenAccount !== plan.settlementAccount) {
            errors.push(error('payment_observation_mismatch', '$.paymentObservation.payment', 'payment observation must match the AUDD payment plan terms'));
        }
    }
}
function validateRecordLinks(input, errors) {
    if (input.receipt.source.id !== input.source.sourceId) {
        errors.push(error('evidence_receipt_mismatch', '$.receipt.source.id', 'receipt source must match binding source'));
    }
    if (input.evidence.sourceId !== input.source.sourceId) {
        errors.push(error('evidence_receipt_mismatch', '$.evidence.sourceId', 'evidence source must match binding source'));
    }
    if (input.evidence.receiptId !== input.receipt.job.id) {
        errors.push(error('evidence_receipt_mismatch', '$.evidence.receiptId', 'evidence receipt id must match receipt job id'));
    }
    if (input.evidence.requestHash !== input.receipt.requestHash) {
        errors.push(error('hash_mismatch', '$.evidence.requestHash', 'evidence request hash must match receipt request hash'));
    }
    if (input.evidence.responseHash !== input.receipt.responseHash) {
        errors.push(error('hash_mismatch', '$.evidence.responseHash', 'evidence response hash must match receipt response hash'));
    }
    if (input.evidence.evidenceRef !== input.receipt.evidenceRef) {
        errors.push(error('evidence_receipt_mismatch', '$.evidence.evidenceRef', 'evidence ref must match receipt evidence ref'));
    }
}
function validateAttestation(input, errors) {
    if (!input.attestation)
        return;
    const attestation = validateAttestationRecord(input.attestation);
    if (!attestation.ok) {
        errors.push(...attestation.errors.map((item) => error(mapAttestationError(item.code), `$.attestation${item.path.slice(1)}`, item.message)));
        return;
    }
    if (input.attestation.receiptId !== input.receipt.job.id) {
        errors.push(error('attestation_mismatch', '$.attestation.receiptId', 'attestation receipt id must match receipt job id'));
    }
    if (input.attestation.evidenceId !== input.evidence.id || input.attestation.evidenceHash !== input.evidence.evidenceHash) {
        errors.push(error('attestation_mismatch', '$.attestation.evidenceId', 'attestation evidence id/hash must match evidence archive record'));
    }
    if (input.receipt.attestationStatus === 'attested' && input.attestation.verdict !== 'passed') {
        errors.push(error('attestation_mismatch', '$.receipt.attestationStatus', 'attested receipts require a passed attestation draft'));
    }
}
function validateReputationEvent(input, errors) {
    if (!input.reputationEventDraft)
        return;
    if (!input.attestation) {
        errors.push(error('reputation_event_mismatch', '$.reputationEventDraft', 'reputation event draft requires attestation evidence'));
        return;
    }
    if (input.reputationEventDraft.receiptId !== input.receipt.job.id
        || input.reputationEventDraft.attestationId !== input.attestation.id
        || input.reputationEventDraft.evidenceId !== input.evidence.id) {
        errors.push(error('reputation_event_mismatch', '$.reputationEventDraft', 'reputation event draft must match receipt, attestation, and evidence ids'));
    }
}
function mapReceiptError(code) {
    return code === 'credential_leakage_rejected'
        ? 'credential_leakage_rejected'
        : code === 'payment_proof_missing'
            ? 'missing_payment_preflight'
            : code === 'unsupported_network_asset'
                ? 'unsupported_network_asset'
                : 'receipt_invalid';
}
function mapEvidenceError(code) {
    return code === 'credential_leakage_rejected'
        ? 'credential_leakage_rejected'
        : code === 'hash_mismatch'
            ? 'hash_mismatch'
            : code === 'evidence_missing'
                ? 'evidence_invalid'
                : 'evidence_invalid';
}
function mapAttestationError(code) {
    return code === 'credential_leakage_rejected' ? 'credential_leakage_rejected' : 'attestation_mismatch';
}
function containsRawPayload(value, path = '$') {
    if (!value || typeof value !== 'object')
        return false;
    if (Array.isArray(value))
        return value.some((item, index) => containsRawPayload(item, `${path}[${index}]`));
    for (const [key, nested] of Object.entries(value)) {
        if (RAW_PAYLOAD_KEY_PATTERN.test(key))
            return true;
        if (containsRawPayload(nested, `${path}.${key}`))
            return true;
    }
    return false;
}
function containsCredentialMaterial(value) {
    if (typeof value === 'string') {
        if (SENSITIVE_VALUE_PATTERN.test(value))
            return true;
        try {
            const parsed = new URL(value);
            if (parsed.username || parsed.password)
                return true;
            for (const key of parsed.searchParams.keys()) {
                if (SENSITIVE_KEY_PATTERN.test(key))
                    return true;
            }
            for (const queryValue of parsed.searchParams.values()) {
                if (SENSITIVE_VALUE_PATTERN.test(queryValue))
                    return true;
            }
        }
        catch {
            // Non-URL strings are checked by value pattern above.
        }
        return false;
    }
    if (!value || typeof value !== 'object')
        return false;
    if (Array.isArray(value))
        return value.some(containsCredentialMaterial);
    return Object.entries(value).some(([key, nested]) => SENSITIVE_KEY_PATTERN.test(key) || containsCredentialMaterial(nested));
}
function error(code, path, message) {
    return { code, path, message };
}
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
