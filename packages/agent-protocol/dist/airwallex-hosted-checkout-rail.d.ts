import { SELLER_WRAPPER_RAIL_FIXTURE_SCHEMA_VERSION, type SellerWrapperEndpointFixture, type SellerWrapperRailState } from './seller-wrapper-rail-fixtures.js';
/**
 * DRAFT v1 — Airwallex hosted-checkout rail fixture + #338 support-state matrix (#579).
 *
 * Airwallex is a regulated fiat acceptance/settlement rail OWNED BY THE SELLER.
 * This module models a seller-owned Airwallex Payment Link / hosted-payment-page
 * rail as seller-wrapper *metadata only* (`merchantOfRecord: 'seller'`,
 * `state: 'fixture'`). RAP never touches funds on this rail: the seller's own
 * Airwallex account executes; RAP is neither Merchant of Record nor processor,
 * claims no custody, no money transmission, and no settlement finality — the
 * same posture as the AUDD `proof-metadata-only` boundary.
 *
 * DRAFT DISCIPLINE (mirrors the AP2 precedent in `ap2-mandate-ingestion.ts`,
 * PR #571 under epic #338): every Airwallex structural detail below (surface
 * names, checkout modes, webhook event names, field shapes) is read from public
 * Airwallex docs only and is UNVERIFIED against a live API — tagged inline as
 * `(unverified — Airwallex docs)`. Fixtures are ILLUSTRATIVE, not authoritative.
 *
 * HARD BOUNDARY (issue #541 / #579): no Airwallex account, signup, sandbox or
 * demo credential, API call, webhook registration, live HMAC verification,
 * partnership contact, spend, or live payment. Fixtures only. Webhook HMAC
 * signatures are fixture-asserted; a real merchant secret must never be held.
 *
 * RECEIPT-SEMANTICS CAVEAT (documented, not solved here): card-rail receipts
 * are REVOCABLE — a succeeded payment intent can later be refunded or disputed.
 * Receipt v1 has no representation for a later-revoked/contested receipt, so
 * Airwallex webhook-derived receipts cap at `probe_only`; the gap is tracked as
 * a #338 receipt-semantics gap (webhook normalization itself is a follow-up
 * issue, not implemented in this module).
 */
export declare const AIRWALLEX_HOSTED_CHECKOUT_RAIL_SCHEMA_VERSION: "reddi.airwallex-hosted-checkout-rail.v1";
/** Top-level draft flag: this schema signals draft/unverified external-rail shapes. */
export declare const AIRWALLEX_HOSTED_CHECKOUT_RAIL_DRAFT: true;
/**
 * Draft namespace for fiat-currency rail metadata. `BuyerAuthorityAsset` v1 is a
 * frozen closed union (SOL | USDC | AUDD); fiat currency support deliberately
 * stays in this draft namespace until #338 decides on extending the asset union.
 */
export declare const AIRWALLEX_FIAT_RAIL_DRAFT_NAMESPACE: "reddi.fiat-rail-fixture";
/**
 * Airwallex support-state additions to the #338 rail-neutral support-state
 * vocabulary (RAP-internal names for illustrative Airwallex handling, mirroring
 * the AP2 three-state pattern).
 */
export type AirwallexSupportState = 'airwallex_hosted_checkout_fixture' | 'airwallex_webhook_receipt_probe_only' | 'unsupported_live_airwallex_settlement';
/**
 * Hosted-checkout entry mode.
 * (unverified — Airwallex docs) 'payment-link' = Payment Links (API/no-code,
 * Airwallex-branded checkout URL per charge); 'hosted-payment-page' = full
 * hosted checkout / guest checkout. PCI scope stays with Airwallex either way.
 */
export type AirwallexCheckoutMode = 'payment-link' | 'hosted-payment-page';
/**
 * Seller-owned Airwallex hosted-checkout rail metadata for seller-wrapper configs.
 *
 * Metadata ONLY: this shape must never carry provider credentials (API keys,
 * client IDs, bearer tokens), live payment-link URLs, KYB artifacts, shopper PII
 * (emails, PAN-shaped strings), custody claims, or settlement-finality fields —
 * `validateAirwallexHostedCheckoutRailFixture` fails closed on all of these.
 */
export type AirwallexHostedCheckoutRailConfig = {
    id: string;
    railKind: 'airwallex-hosted-checkout';
    /** Fiat asset stays in the draft namespace — NOT part of the frozen BuyerAuthorityAsset v1 union. */
    fiatAssetNamespace: typeof AIRWALLEX_FIAT_RAIL_DRAFT_NAMESPACE;
    /** (unverified — Airwallex docs, confirm supported currency codes) ISO-4217-style fiat currency code. */
    currency: string;
    /** (unverified — Airwallex docs, confirm amount unit shape) amount in minor units, string-encoded. */
    amountMinorUnits: string;
    /** (unverified — Airwallex docs, confirm surface names) hosted-checkout entry mode. */
    checkoutMode: AirwallexCheckoutMode;
    /** The seller is Merchant of Record in the direct model; RAP is neither MoR nor processor. */
    merchantOfRecord: 'seller';
    /** Opaque, NON-SECRET template reference. Never a live payment-link URL and never credential material. */
    paymentLinkTemplateRef: string;
    /**
     * (unverified — Airwallex docs, confirm event name `payment_intent.succeeded`)
     * The seller's rail is expected to emit a webhook receipt on completion; RAP
     * only ever consumes SYNTHETIC webhook fixtures, capped at probe_only.
     */
    webhookReceiptExpected: true;
    /** Reuses the seller-wrapper rail-state vocabulary, pinned to 'fixture'. */
    state: Extract<SellerWrapperRailState, 'fixture'>;
    supportState: 'airwallex_hosted_checkout_fixture';
    evidenceRequired: boolean;
    approvalRequired: boolean;
    livePaymentApproved: false;
    custodySupported: false;
    notes: string[];
};
/**
 * Seller-wrapper endpoint carrying draft fiat-rail metadata. Mirrors
 * `SellerWrapperEndpointFixture`, but keeps the Airwallex rail in a separate
 * `fiatRailsDraft` list so the frozen v1 `SellerWrapperRailConfig` asset union
 * (SOL | USDC | AUDD) is untouched.
 */
export type AirwallexSellerWrapperEndpointFixture = {
    kind: SellerWrapperEndpointFixture['kind'];
    endpointId: string;
    displayName: string;
    transport: SellerWrapperEndpointFixture['transport'];
    fiatRailsDraft: AirwallexHostedCheckoutRailConfig[];
};
/**
 * All-false live flags: nothing in this module creates an Airwallex relationship,
 * calls an Airwallex API, registers a webhook, verifies an HMAC against a real
 * merchant secret, executes a payment, or claims custody/MoR/settlement finality.
 */
export type AirwallexRailFixtureGuardrails = {
    fixtureOnly: true;
    airwallexAccountCreated: false;
    liveAirwallexApiCall: false;
    livePaymentExecuted: false;
    webhookEndpointRegistered: false;
    hmacVerifiedLive: false;
    merchantSecretHeld: false;
    kybArtifactsCollected: false;
    shopperPiiStored: false;
    custodyClaim: false;
    moneyTransmissionClaim: false;
    merchantOfRecordClaim: false;
    settlementFinalityClaim: false;
};
export type AirwallexHostedCheckoutRailFixture = {
    schemaVersion: typeof AIRWALLEX_HOSTED_CHECKOUT_RAIL_SCHEMA_VERSION;
    issue: 579;
    draft: true;
    sourceContract: {
        assessmentIssue: 541;
        railNeutralityEpic: 338;
        sellerWrapperFeature: 375;
        ap2PrecedentPullRequest: 571;
        sellerWrapperRailFixtureSchemaVersion: typeof SELLER_WRAPPER_RAIL_FIXTURE_SCHEMA_VERSION;
    };
    endpoints: AirwallexSellerWrapperEndpointFixture[];
    guardrails: AirwallexRailFixtureGuardrails;
};
export declare const AIRWALLEX_RAIL_FIXTURE_GUARDRAILS: AirwallexRailFixtureGuardrails;
export type AirwallexRailSupportStateRow = {
    rail: 'airwallex-hosted-checkout';
    standard: 'Airwallex hosted checkout (Payment Links / hosted payment page)';
    supportState: AirwallexSupportState;
    /** (unverified — Airwallex docs) Airwallex surfaces each state covers. */
    surfaces: string[];
    description: string;
    /** Every Airwallex field/surface in this row is DRAFT/unverified (low confidence). */
    draft: true;
    confidence: 'low';
    /** Regulatory-posture note — DRAFT/unverified (Airwallex public docs/press only). */
    governanceNote: string;
    claimBoundary: string[];
};
export declare const AIRWALLEX_RAIL_SUPPORT_STATE_MATRIX: AirwallexRailSupportStateRow[];
export declare const airwallexHostedCheckoutRailFixture: AirwallexHostedCheckoutRailFixture;
export declare function getAirwallexHostedCheckoutRail(fixture?: AirwallexHostedCheckoutRailFixture): AirwallexHostedCheckoutRailConfig | undefined;
export type AirwallexRailFixtureValidationReasonCode = 'airwallex_rail_fixture_valid' | 'rail_fixture_malformed' | 'credential_material_rejected' | 'live_payment_link_rejected' | 'pan_shaped_string_rejected' | 'email_shaped_string_rejected' | 'custody_claim_rejected' | 'settlement_finality_claim_rejected' | 'merchant_of_record_not_seller' | 'non_fixture_state_rejected' | 'live_payment_approval_rejected' | 'guardrails_invalid';
export type AirwallexRailFixtureValidationResult = {
    valid: boolean;
    /** Fail-closed: anything invalid lands in the unsupported live-settlement state. */
    supportState: AirwallexSupportState;
    reasonCodes: AirwallexRailFixtureValidationReasonCode[];
    auditNotes: string[];
};
/**
 * Fail-closed validation of an Airwallex hosted-checkout rail fixture.
 *
 * Pure function: no network, no wallet, no RPC, no Airwallex call. Rejects
 * credential material (API keys/client IDs/bearer tokens/webhook secrets), live
 * payment-link URLs, PAN- and email-shaped strings (shopper PII), custody and
 * settlement-finality claims, non-seller MoR, non-fixture states, and any live
 * payment approval. Invalid fixtures land in `unsupported_live_airwallex_settlement`.
 */
export declare function validateAirwallexHostedCheckoutRailFixture(value: unknown): AirwallexRailFixtureValidationResult;
export declare const airwallexRailRejectionFixtures: {
    readonly apiKeyLeak: AirwallexHostedCheckoutRailFixture;
    readonly clientIdLeak: AirwallexHostedCheckoutRailFixture;
    readonly bearerTokenLeak: AirwallexHostedCheckoutRailFixture;
    readonly livePaymentLinkUrl: AirwallexHostedCheckoutRailFixture;
    readonly urlTemplateRef: AirwallexHostedCheckoutRailFixture;
    readonly panShapedString: AirwallexHostedCheckoutRailFixture;
    readonly emailShapedString: AirwallexHostedCheckoutRailFixture;
    readonly custodyClaim: AirwallexHostedCheckoutRailFixture;
    readonly settlementFinalityField: AirwallexHostedCheckoutRailFixture;
    readonly settlementFinalityText: AirwallexHostedCheckoutRailFixture;
    readonly platformMerchantOfRecord: AirwallexHostedCheckoutRailFixture;
    readonly liveStateRail: AirwallexHostedCheckoutRailFixture;
    readonly guardrailsLiveFlag: AirwallexHostedCheckoutRailFixture;
};
export declare function listAirwallexRailRejectionFixtures(): Array<{
    key: keyof typeof airwallexRailRejectionFixtures;
    fixture: AirwallexHostedCheckoutRailFixture;
    expectedReasonCode: AirwallexRailFixtureValidationReasonCode;
}>;
