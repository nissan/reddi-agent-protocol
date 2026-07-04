import { createHash } from 'node:crypto';
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
export const AP2_MANDATE_INGESTION_SCHEMA_VERSION = 'reddi.ap2-mandate-ingestion.v1';
/** Top-level draft flag: this schema signals draft/unverified external-standard shapes. */
export const AP2_MANDATE_INGESTION_DRAFT = true;
export const AP2_MANDATE_INGESTION_GUARDRAILS = {
    fixtureOnly: true,
    vdcSignatureVerifiedLive: false,
    livePaymentExecuted: false,
    walletSigning: false,
    rpcCall: false,
    custodyClaim: false,
    settlementFinalityClaim: false,
};
/** Illustrative default `now` for fixtures (fixture-only, no wall-clock dependency). */
export const AP2_MANDATE_INGESTION_FIXTURE_NOW = '2026-07-05T00:00:00.000Z';
// Reuse the receipts.ts sensitive-key/value patterns (which deliberately do NOT flag
// an expected opaque `signature` field). The VDC signature is stripped before scanning.
const SENSITIVE_KEY_PATTERN = /(^|[_-])(api[_-]?key|authorization|bearer|cookie|credential|mnemonic|password|private[_-]?key|refresh[_-]?token|secret|seed|session[_-]?token|token)([_-]|$)|apiKey|accessToken|refreshToken|sessionToken|privateKey/i;
const SENSITIVE_VALUE_PATTERN = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|authorization:\s*bearer\s+|bearer\s+[a-z0-9._-]{8,}|sk-[a-z0-9_-]{8,})/i;
// PAN-shaped: a run of 13–19 digits (optionally space/dash separated). Rejects raw card numbers.
const PAN_PATTERN = /\b(?:\d[ -]?){13,19}\b/;
// Explicit settlement/custody claim markers. AP2 carries no settlement finality, so any
// mandate asserting one is rejected into the `unsupported_live_ap2_settlement` state.
const SETTLEMENT_CLAIM_MARKERS = [
    '"settled":true',
    '"final":true',
    '"finalized":true',
    'settlement finality',
    'final settlement',
    'onchain_transfer',
    'onchain transfer completed',
    'payment settled',
    'settlement proven',
];
const CUSTODY_CLAIM_MARKERS = [
    '"custody":true',
    'takes custody',
    'funds in custody',
    'held in custody',
    'custody accepted',
    'escrowed',
];
/**
 * AP2 currency -> RAP fixture rail mapping.
 * (DRAFT/unverified — AP2, confirm currency codes.) Only AUDD/USDC/SOL fixture rails
 * are mapped; anything else fails closed as an unsupported rail.
 */
const AP2_CURRENCY_TO_RAP_ASSET = {
    USDC: 'USDC',
    AUDD: 'AUDD',
    SOL: 'SOL',
};
const FINALIZED_MANDATE_TYPES = ['cart', 'payment', 'checkout_closed', 'payment_closed'];
/**
 * Ingest a static AP2 mandate fixture into buyer-authority constraints.
 *
 * Pure function: no network, no wallet, no RPC, no live VDC verification. The VDC
 * signature is treated as opaque. Fails closed on credentials/PAN, settlement/custody
 * claims, expiry, over-cap, and unsupported rails.
 */
export function ingestAp2Mandate(mandate, now) {
    if (!isStructuredMandate(mandate)) {
        return failClosed(mandate, 'ap2_mandate_probe_only', ['mandate_malformed'], [
            'Denied: AP2 mandate fixture is malformed.',
        ]);
    }
    const stripped = stripSignature(mandate);
    const reasonCodes = [];
    const auditNotes = [];
    if (mandateContainsCredentialMaterial(stripped)) {
        reasonCodes.push('mandate_contains_credentials');
        auditNotes.push('Denied: AP2 mandate contains credential-, key-, or PAN-shaped material.');
    }
    if (serializedContainsMarker(stripped, SETTLEMENT_CLAIM_MARKERS)) {
        reasonCodes.push('settlement_finality_claim_rejected');
        auditNotes.push('Denied: AP2 is a trust/authorization layer; settlement-finality claims are rejected.');
    }
    if (serializedContainsMarker(stripped, CUSTODY_CLAIM_MARKERS)) {
        reasonCodes.push('custody_claim_rejected');
        auditNotes.push('Denied: AP2 mandate must not claim custody of funds.');
    }
    if (reasonCodes.length > 0) {
        return failClosed(mandate, 'unsupported_live_ap2_settlement', reasonCodes, auditNotes);
    }
    const finalized = FINALIZED_MANDATE_TYPES.includes(mandate.mandateType);
    const hasCart = !!mandate.cart && Array.isArray(mandate.cart.items) && mandate.cart.items.length > 0;
    // Open/intent (or cart-less) mandates are probe-only: usable for preflight/planning and
    // parser tests, but they cannot authorize a specific spend.
    if (!finalized || !hasCart) {
        return {
            schemaVersion: AP2_MANDATE_INGESTION_SCHEMA_VERSION,
            draft: true,
            supportState: 'ap2_mandate_probe_only',
            mandateRef: buildMandateRef(mandate, 'ap2_mandate_probe_only'),
            derived: null,
            reasonCodes: ['probe_only_no_cart_binding'],
            auditNotes: ['AP2 open/intent (or cart-less) mandate is probe-only; it cannot authorize a specific spend.'],
            guardrails: AP2_MANDATE_INGESTION_GUARDRAILS,
        };
    }
    // Finalized authorization path — fail-closed checks.
    if (isExpired(mandate.expiresAt, now)) {
        reasonCodes.push('mandate_expired');
        auditNotes.push('Denied: AP2 mandate has expired.');
    }
    const currency = mapCurrency(mandate);
    if (currency === null) {
        reasonCodes.push('unsupported_currency_rail');
        auditNotes.push('Denied: AP2 mandate currency does not map to a supported RAP fixture rail (AUDD/USDC/SOL).');
    }
    if (mandateOverCap(mandate)) {
        reasonCodes.push('mandate_over_cap');
        auditNotes.push('Denied: AP2 mandate payment amount exceeds its own declared budget cap.');
    }
    if (reasonCodes.length > 0 || currency === null) {
        return failClosed(mandate, 'ap2_mandate_probe_only', reasonCodes, auditNotes);
    }
    return {
        schemaVersion: AP2_MANDATE_INGESTION_SCHEMA_VERSION,
        draft: true,
        supportState: 'ap2_mandate_fixture',
        mandateRef: buildMandateRef(mandate, 'ap2_mandate_fixture'),
        derived: deriveConstraints(mandate, currency),
        reasonCodes: ['ap2_mandate_ingested'],
        auditNotes: [
            'AP2 mandate ingested as fixture-asserted buyer-authority constraints.',
            'VDC signature treated as opaque (not verified live); no settlement-finality claim.',
        ],
        guardrails: AP2_MANDATE_INGESTION_GUARDRAILS,
    };
}
/**
 * Bind a mandate reference onto a receipt WITHOUT any settlement claim.
 * Sets `receipt.metadata.ap2MandateRef` to hash + type + support-state only.
 */
export function bindMandateToReceipt(receipt, ref) {
    const binding = {
        draft: true,
        mandateType: ref.mandateType,
        mandateHash: ref.mandateHash,
        supportState: ref.supportState,
        humanPresent: ref.humanPresent,
        vdcVerification: 'fixture-asserted',
        settlementFinalityClaimed: false,
    };
    return {
        ...receipt,
        metadata: {
            ...(receipt.metadata ?? {}),
            ap2MandateRef: binding,
        },
    };
}
function deriveConstraints(mandate, currency) {
    const maxAmountUnits = mandate.payment?.budgetCap
        ?? mandate.payment?.amount
        ?? mandate.cart?.total.amount
        ?? '0';
    const sellerIds = mandate.merchant?.id ? [`ap2-merchant:${mandate.merchant.id}`] : [];
    const endpointIds = mandate.merchant?.id ? [`ap2-merchant-endpoint:${mandate.merchant.id}`] : [];
    return {
        allowedCurrencies: [currency],
        spendCaps: [
            {
                asset: currency,
                // (DRAFT/unverified — AP2) illustrative rail label; AP2 is not a settlement network.
                network: 'ap2-authorization-fixture',
                maxAmountUnits,
                window: 'per_request',
            },
        ],
        sellerAllowlistAdditions: { sellerIds, endpointIds },
        expiresAt: mandate.expiresAt,
        operatorApprovalRequired: mandate.humanPresent === false,
    };
}
function buildMandateRef(mandate, supportState) {
    return {
        schemaVersion: AP2_MANDATE_INGESTION_SCHEMA_VERSION,
        draft: true,
        mandateType: mandate.mandateType,
        mandateHash: hashMandate(mandate),
        supportState,
        humanPresent: mandate.humanPresent,
        vdcVerification: 'fixture-asserted',
        settlementFinalityClaimed: false,
    };
}
function failClosed(mandate, supportState, reasonCodes, auditNotes) {
    const mandateType = isStructuredMandate(mandate) ? mandate.mandateType : 'intent';
    return {
        schemaVersion: AP2_MANDATE_INGESTION_SCHEMA_VERSION,
        draft: true,
        supportState,
        mandateRef: {
            schemaVersion: AP2_MANDATE_INGESTION_SCHEMA_VERSION,
            draft: true,
            mandateType,
            mandateHash: hashMandate(mandate),
            supportState,
            humanPresent: isStructuredMandate(mandate) ? mandate.humanPresent : undefined,
            vdcVerification: 'fixture-asserted',
            settlementFinalityClaimed: false,
        },
        derived: null,
        reasonCodes,
        auditNotes,
        guardrails: AP2_MANDATE_INGESTION_GUARDRAILS,
    };
}
function isStructuredMandate(value) {
    if (!isRecord(value))
        return false;
    const candidate = value;
    const validType = typeof candidate.mandateType === 'string'
        && [
            'intent', 'cart', 'payment',
            'checkout_open', 'checkout_closed', 'payment_open', 'payment_closed',
        ].includes(candidate.mandateType);
    const vdc = candidate.vdc;
    const validVdc = isRecord(vdc)
        && typeof vdc.signatureB64 === 'string'
        && vdc.verification === 'fixture-asserted';
    return validType && validVdc;
}
function stripSignature(mandate) {
    const clone = structuredClone(mandate);
    if (isRecord(clone.vdc)) {
        const vdc = clone.vdc;
        delete vdc.signatureB64;
    }
    return clone;
}
function hashMandate(mandate) {
    const source = isStructuredMandate(mandate) ? stripSignature(mandate) : mandate;
    return `sha256:${createHash('sha256').update(canonicalize(source)).digest('hex')}`;
}
function canonicalize(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value))
        return `[${value.map(canonicalize).join(',')}]`;
    const entries = Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${canonicalize(nested)}`).join(',')}}`;
}
function mandateContainsCredentialMaterial(value) {
    if (typeof value === 'string') {
        return SENSITIVE_VALUE_PATTERN.test(value) || PAN_PATTERN.test(value);
    }
    if (!value || typeof value !== 'object')
        return false;
    if (Array.isArray(value))
        return value.some(mandateContainsCredentialMaterial);
    return Object.entries(value).some(([key, nested]) => (SENSITIVE_KEY_PATTERN.test(key) || mandateContainsCredentialMaterial(nested)));
}
function serializedContainsMarker(value, markers) {
    const serialized = JSON.stringify(value).toLowerCase();
    return markers.some((marker) => serialized.includes(marker));
}
function mapCurrency(mandate) {
    const currency = mandate.payment?.currency ?? mandate.cart?.total.currency;
    if (typeof currency !== 'string')
        return null;
    return AP2_CURRENCY_TO_RAP_ASSET[currency.trim().toUpperCase()] ?? null;
}
function mandateOverCap(mandate) {
    const cap = mandate.payment?.budgetCap;
    if (typeof cap !== 'string')
        return false;
    const amount = mandate.payment?.amount ?? mandate.cart?.total.amount;
    if (typeof amount !== 'string')
        return false;
    const capValue = parseAmount(cap);
    const amountValue = parseAmount(amount);
    if (capValue === null || amountValue === null)
        return true; // unparseable -> fail closed
    return amountValue > capValue;
}
function isExpired(expiresAt, now) {
    if (typeof expiresAt !== 'string')
        return false;
    const expiry = Date.parse(expiresAt);
    const nowMs = Date.parse(now);
    if (Number.isNaN(expiry) || Number.isNaN(nowMs))
        return true;
    return nowMs > expiry;
}
function parseAmount(value) {
    if (!/^\d+(\.\d+)?$/.test(value.trim()))
        return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
export const AP2_RAIL_SUPPORT_STATE_MATRIX = [
    {
        rail: 'google-ap2',
        standard: 'Google AP2 (Agent Payments Protocol)',
        supportState: 'ap2_mandate_fixture',
        mandateTypes: ['cart', 'payment', 'checkout_closed', 'payment_closed'],
        description: 'Finalized Checkout/Cart + Payment mandate present; VDC signature treated as fixture-asserted (opaque, not verified live); buyer-authority constraints derivable; no settlement claim.',
        draft: true,
        confidence: 'low',
        governanceNote: '(DRAFT/unverified — FIDO/Visa/Mastercard) AP2 + Mastercard Verifiable Intent reportedly contributed to FIDO (~2026-05); Visa TAP and Mastercard Agent Pay are distinct downstream rails, NOT the mandate format. Confirm before relying.',
        claimBoundary: [
            'AP2 is a trust/authorization layer, not a settlement rail.',
            'RAP claims no settlement finality, custody, or live payment from an AP2 mandate.',
            'The VDC signature is opaque and is not verified against any live key.',
        ],
    },
    {
        rail: 'google-ap2',
        standard: 'Google AP2 (Agent Payments Protocol)',
        supportState: 'ap2_mandate_probe_only',
        mandateTypes: ['intent', 'checkout_open', 'payment_open'],
        description: 'Only an Open/Intent mandate (constraints, no finalized cart) — usable for preflight/planning and parser tests, not for authorizing a specific spend.',
        draft: true,
        confidence: 'low',
        governanceNote: '(DRAFT/unverified — AP2) Open/Closed staging read from ap2-protocol.org (medium confidence on the v0.2 rename).',
        claimBoundary: [
            'Probe-only mandates derive no spend authorization.',
            'No settlement, custody, or live payment is implied.',
        ],
    },
    {
        rail: 'google-ap2',
        standard: 'Google AP2 (Agent Payments Protocol)',
        supportState: 'unsupported_live_ap2_settlement',
        mandateTypes: ['cart', 'payment', 'checkout_closed', 'payment_closed'],
        description: 'Any mandate asserting completed settlement, custody, or finality is rejected. A future live lane must first define live VDC signature verification, wallet custody, spend limits, replay handling, operator approval, and rollback.',
        draft: true,
        confidence: 'low',
        governanceNote: '(DRAFT/unverified — AP2/FIDO) live AP2 settlement is out of scope; no live VDC verification exists in this adapter.',
        claimBoundary: [
            'Live AP2 settlement is unsupported in this fixture corpus.',
            'Settlement-finality and custody claims fail closed.',
        ],
    },
];
// ---------------------------------------------------------------------------
// Illustrative fixtures (static, no I/O). DRAFT/unverified AP2 shapes.
// ---------------------------------------------------------------------------
const BASE_VDC = {
    alg: 'ES256',
    signatureB64: 'Zml4dHVyZS1hc3NlcnRlZC1vcGFxdWUtdmRjLXNpZ25hdHVyZS1ub3QtdmVyaWZpZWQ',
    verification: 'fixture-asserted',
};
const checkoutClosedPaymentClosedValid = {
    mandateType: 'payment_closed',
    humanPresent: true,
    merchant: { id: 'seller:listing-writer', name: 'Listing Writer' },
    cart: {
        items: [{ sku: 'listing-writeup', name: 'Property listing write-up', amount: '25.00' }],
        total: { amount: '25.00', currency: 'USDC' },
        cartHash: 'ap2-cart-hash:listing-writeup-fixture',
    },
    payment: {
        amount: '25.00',
        currency: 'USDC',
        allowedInstruments: ['stablecoin'],
        budgetCap: '50.00',
    },
    expiresAt: '2027-01-01T00:00:00.000Z',
    vdc: BASE_VDC,
};
const paymentOpenProbeOnly = {
    mandateType: 'payment_open',
    humanPresent: true,
    merchant: { id: 'seller:listing-writer' },
    payment: {
        amount: '25.00',
        currency: 'USDC',
        allowedInstruments: ['stablecoin', 'card'],
        budgetCap: '50.00',
    },
    expiresAt: '2027-01-01T00:00:00.000Z',
    vdc: BASE_VDC,
};
const expiredMandate = {
    ...checkoutClosedPaymentClosedValid,
    expiresAt: '2026-06-01T00:00:00.000Z',
};
const humanNotPresent = {
    ...checkoutClosedPaymentClosedValid,
    humanPresent: false,
};
const overBudgetMandate = {
    ...checkoutClosedPaymentClosedValid,
    cart: {
        items: [{ sku: 'listing-writeup', name: 'Property listing write-up', amount: '75.00' }],
        total: { amount: '75.00', currency: 'USDC' },
        cartHash: 'ap2-cart-hash:over-budget-fixture',
    },
    payment: {
        amount: '75.00',
        currency: 'USDC',
        allowedInstruments: ['stablecoin'],
        budgetCap: '50.00',
    },
};
const railMismatchMandate = {
    ...checkoutClosedPaymentClosedValid,
    cart: {
        items: [{ sku: 'listing-writeup', name: 'Property listing write-up', amount: '25.00' }],
        total: { amount: '25.00', currency: 'EUR' },
        cartHash: 'ap2-cart-hash:rail-mismatch-fixture',
    },
    payment: {
        amount: '25.00',
        currency: 'EUR',
        allowedInstruments: ['card'],
        budgetCap: '50.00',
    },
};
// PAN embedded in an otherwise ordinary cart item name -> must fail closed.
const panLeakMandate = {
    ...checkoutClosedPaymentClosedValid,
    cart: {
        items: [{ sku: 'listing-writeup', name: 'card on file 4111111111111111', amount: '25.00' }],
        total: { amount: '25.00', currency: 'USDC' },
        cartHash: 'ap2-cart-hash:pan-leak-fixture',
    },
};
// Mandate asserting settlement finality via an out-of-schema `settled` flag -> rejected.
const settlementClaimMandate = {
    ...checkoutClosedPaymentClosedValid,
    settled: true,
};
export const ap2MandateFixtures = {
    checkoutClosedPaymentClosedValid,
    paymentOpenProbeOnly,
    expiredMandate,
    humanNotPresent,
    overBudgetMandate,
    railMismatchMandate,
    panLeakMandate,
    settlementClaimMandate,
};
export function listAp2MandateFixtures() {
    return Object.entries(ap2MandateFixtures).map(([key, mandate]) => ({
        key,
        mandate: structuredClone(mandate),
    }));
}
