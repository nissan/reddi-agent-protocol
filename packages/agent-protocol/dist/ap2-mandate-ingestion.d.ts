import type { BuyerAuthorityAsset, BuyerAuthoritySpendCap } from './buyer-authority-policy.js';
import type { ReddiReceipt } from './receipts.js';
/**
 * DRAFT v1 adapter — Google AP2 (Agent Payments Protocol) mandate ingestion.
 *
 * AP2 is a trust/authorization layer, NOT a settlement rail. This module maps a
 * STATIC signed-mandate fixture onto Reddi buyer-authority-policy constraints and
 * emits a receipt-bindable `mandateRef`, with ZERO settlement-finality claim.
 *
 * DRAFT DISCIPLINE: every AP2 / FIDO / Visa / Mastercard structural detail below
 * (mandate vocabulary, VDC envelope, field names) is UNVERIFIED against the live
 * standard and is derived from low/medium-confidence research. Each external-standard
 * field is tagged inline. Fixtures are ILLUSTRATIVE, not authoritative. The VDC
 * signature is treated as an OPAQUE, fixture-asserted blob and is NEVER verified
 * against a live key.
 */
export declare const AP2_MANDATE_INGESTION_SCHEMA_VERSION: "reddi.ap2-mandate-ingestion.v1";
/** Top-level draft flag: this schema signals draft/unverified external-standard shapes. */
export declare const AP2_MANDATE_INGESTION_DRAFT: true;
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
 * this adapter never verifies it against a live key.
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
    /** (DRAFT/unverified — AP2) merchant/seller reference; maps to a seller allowlist addition. */
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
 * never the VDC signature, cart contents, or any credential material.
 */
export type Ap2MandateRef = {
    schemaVersion: typeof AP2_MANDATE_INGESTION_SCHEMA_VERSION;
    draft: true;
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
 * Does NOT itself authorize spend — it only tightens the existing buyer gate.
 */
export type Ap2DerivedPolicyConstraints = {
    allowedCurrencies: BuyerAuthorityAsset[];
    spendCaps: BuyerAuthoritySpendCap[];
    sellerAllowlistAdditions: {
        sellerIds: string[];
        endpointIds: string[];
    };
    expiresAt?: string;
    operatorApprovalRequired: boolean;
};
export type Ap2IngestReasonCode = 'ap2_mandate_ingested' | 'mandate_malformed' | 'mandate_contains_credentials' | 'settlement_finality_claim_rejected' | 'custody_claim_rejected' | 'unsupported_currency_rail' | 'probe_only_no_cart_binding' | 'mandate_expired' | 'mandate_over_cap';
export type Ap2MandateIngestionGuardrails = {
    fixtureOnly: true;
    vdcSignatureVerifiedLive: false;
    livePaymentExecuted: false;
    walletSigning: false;
    rpcCall: false;
    custodyClaim: false;
    settlementFinalityClaim: false;
};
export type Ap2MandateIngestionResult = {
    schemaVersion: typeof AP2_MANDATE_INGESTION_SCHEMA_VERSION;
    draft: true;
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
    draft: true;
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
 * Ingest a static AP2 mandate fixture into buyer-authority constraints.
 *
 * Pure function: no network, no wallet, no RPC, no live VDC verification. The VDC
 * signature is treated as opaque. Fails closed on credentials/PAN, settlement/custody
 * claims, expiry, over-cap, and unsupported rails.
 */
export declare function ingestAp2Mandate(mandate: Ap2MandateFixture, now: string): Ap2MandateIngestionResult;
/**
 * Bind a mandate reference onto a receipt WITHOUT any settlement claim.
 * Sets `receipt.metadata.ap2MandateRef` to hash + type + support-state only.
 */
export declare function bindMandateToReceipt(receipt: ReddiReceipt, ref: Ap2MandateRef): ReddiReceipt;
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
};
export declare function listAp2MandateFixtures(): Array<{
    key: string;
    mandate: Ap2MandateFixture;
}>;
