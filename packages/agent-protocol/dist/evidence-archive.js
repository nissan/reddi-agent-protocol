import { createHash } from 'node:crypto';
export const EVIDENCE_ARCHIVE_RECORD_SCHEMA_VERSION = 'reddi.evidence-archive.v1';
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
function hashJson(value) {
    try {
        return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
    }
    catch {
        return undefined;
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
function requireString(value, path, errors) {
    if (!isNonEmptyString(value))
        errors.push(error('malformed_evidence_record', path, 'required string is missing'));
}
function requireHash(value, path, errors) {
    if (!isNonEmptyString(value) || !HASH_PATTERN.test(value)) {
        errors.push(error('malformed_evidence_record', path, 'hash must be a sha256:<hex> reference'));
    }
}
function validatePublicReference(value, path, errors) {
    if (!isNonEmptyString(value))
        return;
    if (SENSITIVE_VALUE_PATTERN.test(value)) {
        errors.push(error('credential_leakage_rejected', path, 'public evidence references must not include credential-shaped values'));
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
        errors.push(error('credential_leakage_rejected', path, 'public evidence references must not embed credentials'));
    }
    for (const key of parsed.searchParams.keys()) {
        if (SENSITIVE_KEY_PATTERN.test(key)) {
            errors.push(error('credential_leakage_rejected', `${path}.${key}`, 'public evidence references must not include credential-shaped query keys'));
        }
    }
    for (const queryValue of parsed.searchParams.values()) {
        if (SENSITIVE_VALUE_PATTERN.test(queryValue)) {
            errors.push(error('credential_leakage_rejected', path, 'public evidence references must not include credential-shaped query values'));
        }
    }
}
function validateExternalPointer(value, errors) {
    if (value === undefined)
        return;
    if (!isPlainObject(value)) {
        errors.push(error('malformed_evidence_record', '$.externalArchivePointer', 'externalArchivePointer must be an object'));
        return;
    }
    if (!['walrus', 'seal', 'ipfs', 'custom'].includes(String(value.provider))) {
        errors.push(error('malformed_evidence_record', '$.externalArchivePointer.provider', 'external archive provider is unsupported'));
    }
    requireString(value.uri, '$.externalArchivePointer.uri', errors);
    validatePublicReference(value.uri, '$.externalArchivePointer.uri', errors);
    if (value.contentHash !== undefined)
        requireHash(value.contentHash, '$.externalArchivePointer.contentHash', errors);
}
export function validateEvidenceArchiveRecord(input, evidencePayload, options = {}) {
    const errors = [];
    if (!isPlainObject(input)) {
        return { ok: false, errors: [error('malformed_evidence_record', '$', 'evidence archive record must be a plain object')] };
    }
    const record = input;
    if (record.schemaVersion !== EVIDENCE_ARCHIVE_RECORD_SCHEMA_VERSION) {
        errors.push(error('malformed_evidence_record', '$.schemaVersion', `expected ${EVIDENCE_ARCHIVE_RECORD_SCHEMA_VERSION}`));
    }
    requireString(record.id, '$.id', errors);
    requireString(record.receiptId, '$.receiptId', errors);
    requireString(record.sourceId, '$.sourceId', errors);
    requireHash(record.requestHash, '$.requestHash', errors);
    requireHash(record.responseHash, '$.responseHash', errors);
    requireHash(record.evidenceHash, '$.evidenceHash', errors);
    requireString(record.evidenceRef, '$.evidenceRef', errors);
    validatePublicReference(record.evidenceRef, '$.evidenceRef', errors);
    if (record.attestationId !== undefined)
        requireString(record.attestationId, '$.attestationId', errors);
    if (!isNonEmptyString(record.createdAt) || Number.isNaN(Date.parse(record.createdAt))) {
        errors.push(error('malformed_evidence_record', '$.createdAt', 'createdAt must be an ISO timestamp'));
    }
    validateExternalPointer(record.externalArchivePointer, errors);
    const credentialPath = findCredentialMaterial(record.metadata);
    if (credentialPath) {
        errors.push(error('credential_leakage_rejected', `$.metadata${credentialPath.slice(1)}`, 'evidence metadata contains credential-shaped material'));
    }
    const requireEvidencePayloadOrPointer = options.requireEvidencePayloadOrPointer ?? true;
    if (requireEvidencePayloadOrPointer && evidencePayload === undefined && !record.externalArchivePointer) {
        errors.push(error('evidence_missing', '$.evidencePayload', 'local evidence payload or external archive pointer is required'));
    }
    if (evidencePayload !== undefined) {
        const payloadCredentialPath = findCredentialMaterial(evidencePayload);
        if (payloadCredentialPath) {
            errors.push(error('credential_leakage_rejected', `$.evidencePayload${payloadCredentialPath.slice(1)}`, 'evidence payload contains credential-shaped material'));
        }
        const expectedHash = hashJson(evidencePayload);
        if (!expectedHash) {
            errors.push(error('malformed_evidence_record', '$.evidencePayload', 'evidence payload must be JSON-serializable'));
        }
        else if (record.evidenceHash && expectedHash !== record.evidenceHash) {
            errors.push(error('hash_mismatch', '$.evidenceHash', 'evidenceHash does not match the supplied evidence payload'));
        }
    }
    return errors.length === 0 ? { ok: true, record } : { ok: false, errors };
}
export function createEvidenceArchiveRecord(input) {
    const evidenceHash = input.evidenceHash ?? hashJson(input.evidencePayload);
    const record = {
        schemaVersion: EVIDENCE_ARCHIVE_RECORD_SCHEMA_VERSION,
        id: input.id,
        receiptId: input.receiptId,
        sourceId: input.sourceId,
        requestHash: input.requestHash,
        responseHash: input.responseHash,
        evidenceHash: evidenceHash ?? '',
        evidenceRef: input.evidenceRef,
        attestationId: input.attestationId,
        externalArchivePointer: input.externalArchivePointer,
        createdAt: input.createdAt,
        metadata: input.metadata,
    };
    const validation = validateEvidenceArchiveRecord(record, input.evidencePayload);
    if (!validation.ok) {
        throw new Error(`invalid_evidence_archive_record:${validation.errors.map((item) => `${item.code}:${item.path}`).join(',')}`);
    }
    return validation.record;
}
export function createLocalEvidenceArchive(initialRecords = []) {
    const records = new Map();
    for (const record of initialRecords) {
        const result = validateEvidenceArchiveRecord(record, undefined, { requireEvidencePayloadOrPointer: false });
        if (!result.ok) {
            throw new Error(`invalid_initial_evidence_archive_record:${result.errors.map((item) => item.code).join(',')}`);
        }
        records.set(record.id, record);
    }
    return {
        put(record) {
            const result = validateEvidenceArchiveRecord(record, undefined, { requireEvidencePayloadOrPointer: false });
            if (!result.ok)
                return result;
            records.set(record.id, result.record);
            return result;
        },
        get(id) {
            const record = records.get(id);
            if (!record) {
                return { ok: false, error: error('evidence_missing', '$.id', `No evidence archive record found for ${id}`) };
            }
            return { ok: true, record };
        },
        has(id) {
            return records.has(id);
        },
        list() {
            return [...records.values()];
        },
    };
}
export const evidenceArchiveFixtures = {
    evidencePayload: {
        request: { hash: 'sha256:7b2d0ef8455d0f0f41a37ea5e6a47f52c0d73d97f426097f159a98f8c8fb6b15' },
        response: { hash: 'sha256:8c9d1f1e3d0f02b5afcbb31dfbb3ab3de70ce1b84ff3ca856d272b2f4f7f4501' },
        resultSummary: 'Planning specialist completed a deterministic no-spend fixture run.',
    },
};
export const evidenceArchiveFixtureRecord = createEvidenceArchiveRecord({
    id: 'evidence:planning-001',
    receiptId: 'job:planning-001',
    sourceId: 'source:planning',
    requestHash: 'sha256:7b2d0ef8455d0f0f41a37ea5e6a47f52c0d73d97f426097f159a98f8c8fb6b15',
    responseHash: 'sha256:8c9d1f1e3d0f02b5afcbb31dfbb3ab3de70ce1b84ff3ca856d272b2f4f7f4501',
    evidenceRef: 'file://fixtures/evidence/planning-001.json',
    attestationId: 'attestation:planning-001',
    createdAt: '2026-06-18T12:15:00.000Z',
    evidencePayload: evidenceArchiveFixtures.evidencePayload,
});
