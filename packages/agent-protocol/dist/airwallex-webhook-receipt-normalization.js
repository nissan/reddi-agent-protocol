import { AIRWALLEX_FIAT_RAIL_DRAFT_NAMESPACE, AIRWALLEX_RAIL_FIXTURE_GUARDRAILS, } from './airwallex-hosted-checkout-rail.js';
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
export const AIRWALLEX_WEBHOOK_RECEIPT_SCHEMA_VERSION = 'reddi.airwallex-webhook-receipt.v1';
/** Top-level draft flag: this schema signals draft/unverified external-rail shapes. */
export const AIRWALLEX_WEBHOOK_RECEIPT_DRAFT = true;
/** The issue that fixes this module's contract (probe-only cap, fixture-asserted HMAC). */
export const AIRWALLEX_WEBHOOK_RECEIPT_ISSUE = 580;
/** The epic tracking the receipt-v1 revoked/contested-state gap this module documents. */
export const RECEIPT_V1_REVOCATION_GAP_ISSUE = 338;
/**
 * (unverified — Airwallex docs, confirm event names) The only webhook event
 * names that may normalize into a probe-only receipt shape. Everything else
 * fails closed: revocation-family events are explicitly NOT receipts, and
 * unknown events are rejected outright.
 */
export const AIRWALLEX_NORMALIZABLE_EVENT_NAMES = [
    'payment_intent.succeeded',
    'payment_link.paid',
];
/**
 * (unverified — Airwallex docs, confirm event names) Revocation-family events:
 * refunds, disputes, and reversals. These are the concrete proof that
 * card-rail receipts are revocable. They must NEVER normalize into a receipt
 * shape of any kind — receipt v1 has no revoked/contested state (#338 gap),
 * so emitting anything here would overclaim.
 */
export const AIRWALLEX_REVOCATION_EVENT_NAMES = [
    'refund.received',
    'refund.processing',
    'refund.succeeded',
    'payment_dispute.created',
    'payment_dispute.updated',
    'payment_reversal.succeeded',
    'payment_intent.cancelled',
];
const WEBHOOK_CLAIM_BOUNDARY = [
    'Airwallex is a regulated settlement/acceptance rail owned by the seller, not by RAP.',
    'RAP claims no custody, money transmission, MoR status, or settlement finality from any Airwallex fixture.',
    'Webhook HMAC signatures are fixture-asserted, never verified against a live merchant secret.',
    'Webhook-derived receipts cap at probe_only; no receipt-binding claim on this rail.',
    'Card-rail receipts are revocable; reddi.receipt.v1 has no revoked/contested state — a documented #338 gap, and this normalization never emits a final/settled receipt.',
];
const REVOCABILITY_GAP_NOTE = 'Card-rail receipts are revocable: a succeeded payment intent can later be refunded, disputed, or reversed. '
    + 'The frozen reddi.receipt.v1 union has no revoked/contested state for reversible rails, so this shape is capped '
    + 'at probe_only and must never be upgraded to a binding/settled receipt. Gap tracked in issue #338; the frozen '
    + 'receipt v1 union is deliberately NOT widened here.';
// ---------------------------------------------------------------------------
// Fail-closed content scanners (same rejection philosophy as the #579 rail
// module; re-implemented locally so this module stays self-contained).
// ---------------------------------------------------------------------------
// Credential material: API keys, client IDs, bearer tokens, secrets, private keys.
const CREDENTIAL_KEY_PATTERN = /(^|[_-])(api[_-]?key|client[_-]?id|client[_-]?secret|authorization|bearer|cookie|credential|mnemonic|password|private[_-]?key|refresh[_-]?token|secret|seed|session[_-]?token|token|webhook[_-]?secret|hmac[_-]?key)([_-]|$)|apiKey|clientId|clientSecret|accessToken|refreshToken|sessionToken|privateKey|webhookSecret|hmacKey/i;
const CREDENTIAL_VALUE_PATTERN = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|authorization:\s*bearer\s+|bearer\s+[a-z0-9._-]{8,}|sk-[a-z0-9_-]{8,}|\bak_(live|test)_[a-z0-9]+|\bcl_(live|test)_[a-z0-9]+)/i;
// Real-looking webhook-secret material: whsec_-style values plus long
// unbroken hex/base64 runs inside the signature block (a fixture-asserted
// signature ref must be an opaque `fixture:` string, never a computable
// digest or secret).
const MERCHANT_SECRET_VALUE_PATTERN = /\bwhsec_[a-z0-9+/=_-]{8,}|\bwebhook[_-]?secret\b/i;
const REAL_LOOKING_DIGEST_PATTERN = /\b[a-f0-9]{32,}\b|\b[a-z0-9+/]{40,}={0,2}\b/i;
// Live URLs: synthetic webhook fixtures carry opaque refs only — any http(s)
// URL (Airwallex-hosted or otherwise) marks live-path material.
const URL_PATTERN = /https?:\/\//i;
// PAN-shaped: a run of 13–19 digits (optionally space/dash separated).
const PAN_PATTERN = /\b(?:\d[ -]?){13,19}\b/;
// Email-shaped: shopper PII must never enter fixtures, receipts, or evidence.
const EMAIL_PATTERN = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i;
const SETTLEMENT_CLAIM_MARKERS = [
    '"settled":true',
    '"final":true',
    '"finalized":true',
    'settlement finality',
    'final settlement',
    'settlement proven',
    'payment settled',
];
const CUSTODY_CLAIM_MARKERS = [
    '"custody":true',
    'takes custody',
    'funds in custody',
    'held in custody',
    'custody accepted',
    'escrowed',
];
const SETTLEMENT_FINALITY_KEY_PATTERN = /settlement[_-]?finality|finality[_-]?claim(ed)?$|^settled$|^finalized$/i;
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
export function normalizeAirwallexWebhookFixture(value) {
    if (!looksStructured(value)) {
        return reject(['webhook_fixture_malformed'], ['Denied: Airwallex webhook fixture is malformed or not the expected draft schema.']);
    }
    const reasonCodes = [];
    const auditNotes = [];
    const push = (code, note) => {
        if (!reasonCodes.includes(code)) {
            reasonCodes.push(code);
            auditNotes.push(note);
        }
    };
    if (value.synthetic !== true) {
        push('non_synthetic_fixture_rejected', 'Denied: only synthetic fixtures may be normalized; real webhook payloads are out of scope by construction.');
    }
    // Content scans over the entire fixture — fail closed before any shape logic.
    if (containsCredentialMaterial(value)) {
        push('credential_material_rejected', 'Denied: fixture contains API-key/client-ID/bearer/secret-shaped material. RAP never holds Airwallex credentials.');
    }
    if (containsPattern(value, MERCHANT_SECRET_VALUE_PATTERN)) {
        push('merchant_secret_material_rejected', 'Denied: fixture contains merchant-webhook-secret-shaped material. RAP must never hold a merchant webhook secret.');
    }
    if (containsPattern(value, URL_PATTERN)) {
        push('live_url_rejected', 'Denied: fixture contains an http(s) URL; synthetic webhook fixtures carry opaque non-URL references only.');
    }
    if (containsPattern(value, PAN_PATTERN)) {
        push('pan_shaped_string_rejected', 'Denied: fixture contains a PAN-shaped digit run; card data stays with the hosted checkout, never in RAP fixtures.');
    }
    if (containsPattern(value, EMAIL_PATTERN)) {
        push('email_shaped_string_rejected', 'Denied: fixture contains an email-shaped string; shopper PII never enters RAP fixtures, receipts, or evidence.');
    }
    if (claimsCustody(value)) {
        push('custody_claim_rejected', 'Denied: fixture claims custody; RAP takes no custody on the Airwallex rail.');
    }
    if (claimsSettlementFinality(value)) {
        push('settlement_finality_claim_rejected', 'Denied: fixture carries a settlement-finality field or claim; card-rail receipts are revocable and RAP claims no finality.');
    }
    // Signature posture: fixture-asserted only, never live-verified, never secret-holding.
    const signature = value.signature;
    if (!isRecord(signature) || signature.fixture_asserted !== true || !isNonEmptyString(signature.valueRef) || !signature.valueRef.startsWith('fixture:')) {
        push('signature_missing_or_not_fixture_asserted', 'Denied: webhook signature material must be present and fixture-asserted (`fixture_asserted: true`, opaque `fixture:` value ref). No real HMAC is ever verified.');
    }
    else {
        if (signature.signatureVerifiedLive !== false) {
            push('live_signature_verification_rejected', 'Denied: fixture claims live signature verification; HMAC is verifiable only with a merchant secret RAP must never hold.');
        }
        if (signature.merchantSecretHeld !== false) {
            push('merchant_secret_material_rejected', 'Denied: fixture claims a held merchant secret; RAP must never hold a merchant webhook secret.');
        }
        if (REAL_LOOKING_DIGEST_PATTERN.test(signature.valueRef)) {
            push('merchant_secret_material_rejected', 'Denied: signature value ref looks like a real digest/secret; fixture-asserted signatures must be opaque synthetic refs.');
        }
    }
    // Event dispatch.
    const event = value.event;
    if (!isRecord(event) || !isNonEmptyString(event.name) || !isNonEmptyString(event.id) || !isRecord(event.data) || !isRecord(event.data.object)) {
        push('webhook_fixture_malformed', 'Denied: webhook event envelope is malformed (id, name, and data.object are required).');
        return reject(reasonCodes, auditNotes);
    }
    const eventName = event.name;
    if (AIRWALLEX_REVOCATION_EVENT_NAMES.includes(eventName)) {
        push('revocation_event_not_receipt', `Denied: '${eventName}' is a revocation-family event (refund/dispute/reversal/cancellation) and is explicitly NOT a receipt. `
            + 'Card-rail receipts are revocable and reddi.receipt.v1 has no revoked/contested state to normalize this into — '
            + 'a documented receipt-semantics gap tracked in issue #338. The frozen receipt v1 union is not widened here.');
    }
    else if (!AIRWALLEX_NORMALIZABLE_EVENT_NAMES.includes(eventName)) {
        push('unknown_event_rejected', `Denied: unknown webhook event '${eventName}'; only synthetic success events may normalize, and only to probe_only.`);
    }
    if (!event.id.includes('fixture')) {
        push('non_synthetic_fixture_rejected', 'Denied: event id does not carry a synthetic `fixture` marker; real-looking event ids are rejected.');
    }
    if (!isNonEmptyString(event.createdAt)) {
        push('webhook_fixture_malformed', 'Denied: event createdAt timestamp is required.');
    }
    const object = event.data.object;
    if (!isNonEmptyString(object.id) || !object.id.includes('fixture')) {
        push('non_synthetic_fixture_rejected', 'Denied: event object id must carry a synthetic `fixture` marker.');
    }
    if (!isNonEmptyString(object.currency) || !/^[A-Z]{3}$/.test(object.currency)) {
        push('webhook_fixture_malformed', 'Denied: object currency must be an ISO-4217-style 3-letter code (unverified — Airwallex docs).');
    }
    if (!isNonEmptyString(object.amountMinorUnits) || !/^\d{1,12}$/.test(object.amountMinorUnits)) {
        push('webhook_fixture_malformed', 'Denied: object amountMinorUnits must be a digit string (unverified — Airwallex docs, amount unit unconfirmed).');
    }
    if (!isNonEmptyString(object.status)) {
        push('webhook_fixture_malformed', 'Denied: object status is required (unverified — Airwallex docs, status vocabulary unconfirmed).');
    }
    const bindingRefs = value.bindingRefs;
    if (!hasCompleteBindingRefs(bindingRefs)) {
        push('webhook_fixture_malformed', 'Denied: opaque binding refs (evidenceRef/requestHash/responseHash/recipientRef/nonceRef/operatorApprovalRef) are required.');
    }
    if (reasonCodes.length > 0) {
        return reject(reasonCodes, auditNotes);
    }
    const fixture = value;
    return {
        ok: true,
        receipt: {
            schemaVersion: AIRWALLEX_WEBHOOK_RECEIPT_SCHEMA_VERSION,
            draft: true,
            rail: 'airwallex-hosted-checkout',
            supportState: 'airwallex_webhook_receipt_probe_only',
            railNeutralSupportState: 'probe_only',
            eventRef: {
                eventId: fixture.event.id,
                eventName: fixture.event.name,
                occurredAt: fixture.event.createdAt,
            },
            payment: {
                fiatAssetNamespace: AIRWALLEX_FIAT_RAIL_DRAFT_NAMESPACE,
                currency: fixture.event.data.object.currency,
                amount: fixture.event.data.object.amountMinorUnits,
                unit: 'fiat-minor-units',
                paymentProofRef: `airwallex-webhook-probe:${fixture.event.name}:${fixture.event.id}`,
            },
            signature: {
                fixture_asserted: true,
                signatureVerifiedLive: false,
                merchantSecretHeld: false,
            },
            revocability: {
                revocable: true,
                receiptV1RevocationRepresentable: false,
                gapTrackedInIssue: RECEIPT_V1_REVOCATION_GAP_ISSUE,
                note: REVOCABILITY_GAP_NOTE,
            },
            bindingRefs: { ...fixture.bindingRefs },
            claimBoundary: [...WEBHOOK_CLAIM_BOUNDARY],
            guardrails: AIRWALLEX_RAIL_FIXTURE_GUARDRAILS,
        },
        reasonCodes: ['airwallex_webhook_probe_only_receipt'],
        auditNotes: [
            'Allowed: synthetic success event normalized into a rail-neutral receipt shape capped at probe_only.',
            'Card-rail receipts are revocable; no final/settled/binding receipt is emitted on this rail (#338 gap documented, frozen receipt v1 union untouched).',
            'Signature material is fixture-asserted; no merchant secret is held and no real HMAC was verified.',
        ],
    };
}
function reject(reasonCodes, auditNotes) {
    return {
        ok: false,
        supportState: 'unsupported_live_airwallex_settlement',
        reasonCodes,
        auditNotes,
    };
}
function looksStructured(value) {
    if (!isRecord(value))
        return false;
    return value.schemaVersion === AIRWALLEX_WEBHOOK_RECEIPT_SCHEMA_VERSION
        && value.issue === AIRWALLEX_WEBHOOK_RECEIPT_ISSUE
        && value.draft === true
        && value.rail === 'airwallex-hosted-checkout';
}
function hasCompleteBindingRefs(value) {
    if (!isRecord(value))
        return false;
    return ['evidenceRef', 'requestHash', 'responseHash', 'recipientRef', 'nonceRef', 'operatorApprovalRef']
        .every((key) => isNonEmptyString(value[key]));
}
function containsCredentialMaterial(value) {
    if (typeof value === 'string')
        return CREDENTIAL_VALUE_PATTERN.test(value);
    if (!value || typeof value !== 'object')
        return false;
    if (Array.isArray(value))
        return value.some(containsCredentialMaterial);
    return Object.entries(value).some(([key, nested]) => (
    // Secret-shaped KEYS are rejected when they carry any non-false payload;
    // hard-false guardrail flags (e.g. merchantSecretHeld: false) are the
    // documented safe shape.
    (CREDENTIAL_KEY_PATTERN.test(key) && nested !== false) || containsCredentialMaterial(nested)));
}
function containsPattern(value, pattern) {
    if (typeof value === 'string')
        return pattern.test(value);
    if (!value || typeof value !== 'object')
        return false;
    if (Array.isArray(value))
        return value.some((item) => containsPattern(item, pattern));
    return Object.values(value).some((item) => containsPattern(item, pattern));
}
function claimsCustody(value) {
    const serialized = JSON.stringify(value).toLowerCase();
    return CUSTODY_CLAIM_MARKERS.some((marker) => serialized.includes(marker));
}
function claimsSettlementFinality(value) {
    const serialized = JSON.stringify(value).toLowerCase();
    if (SETTLEMENT_CLAIM_MARKERS.some((marker) => serialized.includes(marker)))
        return true;
    return hasTruthyKeyMatching(value, SETTLEMENT_FINALITY_KEY_PATTERN);
}
function hasTruthyKeyMatching(value, pattern) {
    if (!value || typeof value !== 'object')
        return false;
    if (Array.isArray(value))
        return value.some((item) => hasTruthyKeyMatching(item, pattern));
    return Object.entries(value).some(([key, nested]) => ((pattern.test(key) && !!nested) || hasTruthyKeyMatching(nested, pattern)));
}
function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
// ---------------------------------------------------------------------------
// Static synthetic fixtures. Every value is synthetic; identifiers carry an
// explicit `fixture` marker; no URL, PII, credential, or secret material.
// ---------------------------------------------------------------------------
const FIXTURE_SIGNATURE = {
    header: 'x-signature',
    timestampHeader: 'x-timestamp',
    valueRef: 'fixture:signature:airwallex-webhook:synthetic-0001',
    fixture_asserted: true,
    signatureVerifiedLive: false,
    merchantSecretHeld: false,
};
const FIXTURE_BINDING_REFS = {
    evidenceRef: 'fixture:artifact:airwallex-webhook/payment-intent-succeeded',
    requestHash: 'fixture:sha256:req-9c41d2fixture',
    responseHash: 'fixture:sha256:res-b07afixture',
    recipientRef: 'fixture:recipient:seller-airwallex-account',
    nonceRef: 'fixture:nonce:awx-evt-0001',
    operatorApprovalRef: 'fixture:operator-approval:not-required-probe-only',
};
const FIXTURE_NOTES = [
    'Synthetic Airwallex webhook fixture — every field shape is (unverified — Airwallex docs).',
    'Normalization caps at probe_only; card-rail receipts are revocable and receipt v1 has no revoked/contested state (#338 gap).',
    'Signature material is fixture-asserted; RAP never holds a merchant webhook secret.',
];
function makeFixture(event) {
    return {
        schemaVersion: AIRWALLEX_WEBHOOK_RECEIPT_SCHEMA_VERSION,
        issue: AIRWALLEX_WEBHOOK_RECEIPT_ISSUE,
        draft: true,
        synthetic: true,
        rail: 'airwallex-hosted-checkout',
        event,
        signature: { ...FIXTURE_SIGNATURE },
        bindingRefs: { ...FIXTURE_BINDING_REFS },
        notes: [...FIXTURE_NOTES],
    };
}
/** Succeeded synthetic payment_intent event — normalizes to a probe-only receipt shape. */
const paymentIntentSucceeded = makeFixture({
    id: 'evt_fixture_awx_0001',
    name: 'payment_intent.succeeded',
    createdAt: '2026-07-06T02:15:00.000Z',
    data: {
        object: {
            id: 'int_fixture_awx_0001',
            amountMinorUnits: '2500',
            currency: 'AUD',
            status: 'SUCCEEDED',
            merchantOrderRef: 'fixture:order:listing-writer-001',
            paymentLinkTemplateRef: 'fixture:airwallex-payment-link-template:listing-writer-001',
        },
    },
});
/** Paid synthetic payment_link event — normalizes to a probe-only receipt shape. */
const paymentLinkPaid = makeFixture({
    id: 'evt_fixture_awx_0002',
    name: 'payment_link.paid',
    createdAt: '2026-07-06T02:20:00.000Z',
    data: {
        object: {
            id: 'plink_fixture_awx_0002',
            amountMinorUnits: '2500',
            currency: 'AUD',
            status: 'PAID',
            merchantOrderRef: 'fixture:order:listing-writer-001',
            paymentLinkTemplateRef: 'fixture:airwallex-payment-link-template:listing-writer-001',
        },
    },
});
export const airwallexWebhookFixtures = {
    paymentIntentSucceeded,
    paymentLinkPaid,
};
// ---------------------------------------------------------------------------
// Rejection fixtures — each must fail closed with the annotated reason code.
// All values are synthetic; none is a real credential, secret, URL, PAN, or
// email address.
// ---------------------------------------------------------------------------
function withEventOverride(base, overrides) {
    const fixture = structuredClone(base);
    Object.assign(fixture.event, overrides);
    return fixture;
}
function withObjectOverride(base, overrides) {
    const fixture = structuredClone(base);
    Object.assign(fixture.event.data.object, overrides);
    return fixture;
}
/** expects: revocation_event_not_receipt — refunds are NOT receipts (revocability gap, #338). */
const refundSucceeded = withEventOverride(paymentIntentSucceeded, {
    id: 'evt_fixture_awx_1001',
    name: 'refund.succeeded',
});
/** expects: revocation_event_not_receipt — disputes are NOT receipts (revocability gap, #338). */
const disputeCreated = withEventOverride(paymentIntentSucceeded, {
    id: 'evt_fixture_awx_1002',
    name: 'payment_dispute.created',
});
/** expects: revocation_event_not_receipt — reversals are NOT receipts (revocability gap, #338). */
const reversalSucceeded = withEventOverride(paymentIntentSucceeded, {
    id: 'evt_fixture_awx_1003',
    name: 'payment_reversal.succeeded',
});
/** expects: unknown_event_rejected — unrecognized event names fail closed. */
const unknownEvent = withEventOverride(paymentIntentSucceeded, {
    id: 'evt_fixture_awx_1004',
    name: 'payment_intent.created',
});
/** expects: webhook_fixture_malformed — event envelope stripped. */
const malformedEnvelope = (() => {
    const fixture = structuredClone(paymentIntentSucceeded);
    fixture.event = { id: 'evt_fixture_awx_1005' };
    return fixture;
})();
/** expects: signature_missing_or_not_fixture_asserted — signature block removed. */
const missingSignature = (() => {
    const fixture = structuredClone(paymentIntentSucceeded);
    delete fixture.signature;
    return fixture;
})();
/** expects: signature_missing_or_not_fixture_asserted — fixture_asserted flipped off. */
const nonFixtureAssertedSignature = (() => {
    const fixture = structuredClone(paymentIntentSucceeded);
    fixture.signature.fixture_asserted = false;
    return fixture;
})();
/** expects: live_signature_verification_rejected — a live HMAC verification claim. */
const liveVerifiedSignature = (() => {
    const fixture = structuredClone(paymentIntentSucceeded);
    fixture.signature.signatureVerifiedLive = true;
    return fixture;
})();
/** expects: merchant_secret_material_rejected — whsec_-shaped synthetic secret value. */
const merchantSecretValue = (() => {
    const fixture = structuredClone(paymentIntentSucceeded);
    fixture.notes = [...fixture.notes, 'configured with whsec_fixture0synthetic0value'];
    return fixture;
})();
/** expects: merchant_secret_material_rejected — signature ref shaped like a real digest. */
const realLookingSignatureDigest = (() => {
    const fixture = structuredClone(paymentIntentSucceeded);
    fixture.signature.valueRef = 'fixture:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    return fixture;
})();
/** expects: credential_material_rejected — synthetic API-key-shaped value. */
const apiKeyLeak = (() => {
    const fixture = structuredClone(paymentIntentSucceeded);
    fixture.notes = [...fixture.notes, 'configured via ak_live_0f1x2t3u4r5e6synthetic'];
    return fixture;
})();
/** expects: credential_material_rejected — credential-shaped KEY (clientId), synthetic value. */
const clientIdLeak = (() => {
    const fixture = structuredClone(paymentIntentSucceeded);
    fixture.clientId = 'fixture-synthetic-client-id';
    return fixture;
})();
/** expects: live_url_rejected — URL-shaped content anywhere in the fixture. */
const liveUrl = withObjectOverride(paymentIntentSucceeded, {
    paymentLinkTemplateRef: 'https://checkout.airwallex.example.invalid/pay/int_fixture',
});
/** expects: pan_shaped_string_rejected — PAN-shaped dummy digits. */
const panShapedString = withObjectOverride(paymentIntentSucceeded, {
    merchantOrderRef: 'card on file 4111111111111111',
});
/** expects: email_shaped_string_rejected — shopper-PII-shaped email. */
const emailShapedString = withObjectOverride(paymentIntentSucceeded, {
    merchantOrderRef: 'shopper contact shopper@example.invalid',
});
/** expects: settlement_finality_claim_rejected — a settled/finality field on the event object. */
const settlementFinalityClaim = withObjectOverride(paymentIntentSucceeded, {
    settled: true,
});
/** expects: custody_claim_rejected — textual custody claim. */
const custodyClaim = (() => {
    const fixture = structuredClone(paymentIntentSucceeded);
    fixture.notes = [...fixture.notes, 'funds in custody of RAP until release'];
    return fixture;
})();
/** expects: non_synthetic_fixture_rejected — synthetic flag flipped off. */
const nonSyntheticFlag = (() => {
    const fixture = structuredClone(paymentIntentSucceeded);
    fixture.synthetic = false;
    return fixture;
})();
/** expects: non_synthetic_fixture_rejected — real-looking (non-fixture) event/object ids. */
const realLookingIds = (() => {
    const fixture = structuredClone(paymentIntentSucceeded);
    fixture.event.id = 'evt_9dc41b7a';
    fixture.event.data.object.id = 'int_5a2f91cc';
    return fixture;
})();
export const airwallexWebhookRejectionFixtures = {
    refundSucceeded,
    disputeCreated,
    reversalSucceeded,
    unknownEvent,
    malformedEnvelope,
    missingSignature,
    nonFixtureAssertedSignature,
    liveVerifiedSignature,
    merchantSecretValue,
    realLookingSignatureDigest,
    apiKeyLeak,
    clientIdLeak,
    liveUrl,
    panShapedString,
    emailShapedString,
    settlementFinalityClaim,
    custodyClaim,
    nonSyntheticFlag,
    realLookingIds,
};
export function listAirwallexWebhookRejectionFixtures() {
    const expected = {
        refundSucceeded: 'revocation_event_not_receipt',
        disputeCreated: 'revocation_event_not_receipt',
        reversalSucceeded: 'revocation_event_not_receipt',
        unknownEvent: 'unknown_event_rejected',
        malformedEnvelope: 'webhook_fixture_malformed',
        missingSignature: 'signature_missing_or_not_fixture_asserted',
        nonFixtureAssertedSignature: 'signature_missing_or_not_fixture_asserted',
        liveVerifiedSignature: 'live_signature_verification_rejected',
        merchantSecretValue: 'merchant_secret_material_rejected',
        realLookingSignatureDigest: 'merchant_secret_material_rejected',
        apiKeyLeak: 'credential_material_rejected',
        clientIdLeak: 'credential_material_rejected',
        liveUrl: 'live_url_rejected',
        panShapedString: 'pan_shaped_string_rejected',
        emailShapedString: 'email_shaped_string_rejected',
        settlementFinalityClaim: 'settlement_finality_claim_rejected',
        custodyClaim: 'custody_claim_rejected',
        nonSyntheticFlag: 'non_synthetic_fixture_rejected',
        realLookingIds: 'non_synthetic_fixture_rejected',
    };
    return Object.keys(airwallexWebhookRejectionFixtures)
        .map((key) => ({
        key,
        fixture: structuredClone(airwallexWebhookRejectionFixtures[key]),
        expectedReasonCode: expected[key],
    }));
}
