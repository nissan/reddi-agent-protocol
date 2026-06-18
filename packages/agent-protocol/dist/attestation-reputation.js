export const ATTESTATION_RECORD_SCHEMA_VERSION = 'reddi.attestation.v1';
export const REPUTATION_EVENT_SCHEMA_VERSION = 'reddi.reputation-event.v1';
export const REPUTATION_STATE_SCHEMA_VERSION = 'reddi.reputation-state.v1';
export const DEFAULT_ATTESTATION_RUBRIC_DIMENSIONS = [
    'evidence_integrity',
    'policy_compliance',
    'delivery_quality',
];
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SENSITIVE_KEY_PATTERN = /(^|[_-])(api[_-]?key|authorization|bearer|cookie|credential|mnemonic|password|private[_-]?key|refresh[_-]?token|secret|seed|session[_-]?token|signature|sig|signed|token)($|[_-])|apiKey|accessToken|refreshToken|sessionToken|privateKey|X-Goog-Signature|X-Amz-Signature/i;
const SENSITIVE_VALUE_PATTERN = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|authorization:\s*bearer\s+|bearer\s+[a-z0-9._-]{8,}|sk-[a-z0-9_-]{8,})/i;
function error(code, path, message) {
    return { code, path, message };
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
function requireString(value, path, errors) {
    if (!isNonEmptyString(value))
        errors.push(error('malformed_attestation', path, 'required string is missing'));
}
function requireHash(value, path, errors) {
    if (!isNonEmptyString(value) || !HASH_PATTERN.test(value)) {
        errors.push(error('malformed_attestation', path, 'hash must be a sha256:<hex> reference'));
    }
}
function validatePublicReference(value, path, errors) {
    if (!isNonEmptyString(value))
        return;
    if (SENSITIVE_VALUE_PATTERN.test(value)) {
        errors.push(error('credential_leakage_rejected', path, 'public attestation references must not include credential-shaped values'));
        return;
    }
    let parsed;
    try {
        parsed = new URL(value);
    }
    catch {
        return;
    }
    if (parsed.username || parsed.password) {
        errors.push(error('credential_leakage_rejected', path, 'public attestation references must not embed credentials'));
    }
    for (const key of parsed.searchParams.keys()) {
        if (SENSITIVE_KEY_PATTERN.test(key)) {
            errors.push(error('credential_leakage_rejected', `${path}.${key}`, 'public attestation references must not include credential-shaped query keys'));
        }
    }
    for (const queryValue of parsed.searchParams.values()) {
        if (SENSITIVE_VALUE_PATTERN.test(queryValue)) {
            errors.push(error('credential_leakage_rejected', path, 'public attestation references must not include credential-shaped query values'));
        }
    }
}
function findCredentialMaterial(value, path = '$') {
    if (typeof value === 'string')
        return SENSITIVE_VALUE_PATTERN.test(value) ? path : undefined;
    if (!value || typeof value !== 'object')
        return undefined;
    if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
            const found = findCredentialMaterial(value[index], `${path}[${index}]`);
            if (found)
                return found;
        }
        return undefined;
    }
    for (const [key, nested] of Object.entries(value)) {
        const nextPath = `${path}.${key}`;
        if (SENSITIVE_KEY_PATTERN.test(key))
            return nextPath;
        const found = findCredentialMaterial(nested, nextPath);
        if (found)
            return found;
    }
    return undefined;
}
function weightedRubricScore(dimensions) {
    const totalWeight = dimensions.reduce((sum, dimension) => sum + dimension.weight, 0);
    if (totalWeight <= 0)
        return 0;
    const weighted = dimensions.reduce((sum, dimension) => sum + (dimension.score * dimension.weight), 0);
    return Math.round(weighted / totalWeight);
}
function clampScore(score) {
    return Math.max(0, Math.min(1000, score));
}
function routingImpact(score) {
    if (score >= 750)
        return 'preferred';
    if (score >= 500)
        return 'eligible';
    if (score >= 350)
        return 'watch';
    if (score > 0)
        return 'deprioritized';
    return 'blocked';
}
function baseDelta(attestation, rubricScore) {
    if (attestation.workStatus === 'failed' || attestation.verdict === 'failed')
        return -80;
    if (attestation.workStatus === 'disputed' || attestation.verdict === 'disputed')
        return -50;
    if (attestation.workStatus === 'refunded' || attestation.verdict === 'refunded')
        return -35;
    if (rubricScore < 60)
        return -25;
    if (rubricScore < 75)
        return 5;
    if (rubricScore < 90)
        return 18;
    return 30;
}
function eventReasonCodes(attestation, rubricScore) {
    const codes = ['evidence_attached'];
    if (attestation.verdict === 'passed')
        codes.push('attestation_passed');
    if (attestation.verdict === 'failed')
        codes.push('attestation_failed');
    if (attestation.workStatus === 'disputed' || attestation.verdict === 'disputed')
        codes.push('work_disputed');
    if (attestation.workStatus === 'refunded' || attestation.verdict === 'refunded')
        codes.push('work_refunded');
    if (attestation.confidence < 70)
        codes.push('low_confidence');
    if (rubricScore < 75)
        codes.push('rubric_below_threshold');
    return codes;
}
export function validateAttestationRecord(input) {
    const errors = [];
    if (!isPlainObject(input)) {
        return { ok: false, errors: [error('malformed_attestation', '$', 'attestation record must be a plain object')] };
    }
    const attestation = input;
    if (attestation.schemaVersion !== ATTESTATION_RECORD_SCHEMA_VERSION) {
        errors.push(error('malformed_attestation', '$.schemaVersion', `expected ${ATTESTATION_RECORD_SCHEMA_VERSION}`));
    }
    requireString(attestation.id, '$.id', errors);
    requireString(attestation.receiptId, '$.receiptId', errors);
    requireString(attestation.evidenceId, '$.evidenceId', errors);
    requireString(attestation.evidenceRef, '$.evidenceRef', errors);
    validatePublicReference(attestation.evidenceRef, '$.evidenceRef', errors);
    requireHash(attestation.evidenceHash, '$.evidenceHash', errors);
    requireString(attestation.attestor?.id, '$.attestor.id', errors);
    if (!['self', 'external', 'reddi', 'local-fixture'].includes(String(attestation.attestor?.type))) {
        errors.push(error('malformed_attestation', '$.attestor.type', 'attestor type is unsupported'));
    }
    if (!['self_attested', 'external_attested', 'reddi_attested', 'verified'].includes(String(attestation.trustBoundary))) {
        errors.push(error('malformed_attestation', '$.trustBoundary', 'trust boundary is unsupported'));
    }
    if (!['passed', 'failed', 'disputed', 'refunded'].includes(String(attestation.verdict))) {
        errors.push(error('malformed_attestation', '$.verdict', 'verdict is unsupported'));
    }
    if (!['completed', 'failed', 'disputed', 'refunded'].includes(String(attestation.workStatus))) {
        errors.push(error('malformed_attestation', '$.workStatus', 'work status is unsupported'));
    }
    if (!Number.isInteger(attestation.confidence) || attestation.confidence < 0 || attestation.confidence > 100) {
        errors.push(error('malformed_attestation', '$.confidence', 'confidence must be an integer from 0 to 100'));
    }
    if (!isNonEmptyString(attestation.createdAt) || Number.isNaN(Date.parse(attestation.createdAt))) {
        errors.push(error('malformed_attestation', '$.createdAt', 'createdAt must be an ISO timestamp'));
    }
    if (!isPlainObject(attestation.rubric) || !Array.isArray(attestation.rubric.dimensions)) {
        errors.push(error('missing_rubric_dimension', '$.rubric.dimensions', 'rubric dimensions are required'));
    }
    else {
        const seen = new Set();
        for (const [index, dimension] of attestation.rubric.dimensions.entries()) {
            const path = `$.rubric.dimensions[${index}]`;
            if (!isPlainObject(dimension)) {
                errors.push(error('invalid_rubric_dimension', path, 'rubric dimension must be an object'));
                continue;
            }
            requireString(dimension.id, `${path}.id`, errors);
            if (isNonEmptyString(dimension.id))
                seen.add(dimension.id);
            if (!Number.isInteger(dimension.score) || dimension.score < 0 || dimension.score > 100) {
                errors.push(error('invalid_rubric_dimension', `${path}.score`, 'rubric score must be an integer from 0 to 100'));
            }
            if (!Number.isInteger(dimension.weight) || dimension.weight <= 0) {
                errors.push(error('invalid_rubric_dimension', `${path}.weight`, 'rubric weight must be a positive integer'));
            }
            requireString(dimension.summary, `${path}.summary`, errors);
            if (!Array.isArray(dimension.reasonCodes) || dimension.reasonCodes.some((code) => typeof code !== 'string' || code.trim().length === 0)) {
                errors.push(error('invalid_rubric_dimension', `${path}.reasonCodes`, 'reasonCodes must be a non-empty string array'));
            }
        }
        for (const dimensionId of DEFAULT_ATTESTATION_RUBRIC_DIMENSIONS) {
            if (!seen.has(dimensionId)) {
                errors.push(error('missing_rubric_dimension', '$.rubric.dimensions', `missing required rubric dimension ${dimensionId}`));
            }
        }
    }
    const credentialPath = findCredentialMaterial(attestation.metadata);
    if (credentialPath) {
        errors.push(error('credential_leakage_rejected', `$.metadata${credentialPath.slice(1)}`, 'attestation metadata contains credential-shaped material'));
    }
    return errors.length === 0 ? { ok: true, attestation } : { ok: false, errors };
}
export function createAttestationRecord(input) {
    const result = validateAttestationRecord(input);
    if (!result.ok) {
        throw new Error(`invalid_attestation_record:${result.errors.map((item) => `${item.code}:${item.path}`).join(',')}`);
    }
    return result.attestation;
}
export function createInitialReputationState(subject, updatedAt = '1970-01-01T00:00:00.000Z') {
    return {
        schemaVersion: REPUTATION_STATE_SCHEMA_VERSION,
        subject,
        score: 500,
        routingImpact: 'unproven',
        completedJobs: 0,
        attestedJobs: 0,
        failedJobs: 0,
        disputedJobs: 0,
        refundedJobs: 0,
        updatedAt,
    };
}
export function applyAttestationToReputation(attestationInput, previousState, options = {}) {
    const validation = validateAttestationRecord(attestationInput);
    const state = previousState ?? createInitialReputationState(options.subject ?? { id: 'unknown', type: 'specialist' }, options.now ?? '1970-01-01T00:00:00.000Z');
    if (!validation.ok) {
        return { ok: false, errors: validation.errors, state };
    }
    const attestation = validation.attestation;
    const subject = previousState?.subject ?? options.subject ?? { id: attestation.receiptId, type: 'specialist' };
    const rubricScore = weightedRubricScore(attestation.rubric.dimensions);
    const rawDelta = baseDelta(attestation, rubricScore);
    const delta = Math.round((rawDelta * attestation.confidence) / 100);
    const previousScore = state.score;
    const nextScore = clampScore(previousScore + delta);
    const nextImpact = routingImpact(nextScore);
    const createdAt = options.now ?? attestation.createdAt;
    const event = {
        schemaVersion: REPUTATION_EVENT_SCHEMA_VERSION,
        id: `reputation:${attestation.id}`,
        subjectId: subject.id,
        receiptId: attestation.receiptId,
        attestationId: attestation.id,
        evidenceId: attestation.evidenceId,
        verdict: attestation.verdict,
        workStatus: attestation.workStatus,
        trustBoundary: attestation.trustBoundary,
        confidence: attestation.confidence,
        rubricScore,
        delta,
        previousScore,
        nextScore,
        routingImpact: nextImpact,
        reasonCodes: eventReasonCodes(attestation, rubricScore),
        createdAt,
    };
    return {
        ok: true,
        event,
        state: {
            ...state,
            subject,
            score: nextScore,
            routingImpact: nextImpact,
            completedJobs: state.completedJobs + (attestation.workStatus === 'completed' ? 1 : 0),
            attestedJobs: state.attestedJobs + 1,
            failedJobs: state.failedJobs + (attestation.workStatus === 'failed' ? 1 : 0),
            disputedJobs: state.disputedJobs + (attestation.workStatus === 'disputed' ? 1 : 0),
            refundedJobs: state.refundedJobs + (attestation.workStatus === 'refunded' ? 1 : 0),
            lastEventId: event.id,
            updatedAt: createdAt,
        },
    };
}
