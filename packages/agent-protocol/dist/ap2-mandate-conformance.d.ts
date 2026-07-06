import { ap2MandateFixtures, type Ap2BindingReasonCode, type Ap2CompositionReasonCode, type Ap2IngestReasonCode, type Ap2MandateFixture, type Ap2MandateIngestionResult, type Ap2MandateRef, type Ap2SupportState } from './ap2-mandate-ingestion.js';
import { type BuyerAuthorityPolicy } from './buyer-authority-policy.js';
/**
 * `reddi.ap2-mandate-conformance.v1` — NO-LIVE conformance surface for the
 * `reddi.ap2-mandate-ingestion.v1` adapter (#563, mirrors the ERC-8004
 * conformance convention from #562).
 *
 * Proves the AP2 round-trip entirely offline and deterministically: static
 * signed-mandate fixture → ingestion result → verified field-by-field back
 * against the mandate source (including hash recomputation, which makes
 * tampering on either side fail a named check) → policy-gate composition where
 * the LOCAL policy always wins → receipt binding that carries only a
 * non-secret mandate reference.
 *
 * No network, no wallet, no RPC, no live VDC verification, no key handling
 * anywhere. AP2 field shapes remain unverified external-draft references
 * (see `AP2_EXTERNAL_STANDARD`); signature verification is FIXTURE-ASSERTED
 * only and no settlement-finality claim exists in any fixture or check.
 */
export declare const AP2_MANDATE_CONFORMANCE_SCHEMA_VERSION: "reddi.ap2-mandate-conformance.v1";
export type Ap2RoundTripCheck = {
    id: string;
    ok: boolean;
    detail: string;
};
export type Ap2RoundTripResult = {
    schemaVersion: typeof AP2_MANDATE_CONFORMANCE_SCHEMA_VERSION;
    ok: boolean;
    checks: Ap2RoundTripCheck[];
};
/**
 * Verify an AP2 ingestion result FIELD-BY-FIELD against the mandate it was
 * ingested from — the offline "round-trip" of #563. Deterministic and pure:
 * every check recomputes the expected value from the mandate source and
 * compares it to the emitted result. Tampering with either side (e.g. a cart
 * total edited after ingestion) fails the `mandate_hash_recomputes` check.
 *
 * A non-authorizing result (probe-only / rejected) never round-trips — callers
 * asserting fail-closed lanes should check reason codes instead.
 */
export declare function verifyAp2IngestionAgainstMandate(result: Ap2MandateIngestionResult, mandate: Ap2MandateFixture): Ap2RoundTripResult;
export declare function ap2LocalBuyerAuthorityPolicyFixture(overrides?: Partial<BuyerAuthorityPolicy>): BuyerAuthorityPolicy;
export type Ap2ConformanceFixture = {
    kind: 'ingestion';
    case: string;
    description: string;
    mandateKey: keyof typeof ap2MandateFixtures;
    expected: {
        supportState: Ap2SupportState;
        reasonCodes: Ap2IngestReasonCode[];
        /** When true the fixture must pass the full source round-trip. */
        roundTrip: boolean;
    };
} | {
    kind: 'tamper';
    case: string;
    description: string;
    mandateKey: keyof typeof ap2MandateFixtures;
    /** Applied to a CLONE of the mandate after ingestion — the round-trip must then fail. */
    tamper: (mandate: Ap2MandateFixture) => void;
    expected: {
        failedCheckId: string;
    };
} | {
    kind: 'composition';
    case: string;
    description: string;
    mandateKey: keyof typeof ap2MandateFixtures;
    localPolicy: () => BuyerAuthorityPolicy;
    expected: {
        ok: boolean;
        reasonCodes: Ap2CompositionReasonCode[];
        /** Composed per-request cap on the AP2 lane, proven equal to min(local, mandate). */
        composedCapUnits?: string;
    };
} | {
    kind: 'binding';
    case: string;
    description: string;
    ref: () => Ap2MandateRef;
    expected: {
        ok: boolean;
        reasonCodes: Ap2BindingReasonCode[];
    };
};
/**
 * The #563 conformance fixture set. Deterministic, self-describing, and
 * executable via `runAp2MandateConformanceSuite()`. Nothing here touches a
 * network, wallet, key, or live service.
 */
export declare function listAp2ConformanceFixtures(): Ap2ConformanceFixture[];
export type Ap2ConformanceCaseResult = {
    case: string;
    kind: 'ingestion' | 'tamper' | 'composition' | 'binding';
    pass: boolean;
    failures: string[];
    roundTrip?: Ap2RoundTripResult;
};
export type Ap2ConformanceSuiteResult = {
    schemaVersion: typeof AP2_MANDATE_CONFORMANCE_SCHEMA_VERSION;
    ok: boolean;
    cases: Ap2ConformanceCaseResult[];
};
/**
 * Execute every conformance fixture offline and verify its expectation:
 * ingestion fixtures assert support state + exact reason codes (+ full source
 * round-trip where expected); the tamper fixture asserts hash-mismatch
 * detection; composition fixtures prove the local policy always wins or
 * blocks (including via the real `evaluateBuyerAuthorityPolicy` gate); binding
 * fixtures assert the fail-closed receipt-reference contract. Pure and
 * deterministic — safe to run anywhere, no live access of any kind.
 */
export declare function runAp2MandateConformanceSuite(): Ap2ConformanceSuiteResult;
