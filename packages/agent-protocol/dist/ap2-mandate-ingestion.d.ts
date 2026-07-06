import { type BuyerAuthorityAsset, type BuyerAuthorityPolicy, type BuyerAuthoritySpendCap } from './buyer-authority-policy.js';
import { type ReddiReceipt } from './receipts.js';
/**
 * `reddi.ap2-mandate-ingestion.v1` — Google AP2 (Agent Payments Protocol)
 * mandate ingestion into the RAP buyer-authority policy gate (#563, promoted
 * from the PR #571 DRAFT).
 *
 * AP2 is a trust/authorization layer, NOT a settlement rail. This module maps a
 * STATIC signed-mandate fixture onto Reddi buyer-authority-policy constraints,
 * composes those constraints with a LOCAL buyer-authority policy (the mandate
 * can only narrow local authority, never widen it), and emits a receipt-bindable
 * `mandateRef` — with ZERO settlement-finality claim by construction.
 *
 * SPEC STATUS (promoted by #563, was DRAFT in PR #571): the RAP-side adapter
 * contract — ingestion rules, fail-closed lanes, reason codes, policy-gate
 * composition semantics, and the receipt-binding contract — is spec'd and
 * frozen for v1. See `docs/AP2-MANDATE-INGESTION-SPEC-2026-07-06.md` and the
 * machine-readable `AP2_MANDATE_FIELD_PROVENANCE` / `AP2_UNSUPPORTED_FIELDS`
 * tables. Conformance surface: `ap2-mandate-conformance.ts`.
 *
 * EXTERNAL-STANDARD PROVENANCE: AP2 itself (and its FIDO / Visa TAP /
 * Mastercard Verifiable Intent context) is an external draft standard whose
 * field shapes are UNVERIFIED against any live implementation. Every AP2-side
 * structural detail below (mandate vocabulary, VDC envelope, field names,
 * governance lineage) keeps its inline `(DRAFT/unverified — <standard>)` tag,
 * and every ingestion result carries the `AP2_EXTERNAL_STANDARD` honesty block.
 * Promoting the RAP-side contract does NOT upgrade confidence in the external
 * draft.
 *
 * HARD BOUNDARY — SIGNATURES AND KEYS: the VDC signature is an OPAQUE,
 * FIXTURE-ASSERTED blob. There is NO cryptographic verification of any
 * Visa / Mastercard / FIDO material anywhere in this module, and NO key
 * handling: signature- or key-shaped material outside the single opaque
 * `vdc.signatureB64` slot fails closed (`signature_material_rejected`).
 * No network, no wallet, no RPC, no live call — pure functions over fixtures.
 */
export declare const AP2_MANDATE_INGESTION_SCHEMA_VERSION: "reddi.ap2-mandate-ingestion.v1";
/**
 * Promoted by #563: the RAP-side adapter contract is no longer a draft.
 * External AP2 field-shape uncertainty is tracked separately and honestly via
 * `AP2_EXTERNAL_STANDARD.fieldShapesVerified: false` on every result —
 * promotion of the RAP contract does NOT fake confidence in the external draft.
 */
export declare const AP2_MANDATE_INGESTION_DRAFT: false;
/**
 * External-standard provenance block carried on every ingestion/composition
 * result. AP2 field shapes are unverified; the signature model is
 * fixture-asserted only; AP2 is not a settlement rail and RAP claims none.
 */
export declare const AP2_EXTERNAL_STANDARD: {
    readonly name: "Google AP2 (Agent Payments Protocol)";
    readonly status: "external-draft-standard";
    readonly fieldShapesVerified: false;
    readonly signatureVerification: "fixture-asserted";
    /** (DRAFT/unverified — FIDO/Visa/Mastercard) governance lineage unconfirmed. */
    readonly governanceLineageVerified: false;
    readonly settlementRail: false;
};
export type Ap2ExternalStandard = typeof AP2_EXTERNAL_STANDARD;
/**
 * AP2 mandate vocabulary.
 * (DRAFT/unverified — AP2, confirm mandate-type names/shape.)
 * - `intent | cart | payment` are the Sept-2025 launch vocabulary.
 * - `checkout_open | checkout_closed | payment_open | payment_closed` are the v0.2
 *   Open/Closed staging read from ap2-protocol.org (medium confidence on the rename).
 */
export type Ap2MandateType = 'intent' | 'cart' | 'payment' | 'checkout_open' | 'checkout_closed' | 'payment_open' | 'payment_closed';
/**
 * AP2 Verifiable Digital Credential (VDC) envelope.
 * (DRAFT/unverified — AP2 VDC, confirm envelope: JWT vs SD-JWT vs LD-Proof is NOT
 * confirmed against the live spec.) The signature is OPAQUE and fixture-asserted:
 * this adapter never verifies it against a live key and never holds key material.
 */
export type Ap2VerifiableDigitalCredential = {
    /** (DRAFT/unverified — AP2 VDC) illustrative algorithm label; never used to verify. */
    alg?: string;
    /** (DRAFT/unverified — AP2 VDC) base64 signature blob; OPAQUE, fixture-asserted, NOT verified live. */
    signatureB64: string;
    /** Fixed marker: the VDC signature is fixture-asserted and is not verified against any live key. */
    verification: 'fixture-asserted';
};
/**
 * A static, signed AP2 mandate fixture.
 * (DRAFT/unverified — AP2, confirm every field name/shape.) Illustrative only.
 */
export type Ap2MandateFixture = {
    /** (DRAFT/unverified — AP2) mandate stage discriminator. */
    mandateType: Ap2MandateType;
    /** (DRAFT/unverified — AP2) human-present vs delegated/not-present authorization semantics. */
    humanPresent?: boolean;
    /** (DRAFT/unverified — AP2) merchant/seller reference; maps to namespaced seller refs. */
    merchant?: {
        id: string;
        name?: string;
    };
    /** (DRAFT/unverified — AP2) finalized cart (present only for cart/closed mandates). */
    cart?: {
        items: Array<{
            sku?: string;
            name?: string;
            amount: string;
        }>;
        total: {
            amount: string;
            currency: string;
        };
        /** (DRAFT/unverified — AP2) opaque cart-binding hash carried through only as a reference. */
        cartHash?: string;
    };
    /** (DRAFT/unverified — AP2) payment constraints; instruments are categories, NEVER a PAN. */
    payment?: {
        amount: string;
        currency: string;
        /** (DRAFT/unverified — AP2) e.g. ["stablecoin","card"] — category labels only, never card numbers. */
        allowedInstruments?: string[];
        budgetCap?: string;
    };
    /** (DRAFT/unverified — AP2) mandate expiry. */
    expiresAt?: string;
    /** (DRAFT/unverified — AP2) VDC envelope; opaque + fixture-asserted. */
    vdc: Ap2VerifiableDigitalCredential;
};
/**
 * AP2 support-state additions to the #338 rail-neutral support-state vocabulary.
 * (DRAFT/unverified — AP2 support states are Reddi-internal names for illustrative AP2 handling.)
 */
export type Ap2SupportState = 'ap2_mandate_fixture' | 'ap2_mandate_probe_only' | 'unsupported_live_ap2_settlement';
/**
 * Receipt-bindable AP2 mandate reference. Carries hash + type + support-state only —
 * never the VDC signature, cart contents, mandate terms, or any credential material.
 */
export type Ap2MandateRef = {
    schemaVersion: typeof AP2_MANDATE_INGESTION_SCHEMA_VERSION;
    /** Promoted by #563 — the RAP-side ref contract is v1. External uncertainty lives in AP2_EXTERNAL_STANDARD. */
    draft: false;
    mandateType: Ap2MandateType;
    /** sha256 over the canonicalized mandate with the VDC signature removed. */
    mandateHash: string;
    supportState: Ap2SupportState;
    humanPresent?: boolean;
    /** The VDC signature was treated as opaque and was NOT verified against a live key. */
    vdcVerification: 'fixture-asserted';
    /** This adapter never asserts settlement finality. */
    settlementFinalityClaimed: false;
};
/**
 * Buyer-authority-policy constraints derived from a mandate.
 * Does NOT itself authorize spend — constraints only become effective through
 * `composeAp2MandateWithLocalPolicy`, where the LOCAL policy is the ceiling.
 */
export type Ap2DerivedPolicyConstraints = {
    allowedCurrencies: BuyerAuthorityAsset[];
    spendCaps: BuyerAuthoritySpendCap[];
    /**
     * Namespaced seller refs derived from the mandate merchant. Despite the
     * historical name these are NEVER added to a local allowlist — composition
     * INTERSECTS them with the local allowlist and blocks when the merchant is
     * not already allowlisted locally (a mandate must never widen local authority).
     */
    sellerAllowlistAdditions: {
        sellerIds: string[];
        endpointIds: string[];
    };
    expiresAt?: string;
    operatorApprovalRequired: boolean;
};
export type Ap2IngestReasonCode = 'ap2_mandate_ingested' | 'mandate_malformed' | 'unsupported_mandate_type' | 'mandate_contains_credentials' | 'signature_material_rejected' | 'settlement_finality_claim_rejected' | 'custody_claim_rejected' | 'unsupported_currency_rail' | 'probe_only_no_cart_binding' | 'mandate_expired' | 'mandate_over_cap';
export type Ap2MandateIngestionGuardrails = {
    fixtureOnly: true;
    vdcSignatureVerifiedLive: false;
    keyMaterialHeld: false;
    livePaymentExecuted: false;
    walletSigning: false;
    rpcCall: false;
    custodyClaim: false;
    settlementFinalityClaim: false;
};
export type Ap2MandateIngestionResult = {
    schemaVersion: typeof AP2_MANDATE_INGESTION_SCHEMA_VERSION;
    /** Promoted by #563 — RAP-side contract is v1; external uncertainty is in `externalStandard`. */
    draft: false;
    /** External-standard honesty: AP2 shapes unverified, signatures fixture-asserted, no settlement rail. */
    externalStandard: Ap2ExternalStandard;
    supportState: Ap2SupportState;
    mandateRef: Ap2MandateRef;
    derived: Ap2DerivedPolicyConstraints | null;
    reasonCodes: Ap2IngestReasonCode[];
    auditNotes: string[];
    guardrails: Ap2MandateIngestionGuardrails;
};
/**
 * AP2 metadata written onto a receipt by `bindMandateToReceipt`. Authorization-provenance
 * only — hash + type + support-state, with an explicit no-settlement flag.
 */
export type Ap2ReceiptMandateBinding = {
    draft: false;
    mandateType: Ap2MandateType;
    mandateHash: string;
    supportState: Ap2SupportState;
    humanPresent?: boolean;
    vdcVerification: 'fixture-asserted';
    settlementFinalityClaimed: false;
};
export declare const AP2_MANDATE_INGESTION_GUARDRAILS: Ap2MandateIngestionGuardrails;
/** Illustrative default `now` for fixtures (fixture-only, no wall-clock dependency). */
export declare const AP2_MANDATE_INGESTION_FIXTURE_NOW: "2026-07-05T00:00:00.000Z";
/**
 * Machine-readable per-field provenance for the AP2 → buyer-authority mapping
 * (#563, mirrors the ERC-8004 export convention). `rap-native` fields are
 * adapter-defined; `ap2-draft-interface` marks the AP2-side field NAME as an
 * unverified reference to the external draft standard. `lossy` documents any
 * information loss or conservative narrowing in the projection.
 */
export declare const AP2_MANDATE_FIELD_PROVENANCE: ReadonlyArray<{
    target: string;
    source: string;
    confidence: 'rap-native' | 'ap2-draft-interface';
    lossy?: string;
}>;
/**
 * AP2 surface RAP cannot (or deliberately will not) handle — documented
 * fail-closed (#563). `behavior` is what this adapter does about each gap.
 */
export declare const AP2_UNSUPPORTED_FIELDS: ReadonlyArray<{
    surface: string;
    behavior: 'blocked' | 'omitted' | 'excluded';
    reason: string;
}>;
/** RAP-internal lane label for AP2-derived constraints. AP2 is not a settlement network. */
export declare const AP2_AUTHORIZATION_NETWORK: "ap2-authorization-fixture";
/**
 * Ingest a static AP2 mandate fixture into buyer-authority constraints.
 *
 * Pure function: no network, no wallet, no RPC, no live VDC verification, no key
 * handling. The VDC signature is treated as opaque. Fails closed on credentials/PAN,
 * stray signature material, settlement/custody claims, unsupported mandate types,
 * expiry, over-cap, and unsupported rails.
 */
export declare function ingestAp2Mandate(mandate: Ap2MandateFixture, now: string): Ap2MandateIngestionResult;
export type Ap2CompositionReasonCode = 'ap2_composition_ok' | 'local_policy_invalid' | 'mandate_not_authorizing' | 'mandate_currency_not_permitted_locally' | 'mandate_merchant_not_allowlisted_locally' | 'local_cap_missing_for_mandate_currency' | 'mandate_cap_wider_than_local_cap' | 'mandate_expiry_later_than_local' | 'operator_approval_escalated' | 'composed_policy_invalid';
export type Ap2PolicyComposition = {
    schemaVersion: typeof AP2_MANDATE_INGESTION_SCHEMA_VERSION;
    draft: false;
    externalStandard: Ap2ExternalStandard;
    ok: boolean;
    /** The composed (mandate-narrowed) local policy, or null when composition is blocked. */
    composedPolicy: BuyerAuthorityPolicy | null;
    /** The mandate ref the composed policy was narrowed by (bindable to receipts). */
    mandateRef: Ap2MandateRef | null;
    reasonCodes: Ap2CompositionReasonCode[];
    auditNotes: string[];
    guardrails: Ap2MandateIngestionGuardrails;
};
/**
 * Compose an ingested AP2 mandate with a LOCAL `reddi.buyer-authority-policy.v1`.
 *
 * FAIL-CLOSED INVARIANT (#563): the local policy always wins or the composition
 * blocks — a mandate must never widen local authority.
 *
 * - currency: the mandate currency must already be in the local policy
 *   (else blocked); the composed policy narrows to that currency.
 * - merchant: the mandate merchant refs must already be in the local seller
 *   allowlist (else blocked); the composed allowlist narrows to the mandate
 *   merchant (intersection).
 * - spend cap: the local policy must carry a per-request cap for the mandate
 *   currency on the `ap2-authorization-fixture` lane (absence of a local cap
 *   never becomes unlimited authority — blocked). The composed cap is the MIN
 *   of local and mandate caps; a wider mandate cap is recorded and ignored.
 *   Amounts are compared only inside this lane's shared fixture unit space —
 *   cross-unit conversion is never attempted (see AP2_UNSUPPORTED_FIELDS).
 * - expiry: earlier of local and mandate expiry.
 * - operator approval: escalates when the mandate was human-not-present or the
 *   local policy requires it; never de-escalates.
 * - everything else (mode, receipt/evidence requirements, refund/failure
 *   policy, support-state constraints) is carried verbatim from the local
 *   policy — a mandate cannot touch them.
 */
export declare function composeAp2MandateWithLocalPolicy(localPolicy: unknown, ingestion: Ap2MandateIngestionResult): Ap2PolicyComposition;
export type Ap2BindingReasonCode = 'ap2_mandate_ref_bound' | 'mandate_ref_malformed' | 'probe_only_ref_not_bindable' | 'rejected_mandate_ref_not_bindable' | 'signature_material_rejected' | 'receipt_invalid_after_binding';
export type Ap2ReceiptBindingResult = {
    ok: boolean;
    /** The receipt with `metadata.ap2MandateRef` set, or null when binding fails closed. */
    receipt: ReddiReceipt | null;
    reasonCodes: Ap2BindingReasonCode[];
    auditNotes: string[];
};
/**
 * Bind a mandate reference onto a receipt WITHOUT any settlement claim.
 *
 * FAIL-CLOSED (#563): only an authorizing `ap2_mandate_fixture` ref binds.
 * Probe-only refs never bind (a probe-only mandate authorized nothing, so
 * binding it would misrepresent authorization provenance); rejected refs never
 * bind; refs carrying unexpected keys or signature-shaped material never bind;
 * and the bound receipt must still pass `validateReddiReceipt`.
 *
 * The binding carries hash + type + support-state only — never mandate
 * contents, cart items, or signature material.
 */
export declare function bindMandateToReceipt(receipt: ReddiReceipt, ref: Ap2MandateRef): Ap2ReceiptBindingResult;
/**
 * Deterministic sha256 over the canonicalized mandate with the opaque VDC
 * signature removed. Exported so the conformance surface can recompute it and
 * detect tampering on either side. One-way: the ref never reveals contents.
 */
export declare function hashAp2Mandate(mandate: unknown): string;
/**
 * Lossless normalization of a decimal AP2 fixture amount (≤2 decimals) into an
 * integer centi-unit string ('50.00' -> '5000'), so caps derived from a mandate
 * can be enforced by the BigInt-based buyer-authority gate. Returns null (fail
 * closed upstream) for anything with more precision — no silent rounding.
 * WITHIN-LANE only: this is never a cross-rail unit conversion.
 */
export declare function ap2FixtureCentiUnits(value: string): string | null;
export type Ap2RailSupportStateRow = {
    rail: 'google-ap2';
    standard: 'Google AP2 (Agent Payments Protocol)';
    supportState: Ap2SupportState;
    mandateTypes: Ap2MandateType[];
    description: string;
    /** Every AP2/FIDO/Visa/Mastercard field in this row is DRAFT/unverified (low confidence). */
    draft: true;
    confidence: 'low';
    /** Governance lineage note — DRAFT/unverified (FIDO/Visa/Mastercard). */
    governanceNote: string;
    claimBoundary: string[];
};
export declare const AP2_RAIL_SUPPORT_STATE_MATRIX: Ap2RailSupportStateRow[];
export declare const ap2MandateFixtures: {
    readonly checkoutClosedPaymentClosedValid: Ap2MandateFixture;
    readonly paymentOpenProbeOnly: Ap2MandateFixture;
    readonly expiredMandate: Ap2MandateFixture;
    readonly humanNotPresent: Ap2MandateFixture;
    readonly overBudgetMandate: Ap2MandateFixture;
    readonly railMismatchMandate: Ap2MandateFixture;
    readonly panLeakMandate: Ap2MandateFixture;
    readonly settlementClaimMandate: Ap2MandateFixture;
    readonly unsupportedTypeMandate: Ap2MandateFixture;
    readonly signatureMaterialMandate: Ap2MandateFixture;
};
export declare function listAp2MandateFixtures(): Array<{
    key: string;
    mandate: Ap2MandateFixture;
}>;
