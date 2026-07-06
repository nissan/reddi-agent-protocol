import { AIRWALLEX_FIAT_RAIL_DRAFT_NAMESPACE, type AirwallexRailFixtureGuardrails, type AirwallexSupportState } from './airwallex-hosted-checkout-rail.js';
/**
 * DRAFT v1 — static Airwallex webhook fixture → rail-neutral receipt
 * normalization, capped at probe_only (#580, follow-up 2 of 3 from the #541
 * assessment; consumes the #579 rail vocabulary in
 * `airwallex-hosted-checkout-rail.ts`).
 *
 * This module normalizes SYNTHETIC, STATIC Airwallex webhook event fixtures
 * (payment_intent / payment_link success shapes) into rail-neutral receipt
 * shapes. It never touches a live webhook: no endpoint registration, no
 * delivery, no retry handling, no Airwallex account or API call.
 *
 * PROBE-ONLY CAP (hard invariant): card-rail receipts are REVOCABLE — a
 * succeeded payment intent can later be refunded, disputed, or reversed.
 * Normalization therefore NEVER produces a final/settled/binding receipt:
 * every successful normalization is capped at the rail-neutral `probe_only`
 * support state (`airwallex_webhook_receipt_probe_only` in the Airwallex
 * vocabulary), and refund/dispute/reversal events are explicitly NOT receipts
 * — they fail closed with reason codes documenting the revocability gap.
 *
 * SIGNATURE MODEL (issue #580 contract): webhook HMAC signature material is
 * FIXTURE-ASSERTED ONLY. RAP must never hold a merchant webhook secret, so
 * this module models the signature as `fixture_asserted: true` and never
 * computes or verifies a real HMAC. Fixtures claiming live verification,
 * carrying merchant-secret-shaped values, or omitting the fixture-asserted
 * marker are rejected.
 *
 * RECEIPT-V1 GAP (documented here, NOT solved — routes to #338): the frozen
 * `reddi.receipt.v1` envelope in `@reddi/x402-solana` has no revoked or
 * contested state, so a reversible rail cannot be represented truthfully as a
 * final receipt — there is no way to later mark a `reddi.receipt.v1` receipt
 * as refunded/disputed. This module does NOT widen the frozen receipt v1
 * union; it caps at probe_only instead and records the gap on every emitted
 * shape (`revocability.gapTrackedInIssue: 338`). Resolving the gap (a
 * revoked/contested receipt state for reversible rails) is #338 scope.
 *
 * DRAFT DISCIPLINE (mirrors #579/PR #587 and the AP2 precedent, PR #571):
 * every Airwallex structural detail below (event names, header names, field
 * shapes, status values) is read from public Airwallex docs only and is
 * UNVERIFIED against a live API — tagged inline as
 * `(unverified — Airwallex docs)`. All fixture data is synthetic.
 *
 * HARD BOUNDARY (issues #541 / #580): no Airwallex account, signup, sandbox
 * or demo credential, API call, webhook registration, live webhook delivery,
 * live HMAC verification, merchant secret custody, partnership contact,
 * spend, or live payment. Static synthetic fixtures only.
 */
export declare const AIRWALLEX_WEBHOOK_RECEIPT_SCHEMA_VERSION: "reddi.airwallex-webhook-receipt.v1";
/** Top-level draft flag: this schema signals draft/unverified external-rail shapes. */
export declare const AIRWALLEX_WEBHOOK_RECEIPT_DRAFT: true;
/** The issue that fixes this module's contract (probe-only cap, fixture-asserted HMAC). */
export declare const AIRWALLEX_WEBHOOK_RECEIPT_ISSUE: 580;
/** The epic tracking the receipt-v1 revoked/contested-state gap this module documents. */
export declare const RECEIPT_V1_REVOCATION_GAP_ISSUE: 338;
/**
 * (unverified — Airwallex docs, confirm event names) The only webhook event
 * names that may normalize into a probe-only receipt shape. Everything else
 * fails closed: revocation-family events are explicitly NOT receipts, and
 * unknown events are rejected outright.
 */
export declare const AIRWALLEX_NORMALIZABLE_EVENT_NAMES: readonly ["payment_intent.succeeded", "payment_link.paid"];
export type AirwallexNormalizableEventName = (typeof AIRWALLEX_NORMALIZABLE_EVENT_NAMES)[number];
/**
 * (unverified — Airwallex docs, confirm event names) Revocation-family events:
 * refunds, disputes, and reversals. These are the concrete proof that
 * card-rail receipts are revocable. They must NEVER normalize into a receipt
 * shape of any kind — receipt v1 has no revoked/contested state (#338 gap),
 * so emitting anything here would overclaim.
 */
export declare const AIRWALLEX_REVOCATION_EVENT_NAMES: readonly ["refund.received", "refund.processing", "refund.succeeded", "payment_dispute.created", "payment_dispute.updated", "payment_reversal.succeeded", "payment_intent.cancelled"];
export type AirwallexRevocationEventName = (typeof AIRWALLEX_REVOCATION_EVENT_NAMES)[number];
/**
 * Fixture-asserted webhook signature material (issue #580 contract).
 *
 * RAP never holds a merchant webhook secret, so no real HMAC is ever computed
 * or verified — `fixture_asserted: true` is the ONLY accepted signature
 * posture. `valueRef` is an opaque synthetic reference (must start with
 * `fixture:`), never a computable digest and never secret material.
 */
export type AirwallexWebhookSignatureFixture = {
    /** (unverified — Airwallex docs, confirm header name) signature header carried by webhook deliveries. */
    header: 'x-signature';
    /** (unverified — Airwallex docs, confirm header name) timestamp header used in signature construction. */
    timestampHeader: 'x-timestamp';
    /** Opaque synthetic signature reference. Must start with `fixture:`; never a real digest or secret. */
    valueRef: string;
    /** Issue #580 contract: signature material is fixture-asserted only. */
    fixture_asserted: true;
    /** No live HMAC verification ever happens in this module. */
    signatureVerifiedLive: false;
    /** RAP never holds a merchant webhook secret. */
    merchantSecretHeld: false;
};
/**
 * (unverified — Airwallex docs, confirm object shape) Synthetic
 * payment_intent / payment_link object carried inside a webhook event.
 * Identifiers MUST carry a `fixture` marker — non-synthetic-looking ids are
 * rejected. No URLs, PII, credentials, or settlement-finality fields allowed.
 */
export type AirwallexWebhookEventObjectFixture = {
    /** (unverified — Airwallex docs, confirm id shape) synthetic object id, e.g. `int_fixture_…` / `plink_fixture_…`. */
    id: string;
    /** (unverified — Airwallex docs, confirm amount unit; string-encoded minor units here, matching the #579 rail fixture). */
    amountMinorUnits: string;
    /** (unverified — Airwallex docs, confirm supported currency codes) ISO-4217-style fiat currency code. */
    currency: string;
    /** (unverified — Airwallex docs, confirm status vocabulary) e.g. `SUCCEEDED`. */
    status: string;
    /** Opaque seller-side order reference — synthetic, never PII. */
    merchantOrderRef: string;
    /** Opaque, NON-SECRET, non-URL template reference (same convention as the #579 rail fixture). */
    paymentLinkTemplateRef?: string;
};
/**
 * (unverified — Airwallex docs, confirm envelope shape) Synthetic webhook
 * event envelope. `id` models the stable event id Airwallex documents for
 * idempotent redelivery — RAP evidence records opaque ids and hashes only,
 * never raw webhook bodies (they carry shopper PII on the live rail).
 */
export type AirwallexWebhookEventFixture = {
    /** (unverified — Airwallex docs, confirm id shape) synthetic stable event id, e.g. `evt_fixture_…`. */
    id: string;
    /** (unverified — Airwallex docs, confirm name vocabulary) event name, e.g. `payment_intent.succeeded`. */
    name: string;
    /** ISO-8601 creation timestamp (synthetic). */
    createdAt: string;
    data: {
        object: AirwallexWebhookEventObjectFixture;
    };
};
/**
 * Opaque binding references. Hash refs are `fixture:`-prefixed opaque strings
 * over the SYNTHETIC payload — never raw webhook bodies, never live artifacts.
 */
export type AirwallexWebhookFixtureBindingRefs = {
    evidenceRef: string;
    requestHash: string;
    responseHash: string;
    recipientRef: string;
    nonceRef: string;
    operatorApprovalRef: string;
};
export type AirwallexWebhookFixture = {
    schemaVersion: typeof AIRWALLEX_WEBHOOK_RECEIPT_SCHEMA_VERSION;
    issue: typeof AIRWALLEX_WEBHOOK_RECEIPT_ISSUE;
    draft: true;
    /** Every fixture is synthetic by construction; anything else is rejected. */
    synthetic: true;
    rail: 'airwallex-hosted-checkout';
    event: AirwallexWebhookEventFixture;
    signature: AirwallexWebhookSignatureFixture;
    bindingRefs: AirwallexWebhookFixtureBindingRefs;
    notes: string[];
};
/**
 * The probe-only receipt shape a successful synthetic payment event
 * normalizes into. NEVER a final/settled/binding receipt: `supportState` is
 * pinned to `airwallex_webhook_receipt_probe_only`, the rail-neutral support
 * state is pinned to `probe_only`, and the revocability block records the
 * receipt-v1 gap (#338) on every emitted shape.
 */
export type AirwallexWebhookProbeOnlyReceipt = {
    schemaVersion: typeof AIRWALLEX_WEBHOOK_RECEIPT_SCHEMA_VERSION;
    draft: true;
    rail: 'airwallex-hosted-checkout';
    supportState: Extract<AirwallexSupportState, 'airwallex_webhook_receipt_probe_only'>;
    /** The cap in the shared rail-neutral vocabulary — never `receipt_binding_candidate`. */
    railNeutralSupportState: 'probe_only';
    eventRef: {
        eventId: string;
        eventName: AirwallexNormalizableEventName;
        occurredAt: string;
    };
    payment: {
        /** Fiat stays in the draft namespace — NOT part of the frozen BuyerAuthorityAsset v1 union. */
        fiatAssetNamespace: typeof AIRWALLEX_FIAT_RAIL_DRAFT_NAMESPACE;
        currency: string;
        amount: string;
        unit: 'fiat-minor-units';
        /** Probe-only proof reference — an opaque pointer at a synthetic event, not settlement proof. */
        paymentProofRef: string;
    };
    signature: {
        fixture_asserted: true;
        signatureVerifiedLive: false;
        merchantSecretHeld: false;
    };
    revocability: {
        /** Card-rail receipts are revocable: refund/dispute/reversal can follow a success event. */
        revocable: true;
        /** `reddi.receipt.v1` has no revoked/contested state; this module does not widen the frozen union. */
        receiptV1RevocationRepresentable: false;
        gapTrackedInIssue: typeof RECEIPT_V1_REVOCATION_GAP_ISSUE;
        note: string;
    };
    bindingRefs: AirwallexWebhookFixtureBindingRefs;
    claimBoundary: string[];
    guardrails: AirwallexRailFixtureGuardrails;
};
export type AirwallexWebhookNormalizationReasonCode = 'airwallex_webhook_probe_only_receipt' | 'webhook_fixture_malformed' | 'non_synthetic_fixture_rejected' | 'unknown_event_rejected' | 'revocation_event_not_receipt' | 'signature_missing_or_not_fixture_asserted' | 'live_signature_verification_rejected' | 'merchant_secret_material_rejected' | 'credential_material_rejected' | 'live_url_rejected' | 'pan_shaped_string_rejected' | 'email_shaped_string_rejected' | 'custody_claim_rejected' | 'settlement_finality_claim_rejected';
export type AirwallexWebhookNormalizationResult = {
    ok: true;
    receipt: AirwallexWebhookProbeOnlyReceipt;
    reasonCodes: ['airwallex_webhook_probe_only_receipt'];
    auditNotes: string[];
} | {
    ok: false;
    /** Fail-closed: every rejection lands in the unsupported live-settlement state. */
    supportState: Extract<AirwallexSupportState, 'unsupported_live_airwallex_settlement'>;
    reasonCodes: AirwallexWebhookNormalizationReasonCode[];
    auditNotes: string[];
};
/**
 * Normalize a static synthetic Airwallex webhook fixture into a rail-neutral
 * probe-only receipt shape, failing closed on everything else.
 *
 * Pure function: no network, no fs, no wallet, no RPC, no Airwallex call, no
 * HMAC computation. Successful synthetic payment events normalize to AT MOST
 * `probe_only`; refund/dispute/reversal events are explicitly NOT receipts;
 * malformed, unsigned, credential-bearing, secret-bearing, URL-bearing, and
 * PII-bearing fixtures are rejected with reason codes.
 */
export declare function normalizeAirwallexWebhookFixture(value: unknown): AirwallexWebhookNormalizationResult;
export declare const airwallexWebhookFixtures: {
    readonly paymentIntentSucceeded: AirwallexWebhookFixture;
    readonly paymentLinkPaid: AirwallexWebhookFixture;
};
export declare const airwallexWebhookRejectionFixtures: {
    readonly refundSucceeded: AirwallexWebhookFixture;
    readonly disputeCreated: AirwallexWebhookFixture;
    readonly reversalSucceeded: AirwallexWebhookFixture;
    readonly unknownEvent: AirwallexWebhookFixture;
    readonly malformedEnvelope: AirwallexWebhookFixture;
    readonly missingSignature: AirwallexWebhookFixture;
    readonly nonFixtureAssertedSignature: AirwallexWebhookFixture;
    readonly liveVerifiedSignature: AirwallexWebhookFixture;
    readonly merchantSecretValue: AirwallexWebhookFixture;
    readonly realLookingSignatureDigest: AirwallexWebhookFixture;
    readonly apiKeyLeak: AirwallexWebhookFixture;
    readonly clientIdLeak: AirwallexWebhookFixture;
    readonly liveUrl: AirwallexWebhookFixture;
    readonly panShapedString: AirwallexWebhookFixture;
    readonly emailShapedString: AirwallexWebhookFixture;
    readonly settlementFinalityClaim: AirwallexWebhookFixture;
    readonly custodyClaim: AirwallexWebhookFixture;
    readonly nonSyntheticFlag: AirwallexWebhookFixture;
    readonly realLookingIds: AirwallexWebhookFixture;
};
export declare function listAirwallexWebhookRejectionFixtures(): Array<{
    key: keyof typeof airwallexWebhookRejectionFixtures;
    fixture: AirwallexWebhookFixture;
    expectedReasonCode: AirwallexWebhookNormalizationReasonCode;
}>;
