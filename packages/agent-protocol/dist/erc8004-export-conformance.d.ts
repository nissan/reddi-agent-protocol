import { type Erc8004ExportBundle, type Erc8004ExportOptions, type Erc8004ExportReasonCode, type Erc8004ExportSource } from './erc8004-export.js';
import type { ReddiReceipt } from './receipts.js';
import type { AttestationRecord } from './attestation-reputation.js';
/**
 * `reddi.erc8004-export-conformance.v1` — NO-LIVE conformance surface for the
 * `reddi.erc8004-export.v1` spec (#562).
 *
 * Proves the round-trip the issue asks for, entirely offline and
 * deterministically: RAP source (receipt / attestation / portable reputation
 * credential) → ERC-8004 registry entry shapes → verified field-by-field back
 * against the source. No chain access, no RPC, no live calls anywhere; chain
 * refs in fixtures are placeholders marked unverified.
 *
 * Also fixes the exclusion rules as executable fixtures: probe-only
 * rail-neutral receipts, rail-neutral binding candidates that have not bridged
 * into `reddi.receipt.v1`, dry-run receipts without payment proof refs,
 * failure-final receipts (attestationStatus failed/rejected), non-final or
 * non-passed attestations, and malformed chain hints all fail closed and never
 * export.
 */
export declare const ERC8004_CONFORMANCE_SCHEMA_VERSION: "reddi.erc8004-export-conformance.v1";
export type Erc8004RoundTripCheck = {
    id: string;
    ok: boolean;
    detail: string;
};
export type Erc8004RoundTripResult = {
    schemaVersion: typeof ERC8004_CONFORMANCE_SCHEMA_VERSION;
    ok: boolean;
    checks: Erc8004RoundTripCheck[];
};
export type Erc8004RoundTripSource = {
    receipt: ReddiReceipt;
    attestation?: AttestationRecord;
    /** Portable reddi.reputation-credential.v1 supplied to the export, if any. */
    reputationCredential?: unknown;
};
/**
 * Verify an exported ERC-8004 bundle FIELD-BY-FIELD against the RAP source it
 * was projected from — the offline "round-trip" of #562. Deterministic and
 * pure: every check recomputes the expected value from the source and compares
 * it to the emitted bundle; any tampering with either side fails a check.
 *
 * A blocked bundle never round-trips (there is nothing to verify against the
 * source) — callers asserting exclusion lanes should check reason codes instead.
 */
export declare function verifyErc8004ExportAgainstSource(bundle: Erc8004ExportBundle, source: Erc8004RoundTripSource): Erc8004RoundTripResult;
export type Erc8004ConformanceFixture = {
    kind: 'export';
    case: string;
    description: string;
    receipt: ReddiReceipt;
    attestation?: AttestationRecord;
    options?: Erc8004ExportOptions;
    expected: {
        exportIntent: 'metadata_only' | 'exportable' | 'blocked';
        reasonCodes: Erc8004ExportReasonCode[];
        /** When true the fixture must pass the full source round-trip. */
        roundTrip: boolean;
    };
} | {
    kind: 'eligibility';
    case: string;
    description: string;
    source: Erc8004ExportSource;
    expected: {
        eligible: false;
        reasonCodes: Erc8004ExportReasonCode[];
    };
};
/**
 * The #562 conformance fixture set. Deterministic, self-describing, and
 * executable via `runErc8004ConformanceSuite()`. Chain refs are CAIP-2 fixture
 * placeholders; nothing here touches a chain, RPC, or live service.
 */
export declare function listErc8004ConformanceFixtures(): Erc8004ConformanceFixture[];
export type Erc8004ConformanceCaseResult = {
    case: string;
    kind: 'export' | 'eligibility';
    pass: boolean;
    failures: string[];
    roundTrip?: Erc8004RoundTripResult;
};
export type Erc8004ConformanceSuiteResult = {
    schemaVersion: typeof ERC8004_CONFORMANCE_SCHEMA_VERSION;
    ok: boolean;
    cases: Erc8004ConformanceCaseResult[];
};
/**
 * Execute every conformance fixture offline and verify its expectation:
 * export fixtures assert intent + exact reason codes (+ full source round-trip
 * where expected); eligibility fixtures assert the exclusion gate. Pure and
 * deterministic — safe to run anywhere, no chain or RPC access.
 */
export declare function runErc8004ConformanceSuite(): Erc8004ConformanceSuiteResult;
