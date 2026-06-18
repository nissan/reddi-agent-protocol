export declare const EVIDENCE_ARCHIVE_RECORD_SCHEMA_VERSION: "reddi.evidence-archive.v1";
export type EvidenceArchiveRecord = {
    schemaVersion: typeof EVIDENCE_ARCHIVE_RECORD_SCHEMA_VERSION;
    id: string;
    receiptId: string;
    sourceId: string;
    requestHash: string;
    responseHash: string;
    evidenceHash: string;
    evidenceRef: string;
    attestationId?: string;
    externalArchivePointer?: {
        provider: 'walrus' | 'seal' | 'ipfs' | 'custom';
        uri: string;
        contentHash?: string;
    };
    createdAt: string;
    metadata?: Record<string, unknown>;
};
export type EvidenceArchiveValidationErrorCode = 'malformed_evidence_record' | 'hash_mismatch' | 'evidence_missing' | 'credential_leakage_rejected';
export type EvidenceArchiveValidationError = {
    code: EvidenceArchiveValidationErrorCode;
    path: string;
    message: string;
};
export type EvidenceArchiveValidationResult = {
    ok: true;
    record: EvidenceArchiveRecord;
} | {
    ok: false;
    errors: EvidenceArchiveValidationError[];
};
export type EvidenceArchiveLookupResult = {
    ok: true;
    record: EvidenceArchiveRecord;
} | {
    ok: false;
    error: EvidenceArchiveValidationError;
};
export type EvidenceArchiveCreateInput = Omit<EvidenceArchiveRecord, 'schemaVersion' | 'evidenceHash'> & {
    evidencePayload?: unknown;
    evidenceHash?: string;
};
export type EvidenceArchiveValidationOptions = {
    requireEvidencePayloadOrPointer?: boolean;
};
export type LocalEvidenceArchive = {
    put(record: EvidenceArchiveRecord): EvidenceArchiveValidationResult;
    get(id: string): EvidenceArchiveLookupResult;
    has(id: string): boolean;
    list(): EvidenceArchiveRecord[];
};
export declare function validateEvidenceArchiveRecord(input: unknown, evidencePayload?: unknown, options?: EvidenceArchiveValidationOptions): EvidenceArchiveValidationResult;
export declare function createEvidenceArchiveRecord(input: EvidenceArchiveCreateInput): EvidenceArchiveRecord;
export declare function createLocalEvidenceArchive(initialRecords?: EvidenceArchiveRecord[]): LocalEvidenceArchive;
export declare const evidenceArchiveFixtures: {
    readonly evidencePayload: {
        readonly request: {
            readonly hash: "sha256:7b2d0ef8455d0f0f41a37ea5e6a47f52c0d73d97f426097f159a98f8c8fb6b15";
        };
        readonly response: {
            readonly hash: "sha256:8c9d1f1e3d0f02b5afcbb31dfbb3ab3de70ce1b84ff3ca856d272b2f4f7f4501";
        };
        readonly resultSummary: "Planning specialist completed a deterministic no-spend fixture run.";
    };
};
export declare const evidenceArchiveFixtureRecord: EvidenceArchiveRecord;
