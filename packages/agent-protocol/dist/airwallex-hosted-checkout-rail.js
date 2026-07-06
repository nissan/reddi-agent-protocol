import { SELLER_WRAPPER_RAIL_FIXTURE_SCHEMA_VERSION, sellerWrapperRailFixture, } from './seller-wrapper-rail-fixtures.js';
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
export const AIRWALLEX_HOSTED_CHECKOUT_RAIL_SCHEMA_VERSION = 'reddi.airwallex-hosted-checkout-rail.v1';
/** Top-level draft flag: this schema signals draft/unverified external-rail shapes. */
export const AIRWALLEX_HOSTED_CHECKOUT_RAIL_DRAFT = true;
/**
 * Draft namespace for fiat-currency rail metadata. `BuyerAuthorityAsset` v1 is a
 * frozen closed union (SOL | USDC | AUDD); fiat currency support deliberately
 * stays in this draft namespace until #338 decides on extending the asset union.
 */
export const AIRWALLEX_FIAT_RAIL_DRAFT_NAMESPACE = 'reddi.fiat-rail-fixture';
export const AIRWALLEX_RAIL_FIXTURE_GUARDRAILS = {
    fixtureOnly: true,
    airwallexAccountCreated: false,
    liveAirwallexApiCall: false,
    livePaymentExecuted: false,
    webhookEndpointRegistered: false,
    hmacVerifiedLive: false,
    merchantSecretHeld: false,
    kybArtifactsCollected: false,
    shopperPiiStored: false,
    custodyClaim: false,
    moneyTransmissionClaim: false,
    merchantOfRecordClaim: false,
    settlementFinalityClaim: false,
};
const AIRWALLEX_SHARED_CLAIM_BOUNDARY = [
    'Airwallex is a regulated settlement/acceptance rail owned by the seller, not by RAP.',
    'RAP claims no custody, money transmission, MoR status, or settlement finality from any Airwallex fixture.',
    'Webhook HMAC signatures are fixture-asserted, never verified against a live merchant secret.',
];
export const AIRWALLEX_RAIL_SUPPORT_STATE_MATRIX = [
    {
        rail: 'airwallex-hosted-checkout',
        standard: 'Airwallex hosted checkout (Payment Links / hosted payment page)',
        supportState: 'airwallex_hosted_checkout_fixture',
        surfaces: ['payment-link', 'hosted-payment-page'],
        description: 'Seller-owned hosted-checkout rail described as seller-wrapper metadata only '
            + '(merchantOfRecord: seller, state: fixture). The seller\'s own Airwallex account '
            + 'executes; RAP never touches funds — same posture as AUDD proof-metadata-only. '
            + 'No account, no API call, no live payment link.',
        draft: true,
        confidence: 'low',
        governanceNote: '(unverified — Airwallex docs) KYB and PCI scope stay with the seller/Airwallex; the seller '
            + 'is Merchant of Record in the direct model. Data-residency diligence is the seller\'s '
            + 'obligation when choosing Airwallex; RAP stores no shopper personal data by construction.',
        claimBoundary: [...AIRWALLEX_SHARED_CLAIM_BOUNDARY],
    },
    {
        rail: 'airwallex-hosted-checkout',
        standard: 'Airwallex hosted checkout (Payment Links / hosted payment page)',
        supportState: 'airwallex_webhook_receipt_probe_only',
        surfaces: ['webhook payment_intent.succeeded', 'webhook refund', 'webhook dispute'],
        description: 'Synthetic (static, PII-free) Airwallex webhook fixtures may normalize into rail-neutral '
            + 'receipt candidates capped at probe_only: card-rail receipts are REVOCABLE (a succeeded '
            + 'intent can later be refunded or disputed — receipt v1 has no representation for a '
            + 'later-revoked/contested receipt, a tracked #338 receipt-semantics gap), the receipt v1 '
            + 'network table is Solana-only, and HMAC is verifiable only with a merchant secret RAP '
            + 'must never hold. Normalization itself is a separate follow-up issue.',
        draft: true,
        confidence: 'low',
        governanceNote: '(unverified — Airwallex docs) webhook retries use exponential backoff for roughly 3 days '
            + 'with a stable event id for idempotency; RAP evidence may record opaque IDs and hashes '
            + 'only, never raw webhook bodies (they carry shopper PII).',
        claimBoundary: [
            ...AIRWALLEX_SHARED_CLAIM_BOUNDARY,
            'Webhook-derived receipts cap at probe_only; no receipt-binding claim on this rail.',
        ],
    },
    {
        rail: 'airwallex-hosted-checkout',
        standard: 'Airwallex hosted checkout (Payment Links / hosted payment page)',
        supportState: 'unsupported_live_airwallex_settlement',
        surfaces: ['live payments', 'payouts', 'connected accounts / embedded finance', 'Airi', 'stablecoin'],
        description: 'Any live Airwallex settlement claim fails closed: account signup, sandbox/demo credentials, '
            + 'API calls, webhook registration, live HMAC verification, payouts, connected-account/'
            + 'embedded-finance platform mode (pushes RAP toward MoR/money transmission and KYB '
            + 'obligations — rejected for OSS core), Airi, and any stablecoin-via-Airwallex claim (no GA '
            + 'product exists). A live lane requires an explicitly operator-approved boundary re-scope '
            + 'under the #338 gates.',
        draft: true,
        confidence: 'low',
        governanceNote: '(unverified — Airwallex docs/press) every executable Airwallex surface sits behind account '
            + 'signup + KYB + API credentials; there is no anonymous sandbox surface, so all executable '
            + 'integration is out of scope by construction.',
        claimBoundary: [
            ...AIRWALLEX_SHARED_CLAIM_BOUNDARY,
            'Live Airwallex settlement, payouts, platform/embedded-finance mode, Airi, and stablecoin claims are unsupported and fail closed.',
        ],
    },
];
// ---------------------------------------------------------------------------
// Illustrative fixture (static, no I/O). DRAFT/unverified Airwallex shapes.
// Reuses the existing seller-wrapper endpoint identity so the fiat rail reads
// as additional metadata on the same seller wrapper, without touching the
// frozen v1 rail union in `seller-wrapper-rail-fixtures.ts`.
// ---------------------------------------------------------------------------
const SELLER_WRAPPER_ENDPOINT = sellerWrapperRailFixture.endpoints[0];
const hostedCheckoutRail = {
    id: 'rail:airwallex-hosted-checkout-aud',
    railKind: 'airwallex-hosted-checkout',
    fiatAssetNamespace: AIRWALLEX_FIAT_RAIL_DRAFT_NAMESPACE,
    currency: 'AUD',
    amountMinorUnits: '2500',
    checkoutMode: 'payment-link',
    merchantOfRecord: 'seller',
    paymentLinkTemplateRef: 'fixture:airwallex-payment-link-template:listing-writer-001',
    webhookReceiptExpected: true,
    state: 'fixture',
    supportState: 'airwallex_hosted_checkout_fixture',
    evidenceRequired: true,
    approvalRequired: true,
    livePaymentApproved: false,
    custodySupported: false,
    notes: [
        'Seller-owned regulated fiat rail described as metadata only; the seller\'s own Airwallex account executes.',
        'RAP is neither Merchant of Record nor processor on this rail and never touches funds.',
        'Fiat currency stays in the draft namespace until #338 decides on extending the asset union.',
        'Card-rail receipts are revocable (refund/dispute); receipt v1 cannot represent revocation — #338 gap.',
    ],
};
export const airwallexHostedCheckoutRailFixture = {
    schemaVersion: AIRWALLEX_HOSTED_CHECKOUT_RAIL_SCHEMA_VERSION,
    issue: 579,
    draft: true,
    sourceContract: {
        assessmentIssue: 541,
        railNeutralityEpic: 338,
        sellerWrapperFeature: 375,
        ap2PrecedentPullRequest: 571,
        sellerWrapperRailFixtureSchemaVersion: SELLER_WRAPPER_RAIL_FIXTURE_SCHEMA_VERSION,
    },
    endpoints: [
        {
            kind: SELLER_WRAPPER_ENDPOINT.kind,
            endpointId: SELLER_WRAPPER_ENDPOINT.endpointId,
            displayName: `${SELLER_WRAPPER_ENDPOINT.displayName} — Airwallex hosted-checkout metadata`,
            transport: { ...SELLER_WRAPPER_ENDPOINT.transport },
            fiatRailsDraft: [hostedCheckoutRail],
        },
    ],
    guardrails: AIRWALLEX_RAIL_FIXTURE_GUARDRAILS,
};
export function getAirwallexHostedCheckoutRail(fixture = airwallexHostedCheckoutRailFixture) {
    return fixture.endpoints.flatMap((endpoint) => endpoint.fiatRailsDraft)
        .find((rail) => rail.railKind === 'airwallex-hosted-checkout');
}
// Credential material: API keys, client IDs, bearer tokens, secrets, private keys.
// (Airwallex API auth uses a client id + API key pair — both are rejected shapes.)
const CREDENTIAL_KEY_PATTERN = /(^|[_-])(api[_-]?key|client[_-]?id|client[_-]?secret|authorization|bearer|cookie|credential|mnemonic|password|private[_-]?key|refresh[_-]?token|secret|seed|session[_-]?token|token|webhook[_-]?secret|hmac[_-]?key)([_-]|$)|apiKey|clientId|clientSecret|accessToken|refreshToken|sessionToken|privateKey|webhookSecret|hmacKey/i;
const CREDENTIAL_VALUE_PATTERN = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|authorization:\s*bearer\s+|bearer\s+[a-z0-9._-]{8,}|sk-[a-z0-9_-]{8,}|\bak_(live|test)_[a-z0-9]+|\bcl_(live|test)_[a-z0-9]+)/i;
// Live payment-link URLs: any URL on an Airwallex-controlled host, and any
// http(s) URL inside a paymentLinkTemplateRef (template refs must stay opaque).
const AIRWALLEX_URL_PATTERN = /https?:\/\/[^\s"']*airwallex[^\s"']*/i;
const URL_PATTERN = /^https?:\/\//i;
// PAN-shaped: a run of 13–19 digits (optionally space/dash separated). Rejects
// raw card numbers even as dummies — hosted checkout keeps card data with Airwallex.
const PAN_PATTERN = /\b(?:\d[ -]?){13,19}\b/;
// Email-shaped: shopper PII must never enter rail metadata, receipts, or evidence.
const EMAIL_PATTERN = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i;
// Explicit settlement/custody claim markers (string form) plus field-shaped claims.
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
 * Fail-closed validation of an Airwallex hosted-checkout rail fixture.
 *
 * Pure function: no network, no wallet, no RPC, no Airwallex call. Rejects
 * credential material (API keys/client IDs/bearer tokens/webhook secrets), live
 * payment-link URLs, PAN- and email-shaped strings (shopper PII), custody and
 * settlement-finality claims, non-seller MoR, non-fixture states, and any live
 * payment approval. Invalid fixtures land in `unsupported_live_airwallex_settlement`.
 */
export function validateAirwallexHostedCheckoutRailFixture(value) {
    if (!looksStructured(value)) {
        return {
            valid: false,
            supportState: 'unsupported_live_airwallex_settlement',
            reasonCodes: ['rail_fixture_malformed'],
            auditNotes: ['Denied: Airwallex rail fixture is malformed.'],
        };
    }
    const reasonCodes = [];
    const auditNotes = [];
    const push = (code, note) => {
        if (!reasonCodes.includes(code)) {
            reasonCodes.push(code);
            auditNotes.push(note);
        }
    };
    if (containsCredentialMaterial(value)) {
        push('credential_material_rejected', 'Denied: fixture contains API-key/client-ID/bearer/secret-shaped material. RAP never holds Airwallex credentials.');
    }
    if (containsLivePaymentLink(value)) {
        push('live_payment_link_rejected', 'Denied: fixture contains a live payment-link URL; paymentLinkTemplateRef must stay an opaque non-URL reference.');
    }
    if (containsPattern(value, PAN_PATTERN)) {
        push('pan_shaped_string_rejected', 'Denied: fixture contains a PAN-shaped digit run; card data stays with the hosted checkout, never in RAP metadata.');
    }
    if (containsPattern(value, EMAIL_PATTERN)) {
        push('email_shaped_string_rejected', 'Denied: fixture contains an email-shaped string; shopper PII never enters RAP rail metadata.');
    }
    if (claimsCustody(value)) {
        push('custody_claim_rejected', 'Denied: fixture claims custody; RAP takes no custody on the Airwallex rail.');
    }
    if (claimsSettlementFinality(value)) {
        push('settlement_finality_claim_rejected', 'Denied: fixture carries a settlement-finality field or claim; card-rail receipts are revocable and RAP claims no finality.');
    }
    const rails = collectRails(value);
    if (rails.length === 0) {
        push('rail_fixture_malformed', 'Denied: no airwallex-hosted-checkout rail present in fixture.');
    }
    for (const rail of rails) {
        if (rail.merchantOfRecord !== 'seller') {
            push('merchant_of_record_not_seller', 'Denied: the seller must be Merchant of Record; RAP/platform MoR variants are rejected for OSS core.');
        }
        if (rail.state !== 'fixture') {
            push('non_fixture_state_rejected', 'Denied: the Airwallex rail is fixture-only; no dry-run/devnet/live state exists for this rail.');
        }
        if (rail.livePaymentApproved !== false) {
            push('live_payment_approval_rejected', 'Denied: live payment can never be approved on the Airwallex fixture rail.');
        }
        if (rail.custodySupported !== false) {
            push('custody_claim_rejected', 'Denied: custodySupported must be false; RAP takes no custody on the Airwallex rail.');
        }
        if (rail.webhookReceiptExpected !== true) {
            push('rail_fixture_malformed', 'Denied: webhookReceiptExpected must be true for hosted-checkout rail metadata.');
        }
    }
    if (!guardrailsAllSafe(value.guardrails)) {
        push('guardrails_invalid', 'Denied: guardrails must be present with fixtureOnly true and every live/custody/MoR/finality flag false.');
    }
    if (reasonCodes.length > 0) {
        return {
            valid: false,
            supportState: 'unsupported_live_airwallex_settlement',
            reasonCodes,
            auditNotes,
        };
    }
    return {
        valid: true,
        supportState: 'airwallex_hosted_checkout_fixture',
        reasonCodes: ['airwallex_rail_fixture_valid'],
        auditNotes: [
            'Allowed: seller-owned Airwallex hosted-checkout rail metadata is non-secret, fixture-only, seller-MoR, and claims no custody or settlement finality.',
        ],
    };
}
function looksStructured(value) {
    if (!isRecord(value))
        return false;
    const candidate = value;
    return candidate.schemaVersion === AIRWALLEX_HOSTED_CHECKOUT_RAIL_SCHEMA_VERSION
        && candidate.issue === 579
        && candidate.draft === true
        && Array.isArray(candidate.endpoints);
}
function collectRails(fixture) {
    return fixture.endpoints
        .filter((endpoint) => isRecord(endpoint) && Array.isArray(endpoint.fiatRailsDraft))
        .flatMap((endpoint) => endpoint.fiatRailsDraft)
        .filter((rail) => (isRecord(rail) && rail.railKind === 'airwallex-hosted-checkout'));
}
function containsCredentialMaterial(value) {
    if (typeof value === 'string')
        return CREDENTIAL_VALUE_PATTERN.test(value);
    if (!value || typeof value !== 'object')
        return false;
    if (Array.isArray(value))
        return value.some(containsCredentialMaterial);
    return Object.entries(value).some(([key, nested]) => (CREDENTIAL_KEY_PATTERN.test(key) || containsCredentialMaterial(nested)));
}
function containsLivePaymentLink(value) {
    if (containsPattern(value, AIRWALLEX_URL_PATTERN))
        return true;
    return collectStringsForKey(value, 'paymentLinkTemplateRef').some((ref) => URL_PATTERN.test(ref));
}
function collectStringsForKey(value, key, found = []) {
    if (!value || typeof value !== 'object')
        return found;
    if (Array.isArray(value)) {
        for (const item of value)
            collectStringsForKey(item, key, found);
        return found;
    }
    for (const [entryKey, nested] of Object.entries(value)) {
        if (entryKey === key && typeof nested === 'string')
            found.push(nested);
        collectStringsForKey(nested, key, found);
    }
    return found;
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
    return Object.entries(value).some(([key, nested]) => (
    // Guardrail-style hard-false flags (e.g. settlementFinalityClaim: false) are the
    // documented safe shape; only a truthy value asserts a claim.
    (pattern.test(key) && !!nested) || hasTruthyKeyMatching(nested, pattern)));
}
function guardrailsAllSafe(guardrails) {
    if (!isRecord(guardrails))
        return false;
    if (guardrails.fixtureOnly !== true)
        return false;
    const liveFlags = [
        'airwallexAccountCreated',
        'liveAirwallexApiCall',
        'livePaymentExecuted',
        'webhookEndpointRegistered',
        'hmacVerifiedLive',
        'merchantSecretHeld',
        'kybArtifactsCollected',
        'shopperPiiStored',
        'custodyClaim',
        'moneyTransmissionClaim',
        'merchantOfRecordClaim',
        'settlementFinalityClaim',
    ];
    return liveFlags.every((flag) => guardrails[flag] === false);
}
function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
// ---------------------------------------------------------------------------
// Rejection fixtures — each must fail closed with the annotated reason code.
// All values are synthetic; none is a real credential, URL, PAN, or address.
// ---------------------------------------------------------------------------
function cloneFixture() {
    return structuredClone(airwallexHostedCheckoutRailFixture);
}
function withRailOverride(overrides) {
    const fixture = cloneFixture();
    Object.assign(fixture.endpoints[0].fiatRailsDraft[0], overrides);
    return fixture;
}
/** expects: credential_material_rejected — synthetic Airwallex-style API-key value. */
const apiKeyLeak = withRailOverride({
    notes: ['configured via ak_live_0f1x2t3u4r5e6synthetic'],
});
/** expects: credential_material_rejected — credential-shaped KEY (clientId), synthetic value. */
const clientIdLeak = withRailOverride({
    clientId: 'fixture-synthetic-client-id',
});
/** expects: credential_material_rejected — bearer-token-shaped string. */
const bearerTokenLeak = withRailOverride({
    notes: ['authorization: bearer fixture-synthetic-token-000'],
});
/** expects: live_payment_link_rejected — URL on an Airwallex host. */
const livePaymentLinkUrl = withRailOverride({
    paymentLinkTemplateRef: 'https://checkout-demo.airwallex.example.airwallex.com/pay/int_fixture',
});
/** expects: live_payment_link_rejected — any http(s) URL in the template ref, even non-Airwallex. */
const urlTemplateRef = withRailOverride({
    paymentLinkTemplateRef: 'https://pay.example.invalid/checkout/fixture-001',
});
/** expects: pan_shaped_string_rejected — PAN-shaped dummy digits. */
const panShapedString = withRailOverride({
    notes: ['card on file 4111111111111111'],
});
/** expects: email_shaped_string_rejected — shopper-PII-shaped email. */
const emailShapedString = withRailOverride({
    notes: ['shopper contact shopper@example.invalid'],
});
/** expects: custody_claim_rejected — custodySupported flipped true. */
const custodyClaim = withRailOverride({
    custodySupported: true,
});
/** expects: settlement_finality_claim_rejected — settlementFinality field present. */
const settlementFinalityField = withRailOverride({
    settlementFinality: 'guaranteed',
});
/** expects: settlement_finality_claim_rejected — textual finality claim. */
const settlementFinalityText = withRailOverride({
    notes: ['this rail provides final settlement for the buyer'],
});
/** expects: merchant_of_record_not_seller — platform MoR variant (embedded-finance posture). */
const platformMerchantOfRecord = withRailOverride({
    merchantOfRecord: 'platform',
});
/** expects: non_fixture_state_rejected + live_payment_approval_rejected. */
const liveStateRail = withRailOverride({
    state: 'live-gated',
    livePaymentApproved: true,
});
/** expects: guardrails_invalid — a live flag flipped true. */
const guardrailsLiveFlag = (() => {
    const fixture = cloneFixture();
    fixture.guardrails = { ...fixture.guardrails, liveAirwallexApiCall: true };
    return fixture;
})();
export const airwallexRailRejectionFixtures = {
    apiKeyLeak,
    clientIdLeak,
    bearerTokenLeak,
    livePaymentLinkUrl,
    urlTemplateRef,
    panShapedString,
    emailShapedString,
    custodyClaim,
    settlementFinalityField,
    settlementFinalityText,
    platformMerchantOfRecord,
    liveStateRail,
    guardrailsLiveFlag,
};
export function listAirwallexRailRejectionFixtures() {
    const expected = {
        apiKeyLeak: 'credential_material_rejected',
        clientIdLeak: 'credential_material_rejected',
        bearerTokenLeak: 'credential_material_rejected',
        livePaymentLinkUrl: 'live_payment_link_rejected',
        urlTemplateRef: 'live_payment_link_rejected',
        panShapedString: 'pan_shaped_string_rejected',
        emailShapedString: 'email_shaped_string_rejected',
        custodyClaim: 'custody_claim_rejected',
        settlementFinalityField: 'settlement_finality_claim_rejected',
        settlementFinalityText: 'settlement_finality_claim_rejected',
        platformMerchantOfRecord: 'merchant_of_record_not_seller',
        liveStateRail: 'non_fixture_state_rejected',
        guardrailsLiveFlag: 'guardrails_invalid',
    };
    return Object.keys(airwallexRailRejectionFixtures)
        .map((key) => ({
        key,
        fixture: structuredClone(airwallexRailRejectionFixtures[key]),
        expectedReasonCode: expected[key],
    }));
}
