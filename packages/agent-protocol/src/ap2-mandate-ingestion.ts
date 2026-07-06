import { createHash } from 'node:crypto';

import {
  validateBuyerAuthorityPolicy,
  type BuyerAuthorityAsset,
  type BuyerAuthorityPolicy,
  type BuyerAuthoritySpendCap,
} from './buyer-authority-policy.js';
import { validateReddiReceipt, type ReddiReceipt } from './receipts.js';

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
export const AP2_MANDATE_INGESTION_SCHEMA_VERSION = 'reddi.ap2-mandate-ingestion.v1' as const;

/**
 * Promoted by #563: the RAP-side adapter contract is no longer a draft.
 * External AP2 field-shape uncertainty is tracked separately and honestly via
 * `AP2_EXTERNAL_STANDARD.fieldShapesVerified: false` on every result —
 * promotion of the RAP contract does NOT fake confidence in the external draft.
 */
export const AP2_MANDATE_INGESTION_DRAFT = false as const;

/**
 * External-standard provenance block carried on every ingestion/composition
 * result. AP2 field shapes are unverified; the signature model is
 * fixture-asserted only; AP2 is not a settlement rail and RAP claims none.
 */
export const AP2_EXTERNAL_STANDARD = {
  name: 'Google AP2 (Agent Payments Protocol)',
  status: 'external-draft-standard',
  fieldShapesVerified: false,
  signatureVerification: 'fixture-asserted',
  /** (DRAFT/unverified — FIDO/Visa/Mastercard) governance lineage unconfirmed. */
  governanceLineageVerified: false,
  settlementRail: false,
} as const;

export type Ap2ExternalStandard = typeof AP2_EXTERNAL_STANDARD;

/**
 * AP2 mandate vocabulary.
 * (DRAFT/unverified — AP2, confirm mandate-type names/shape.)
 * - `intent | cart | payment` are the Sept-2025 launch vocabulary.
 * - `checkout_open | checkout_closed | payment_open | payment_closed` are the v0.2
 *   Open/Closed staging read from ap2-protocol.org (medium confidence on the rename).
 */
export type Ap2MandateType =
  | 'intent'
  | 'cart'
  | 'payment'
  | 'checkout_open'
  | 'checkout_closed'
  | 'payment_open'
  | 'payment_closed';

const AP2_MANDATE_TYPE_VOCABULARY: readonly Ap2MandateType[] = [
  'intent', 'cart', 'payment',
  'checkout_open', 'checkout_closed', 'payment_open', 'payment_closed',
];

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
  merchant?: { id: string; name?: string };
  /** (DRAFT/unverified — AP2) finalized cart (present only for cart/closed mandates). */
  cart?: {
    items: Array<{ sku?: string; name?: string; amount: string }>;
    total: { amount: string; currency: string };
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
export type Ap2SupportState =
  | 'ap2_mandate_fixture'
  | 'ap2_mandate_probe_only'
  | 'unsupported_live_ap2_settlement';

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
  sellerAllowlistAdditions: { sellerIds: string[]; endpointIds: string[] };
  expiresAt?: string;
  operatorApprovalRequired: boolean;
};

export type Ap2IngestReasonCode =
  | 'ap2_mandate_ingested'
  | 'mandate_malformed'
  | 'unsupported_mandate_type'
  | 'mandate_contains_credentials'
  | 'signature_material_rejected'
  | 'settlement_finality_claim_rejected'
  | 'custody_claim_rejected'
  | 'unsupported_currency_rail'
  | 'probe_only_no_cart_binding'
  | 'mandate_expired'
  | 'mandate_over_cap';

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

export const AP2_MANDATE_INGESTION_GUARDRAILS: Ap2MandateIngestionGuardrails = {
  fixtureOnly: true,
  vdcSignatureVerifiedLive: false,
  keyMaterialHeld: false,
  livePaymentExecuted: false,
  walletSigning: false,
  rpcCall: false,
  custodyClaim: false,
  settlementFinalityClaim: false,
};

/** Illustrative default `now` for fixtures (fixture-only, no wall-clock dependency). */
export const AP2_MANDATE_INGESTION_FIXTURE_NOW = '2026-07-05T00:00:00.000Z' as const;

/**
 * Machine-readable per-field provenance for the AP2 → buyer-authority mapping
 * (#563, mirrors the ERC-8004 export convention). `rap-native` fields are
 * adapter-defined; `ap2-draft-interface` marks the AP2-side field NAME as an
 * unverified reference to the external draft standard. `lossy` documents any
 * information loss or conservative narrowing in the projection.
 */
export const AP2_MANDATE_FIELD_PROVENANCE: ReadonlyArray<{
  target: string;
  source: string;
  confidence: 'rap-native' | 'ap2-draft-interface';
  lossy?: string;
}> = [
  { target: 'derived.allowedCurrencies[0]', source: 'ap2 $.payment.currency, fallback $.cart.total.currency', confidence: 'ap2-draft-interface', lossy: 'only AUDD/USDC/SOL fixture rails map; any other currency fails closed (unsupported_currency_rail)' },
  { target: 'derived.spendCaps[0].maxAmountUnits', source: 'ap2 $.payment.budgetCap, fallback $.payment.amount, then $.cart.total.amount', confidence: 'ap2-draft-interface', lossy: 'decimal AP2 fixture amounts (≤2 decimals) are normalized losslessly into integer ap2-fixture-centiunits so the BigInt-based buyer-authority gate can compare them; higher precision fails closed; NEVER converted across rails (see AP2_UNSUPPORTED_FIELDS)' },
  { target: 'derived.spendCaps[0].network', source: "adapter constant 'ap2-authorization-fixture'", confidence: 'rap-native', lossy: 'AP2 is an authorization layer, not a settlement network; the lane label is RAP-internal' },
  { target: 'derived.spendCaps[0].window', source: "adapter constant 'per_request'", confidence: 'rap-native' },
  { target: 'derived.sellerAllowlistAdditions.sellerIds[0]', source: "ap2 $.merchant.id, namespaced 'ap2-merchant:'", confidence: 'ap2-draft-interface', lossy: 'namespaced opaque ref; never a raw endpoint URL; only ever INTERSECTED with the local allowlist' },
  { target: 'derived.sellerAllowlistAdditions.endpointIds[0]', source: "ap2 $.merchant.id, namespaced 'ap2-merchant-endpoint:'", confidence: 'ap2-draft-interface', lossy: 'same intersection-only semantics' },
  { target: 'derived.expiresAt', source: 'ap2 $.expiresAt', confidence: 'ap2-draft-interface', lossy: 'composition takes the EARLIER of mandate and local expiry' },
  { target: 'derived.operatorApprovalRequired', source: 'ap2 $.humanPresent === false', confidence: 'ap2-draft-interface', lossy: 'human-not-present semantics unverified; treated conservatively as requiring operator approval, and composition can only escalate approval, never clear it' },
  { target: 'mandateRef.mandateType', source: 'ap2 $.mandateType', confidence: 'ap2-draft-interface' },
  { target: 'mandateRef.mandateHash', source: 'sha256 over the canonicalized mandate with $.vdc.signatureB64 removed', confidence: 'rap-native', lossy: 'one-way digest; mandate contents and signature are never reconstructable from the ref' },
  { target: 'mandateRef.humanPresent', source: 'ap2 $.humanPresent', confidence: 'ap2-draft-interface' },
  { target: 'mandateRef.vdcVerification', source: "adapter constant 'fixture-asserted'", confidence: 'rap-native' },
  { target: 'mandateRef.settlementFinalityClaimed', source: 'adapter constant false (literal type)', confidence: 'rap-native' },
];

/**
 * AP2 surface RAP cannot (or deliberately will not) handle — documented
 * fail-closed (#563). `behavior` is what this adapter does about each gap.
 */
export const AP2_UNSUPPORTED_FIELDS: ReadonlyArray<{
  surface: string;
  behavior: 'blocked' | 'omitted' | 'excluded';
  reason: string;
}> = [
  { surface: 'Live VDC signature verification (JWT / SD-JWT / LD-Proof envelope)', behavior: 'blocked', reason: 'no cryptographic verification exists in this adapter; the VDC signature is opaque and fixture-asserted (vdcSignatureVerifiedLive: false on every result), and the envelope format itself is unverified upstream' },
  { surface: 'FIDO / Visa TAP / Mastercard Agent Pay key or attestation material', behavior: 'blocked', reason: 'RAP never holds scheme key material; signature- or key-shaped material outside the single opaque vdc.signatureB64 slot fails closed (signature_material_rejected), and guardrails assert keyMaterialHeld: false' },
  { surface: 'Card instruments / PANs / tokenized payment methods', behavior: 'blocked', reason: 'allowedInstruments stays category labels only; PAN-shaped values fail closed (mandate_contains_credentials); card execution is a downstream scheme rail, not RAP scope' },
  { surface: 'Settlement finality / custody / live payment execution', behavior: 'blocked', reason: 'AP2 is a trust/authorization layer; settlement-finality and custody claims fail closed into unsupported_live_ap2_settlement, and settlementFinalityClaimed is the literal false on every ref and binding' },
  { surface: 'Cross-unit amount conversion (AP2 decimal amounts vs RAP minor units)', behavior: 'omitted', reason: 'AP2 amount unit semantics are unverified; decimal fixture amounts normalize only WITHIN the ap2-authorization-fixture lane (to integer centi-units, ≤2 decimals, lossless), composition compares caps only inside that lane, and units are never converted across rails' },
  { surface: 'Mandate lifecycle (revocation, supersession, refunds, disputes)', behavior: 'omitted', reason: 'one-shot ingestion of a static fixture; revocable-authorization lifecycle semantics route to rail-neutrality epic #338' },
  { surface: 'Widening local authority from a mandate', behavior: 'blocked', reason: 'composition INTERSECTS: mandate currency and merchant must already be permitted locally (else blocked), caps take the local value when the mandate is wider, expiry takes the earlier bound, and operator approval can only escalate' },
  { surface: 'Mandate contents / cart items / mandate terms on receipts', behavior: 'omitted', reason: 'receipts carry hash + type + support-state only; contents and signature material never bind (signature-bearing refs fail closed)' },
  { surface: 'Open/intent mandates as spend authorization', behavior: 'excluded', reason: 'cart-less/open mandates are probe-only: usable for preflight and parser tests, but they derive no constraints, never compose, and never bind to a receipt' },
];

// Reuse the receipts.ts sensitive-key/value patterns (which deliberately do NOT flag
// an expected opaque `signature` field). The VDC signature is stripped before scanning.
const SENSITIVE_KEY_PATTERN = /(^|[_-])(api[_-]?key|authorization|bearer|cookie|credential|mnemonic|password|private[_-]?key|refresh[_-]?token|secret|seed|session[_-]?token|token)([_-]|$)|apiKey|accessToken|refreshToken|sessionToken|privateKey/i;
const SENSITIVE_VALUE_PATTERN = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|authorization:\s*bearer\s+|bearer\s+[a-z0-9._-]{8,}|sk-[a-z0-9_-]{8,})/i;
// PAN-shaped: a run of 13–19 digits (optionally space/dash separated). Rejects raw card numbers.
const PAN_PATTERN = /\b(?:\d[ -]?){13,19}\b/;

// Signature/key material outside the single opaque vdc.signatureB64 slot. RAP does
// no key handling: any FIDO/Visa/Mastercard signature-, JWS-, or proof-shaped field
// elsewhere in a mandate (or in a mandate ref) fails closed.
const SIGNATURE_KEY_PATTERN = /(^|[_-])(sig|jws|jwk|jwt|sd[_-]?jwt)([_-]|$)|signature|proofValue|signedPayload|attestationObject/i;
// JWS/JWT compact serialization shape (three base64url segments).
const SIGNATURE_VALUE_PATTERN = /\bey[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/;

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
const AP2_CURRENCY_TO_RAP_ASSET: Record<string, BuyerAuthorityAsset> = {
  USDC: 'USDC',
  AUDD: 'AUDD',
  SOL: 'SOL',
};

/** RAP-internal lane label for AP2-derived constraints. AP2 is not a settlement network. */
export const AP2_AUTHORIZATION_NETWORK = 'ap2-authorization-fixture' as const;

const FINALIZED_MANDATE_TYPES: Ap2MandateType[] = ['cart', 'payment', 'checkout_closed', 'payment_closed'];

/**
 * Ingest a static AP2 mandate fixture into buyer-authority constraints.
 *
 * Pure function: no network, no wallet, no RPC, no live VDC verification, no key
 * handling. The VDC signature is treated as opaque. Fails closed on credentials/PAN,
 * stray signature material, settlement/custody claims, unsupported mandate types,
 * expiry, over-cap, and unsupported rails.
 */
export function ingestAp2Mandate(mandate: Ap2MandateFixture, now: string): Ap2MandateIngestionResult {
  if (!hasVdcEnvelope(mandate)) {
    return failClosed(mandate, 'ap2_mandate_probe_only', ['mandate_malformed'], [
      'Denied: AP2 mandate fixture is malformed.',
    ]);
  }
  if (!isStructuredMandate(mandate)) {
    // Valid envelope, unknown mandate-type vocabulary — a distinct fail-closed lane
    // so an unrecognized (possibly newer) mandate stage is never silently coerced.
    const rawType = String((mandate as Record<string, unknown>).mandateType);
    return failClosed(mandate, 'ap2_mandate_probe_only', ['unsupported_mandate_type'], [
      `Denied: AP2 mandate type '${rawType}' is outside the supported vocabulary; unrecognized mandate stages never authorize.`,
    ]);
  }

  const stripped = stripSignature(mandate);

  const reasonCodes: Ap2IngestReasonCode[] = [];
  const auditNotes: string[] = [];

  if (mandateContainsCredentialMaterial(stripped)) {
    reasonCodes.push('mandate_contains_credentials');
    auditNotes.push('Denied: AP2 mandate contains credential-, key-, or PAN-shaped material.');
  }
  if (containsSignatureMaterial(stripped)) {
    reasonCodes.push('signature_material_rejected');
    auditNotes.push('Denied: signature/key material outside the opaque vdc.signatureB64 slot; RAP does no key handling and holds no Visa/Mastercard/FIDO material.');
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
      draft: false,
      externalStandard: AP2_EXTERNAL_STANDARD,
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

  // Normalize the cap into the shared fixture unit space (integer centi-units) so
  // the BigInt-based buyer-authority gate can enforce it. Higher precision than the
  // fixture unit space supports fails closed — no silent rounding.
  const rawCapUnits = mandate.payment?.budgetCap ?? mandate.payment?.amount ?? mandate.cart?.total.amount ?? '0';
  const capCentiUnits = ap2FixtureCentiUnits(rawCapUnits);
  if (capCentiUnits === null) {
    reasonCodes.push('mandate_malformed');
    auditNotes.push('Denied: mandate amount precision is unsupported in the fixture unit space (max 2 decimals).');
  }

  if (reasonCodes.length > 0 || currency === null || capCentiUnits === null) {
    return failClosed(mandate, 'ap2_mandate_probe_only', reasonCodes, auditNotes);
  }

  return {
    schemaVersion: AP2_MANDATE_INGESTION_SCHEMA_VERSION,
    draft: false,
    externalStandard: AP2_EXTERNAL_STANDARD,
    supportState: 'ap2_mandate_fixture',
    mandateRef: buildMandateRef(mandate, 'ap2_mandate_fixture'),
    derived: deriveConstraints(mandate, currency, capCentiUnits),
    reasonCodes: ['ap2_mandate_ingested'],
    auditNotes: [
      'AP2 mandate ingested as fixture-asserted buyer-authority constraints.',
      'VDC signature treated as opaque (not verified live); no settlement-finality claim.',
      'Constraints only take effect through composition with a local buyer-authority policy, which they can narrow but never widen.',
    ],
    guardrails: AP2_MANDATE_INGESTION_GUARDRAILS,
  };
}

// ---------------------------------------------------------------------------
// Policy-gate composition (#563): local buyer authority is the ceiling.
// ---------------------------------------------------------------------------

export type Ap2CompositionReasonCode =
  | 'ap2_composition_ok'
  | 'local_policy_invalid'
  | 'mandate_not_authorizing'
  | 'mandate_currency_not_permitted_locally'
  | 'mandate_merchant_not_allowlisted_locally'
  | 'local_cap_missing_for_mandate_currency'
  | 'mandate_cap_wider_than_local_cap'
  | 'mandate_expiry_later_than_local'
  | 'operator_approval_escalated'
  | 'composed_policy_invalid';

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
export function composeAp2MandateWithLocalPolicy(
  localPolicy: unknown,
  ingestion: Ap2MandateIngestionResult,
): Ap2PolicyComposition {
  const reasonCodes: Ap2CompositionReasonCode[] = [];
  const auditNotes: string[] = [];

  const blocked = (): Ap2PolicyComposition => ({
    schemaVersion: AP2_MANDATE_INGESTION_SCHEMA_VERSION,
    draft: false,
    externalStandard: AP2_EXTERNAL_STANDARD,
    ok: false,
    composedPolicy: null,
    mandateRef: ingestion?.mandateRef ?? null,
    reasonCodes: dedupeComposition(reasonCodes),
    auditNotes,
    guardrails: AP2_MANDATE_INGESTION_GUARDRAILS,
  });

  const localValidation = validateBuyerAuthorityPolicy(localPolicy);
  if (!localValidation.allowed) {
    reasonCodes.push('local_policy_invalid');
    auditNotes.push('Blocked: local buyer-authority policy failed validation; nothing composes.');
    return blocked();
  }
  const local = localPolicy as BuyerAuthorityPolicy;

  if (ingestion?.supportState !== 'ap2_mandate_fixture' || ingestion.derived === null) {
    reasonCodes.push('mandate_not_authorizing');
    auditNotes.push('Blocked: the mandate did not ingest as an authorizing fixture (probe-only or rejected mandates never compose).');
    return blocked();
  }
  const derived = ingestion.derived;
  const currency = derived.allowedCurrencies[0];

  if (currency === undefined || !local.allowedCurrencies.includes(currency)) {
    reasonCodes.push('mandate_currency_not_permitted_locally');
    auditNotes.push('Blocked: the mandate currency is not permitted by the local policy; a mandate never widens local authority.');
    return blocked();
  }

  const sellerIds = derived.sellerAllowlistAdditions.sellerIds;
  const endpointIds = derived.sellerAllowlistAdditions.endpointIds;
  const merchantAllowlisted = sellerIds.length > 0
    && endpointIds.length > 0
    && sellerIds.every((id) => local.sellerAllowlist.sellerIds.includes(id))
    && endpointIds.every((id) => local.sellerAllowlist.endpointIds.includes(id));
  if (!merchantAllowlisted) {
    reasonCodes.push('mandate_merchant_not_allowlisted_locally');
    auditNotes.push('Blocked: the mandate merchant is not in the local seller allowlist; a mandate never widens local authority.');
    return blocked();
  }

  const localCap = local.spendCaps.find((cap) => (
    cap.asset === currency && cap.network === AP2_AUTHORIZATION_NETWORK && cap.window === 'per_request'
  ));
  if (localCap === undefined) {
    reasonCodes.push('local_cap_missing_for_mandate_currency');
    auditNotes.push(`Blocked: the local policy carries no per-request ${currency} cap on the ${AP2_AUTHORIZATION_NETWORK} lane; a missing local cap never becomes unlimited authority.`);
    return blocked();
  }

  // Both caps live in the ap2-authorization-fixture lane's integer centi-unit
  // space, so BigInt comparison is legitimate. Local wins: unparseable or wider
  // mandate caps fall back to the local cap.
  const mandateCapRaw = derived.spendCaps[0]?.maxAmountUnits;
  const comparison = typeof mandateCapRaw === 'string' ? compareUnits(mandateCapRaw, localCap.maxAmountUnits) : null;
  let composedCapUnits = localCap.maxAmountUnits;
  if (comparison !== null && comparison < 0) {
    composedCapUnits = mandateCapRaw as string;
    auditNotes.push('Composed cap tightened to the mandate cap (below the local ceiling).');
  } else if (comparison === null || comparison > 0) {
    reasonCodes.push('mandate_cap_wider_than_local_cap');
    auditNotes.push('Mandate cap is wider than (or incomparable with) the local cap; the local cap wins — a mandate never widens local authority.');
  }

  // Expiry: earlier bound wins.
  let composedExpiresAt = local.expiresAt;
  const localExpiryMs = Date.parse(local.expiresAt);
  const mandateExpiryMs = typeof derived.expiresAt === 'string' ? Date.parse(derived.expiresAt) : Number.NaN;
  if (!Number.isNaN(localExpiryMs) && !Number.isNaN(mandateExpiryMs) && mandateExpiryMs < localExpiryMs) {
    composedExpiresAt = derived.expiresAt as string;
    auditNotes.push('Composed expiry tightened to the mandate expiry (before the local expiry).');
  } else if (Number.isNaN(mandateExpiryMs) || mandateExpiryMs > localExpiryMs) {
    reasonCodes.push('mandate_expiry_later_than_local');
    auditNotes.push('Mandate expiry is later than (or missing vs) the local expiry; the local expiry wins.');
  }

  // Operator approval: escalate-only.
  let composedApproval = structuredClone(local.operatorApproval) as BuyerAuthorityPolicy['operatorApproval'];
  if (derived.operatorApprovalRequired && !local.operatorApproval.required) {
    composedApproval = { ...composedApproval, required: true, approvalState: 'requires_operator_approval' };
    reasonCodes.push('operator_approval_escalated');
    auditNotes.push('Mandate was authorized human-not-present; operator approval escalated (approval never de-escalates).');
  }

  const composedPolicy: BuyerAuthorityPolicy = {
    ...structuredClone(local) as BuyerAuthorityPolicy,
    policyId: `${local.policyId}+ap2:${ingestion.mandateRef.mandateHash.slice(7, 15)}`,
    expiresAt: composedExpiresAt,
    allowedCurrencies: [currency],
    allowedRails: local.allowedRails.filter((rail) => rail.asset === currency),
    spendCaps: [{ ...localCap, maxAmountUnits: composedCapUnits }],
    sellerAllowlist: {
      sellerIds: [...sellerIds],
      endpointIds: [...endpointIds],
    },
    operatorApproval: composedApproval,
    notes: [
      ...local.notes,
      `Narrowed by AP2 mandate ${ingestion.mandateRef.mandateHash} (fixture-asserted; local buyer authority is the ceiling).`,
    ],
  };

  // Belt-and-suspenders: the composed policy must itself pass the local gate's
  // structural validation — otherwise the composition blocks.
  const composedValidation = validateBuyerAuthorityPolicy(composedPolicy);
  if (!composedValidation.allowed) {
    reasonCodes.push('composed_policy_invalid');
    auditNotes.push('Blocked: the composed policy failed buyer-authority validation.');
    return blocked();
  }

  return {
    schemaVersion: AP2_MANDATE_INGESTION_SCHEMA_VERSION,
    draft: false,
    externalStandard: AP2_EXTERNAL_STANDARD,
    ok: true,
    composedPolicy,
    mandateRef: ingestion.mandateRef,
    reasonCodes: dedupeComposition(['ap2_composition_ok', ...reasonCodes]),
    auditNotes: [
      ...auditNotes,
      'Composed policy is the intersection of local authority and mandate constraints; the mandate narrowed, never widened.',
    ],
    guardrails: AP2_MANDATE_INGESTION_GUARDRAILS,
  };
}

// ---------------------------------------------------------------------------
// Receipt binding (#563): non-secret authorization provenance, fail-closed.
// ---------------------------------------------------------------------------

export type Ap2BindingReasonCode =
  | 'ap2_mandate_ref_bound'
  | 'mandate_ref_malformed'
  | 'probe_only_ref_not_bindable'
  | 'rejected_mandate_ref_not_bindable'
  | 'signature_material_rejected'
  | 'receipt_invalid_after_binding';

export type Ap2ReceiptBindingResult = {
  ok: boolean;
  /** The receipt with `metadata.ap2MandateRef` set, or null when binding fails closed. */
  receipt: ReddiReceipt | null;
  reasonCodes: Ap2BindingReasonCode[];
  auditNotes: string[];
};

const MANDATE_REF_ALLOWED_KEYS = new Set([
  'schemaVersion',
  'draft',
  'mandateType',
  'mandateHash',
  'supportState',
  'humanPresent',
  'vdcVerification',
  'settlementFinalityClaimed',
]);

const MANDATE_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

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
export function bindMandateToReceipt(receipt: ReddiReceipt, ref: Ap2MandateRef): Ap2ReceiptBindingResult {
  const reasonCodes: Ap2BindingReasonCode[] = [];
  const auditNotes: string[] = [];

  if (!isBindableRefShape(ref)) {
    if (refCarriesSignatureMaterial(ref)) {
      reasonCodes.push('signature_material_rejected');
      auditNotes.push('Denied: mandate ref carries signature-shaped keys or values; receipts never carry signature material.');
    } else {
      reasonCodes.push('mandate_ref_malformed');
      auditNotes.push('Denied: mandate ref is malformed (unexpected keys, bad hash shape, or claim flags).');
    }
    return { ok: false, receipt: null, reasonCodes, auditNotes };
  }

  if (ref.supportState === 'ap2_mandate_probe_only') {
    reasonCodes.push('probe_only_ref_not_bindable');
    auditNotes.push('Denied: probe-only mandate refs never bind — a probe-only mandate authorized nothing.');
    return { ok: false, receipt: null, reasonCodes, auditNotes };
  }
  if (ref.supportState === 'unsupported_live_ap2_settlement') {
    reasonCodes.push('rejected_mandate_ref_not_bindable');
    auditNotes.push('Denied: a rejected mandate ref never binds to a receipt.');
    return { ok: false, receipt: null, reasonCodes, auditNotes };
  }

  const binding: Ap2ReceiptMandateBinding = {
    draft: false,
    mandateType: ref.mandateType,
    mandateHash: ref.mandateHash,
    supportState: ref.supportState,
    humanPresent: ref.humanPresent,
    vdcVerification: 'fixture-asserted',
    settlementFinalityClaimed: false,
  };
  const bound: ReddiReceipt = {
    ...receipt,
    metadata: {
      ...(receipt.metadata ?? {}),
      ap2MandateRef: binding,
    },
  };

  const validation = validateReddiReceipt(bound);
  if (!validation.ok) {
    reasonCodes.push('receipt_invalid_after_binding');
    auditNotes.push('Denied: the receipt failed reddi.receipt.v1 validation after binding; nothing is emitted.');
    return { ok: false, receipt: null, reasonCodes, auditNotes };
  }

  return {
    ok: true,
    receipt: bound,
    reasonCodes: ['ap2_mandate_ref_bound'],
    auditNotes: ['AP2 mandate ref bound as authorization provenance only (hash + type + support-state; no settlement claim).'],
  };
}

function isBindableRefShape(ref: unknown): ref is Ap2MandateRef {
  if (!isRecord(ref)) return false;
  if (!Object.keys(ref).every((key) => MANDATE_REF_ALLOWED_KEYS.has(key))) return false;
  if (refCarriesSignatureMaterial(ref)) return false;
  const candidate = ref as Partial<Ap2MandateRef>;
  return candidate.schemaVersion === AP2_MANDATE_INGESTION_SCHEMA_VERSION
    && candidate.draft === false
    && typeof candidate.mandateType === 'string'
    && AP2_MANDATE_TYPE_VOCABULARY.includes(candidate.mandateType)
    && typeof candidate.mandateHash === 'string'
    && MANDATE_HASH_PATTERN.test(candidate.mandateHash)
    && typeof candidate.supportState === 'string'
    && ['ap2_mandate_fixture', 'ap2_mandate_probe_only', 'unsupported_live_ap2_settlement'].includes(candidate.supportState)
    && candidate.vdcVerification === 'fixture-asserted'
    && candidate.settlementFinalityClaimed === false;
}

function refCarriesSignatureMaterial(ref: unknown): boolean {
  if (!isRecord(ref)) return false;
  for (const [key, value] of Object.entries(ref)) {
    if (SIGNATURE_KEY_PATTERN.test(key)) return true;
    if (typeof value === 'string' && (SIGNATURE_VALUE_PATTERN.test(value) || SENSITIVE_VALUE_PATTERN.test(value))) return true;
  }
  return false;
}

function deriveConstraints(
  mandate: Ap2MandateFixture,
  currency: BuyerAuthorityAsset,
  maxAmountUnits: string,
): Ap2DerivedPolicyConstraints {
  const sellerIds = mandate.merchant?.id ? [`ap2-merchant:${mandate.merchant.id}`] : [];
  const endpointIds = mandate.merchant?.id ? [`ap2-merchant-endpoint:${mandate.merchant.id}`] : [];
  return {
    allowedCurrencies: [currency],
    spendCaps: [
      {
        asset: currency,
        // (DRAFT/unverified — AP2) illustrative rail label; AP2 is not a settlement network.
        network: AP2_AUTHORIZATION_NETWORK,
        maxAmountUnits,
        window: 'per_request',
      },
    ],
    sellerAllowlistAdditions: { sellerIds, endpointIds },
    expiresAt: mandate.expiresAt,
    operatorApprovalRequired: mandate.humanPresent === false,
  };
}

function buildMandateRef(mandate: Ap2MandateFixture, supportState: Ap2SupportState): Ap2MandateRef {
  return {
    schemaVersion: AP2_MANDATE_INGESTION_SCHEMA_VERSION,
    draft: false,
    mandateType: mandate.mandateType,
    mandateHash: hashAp2Mandate(mandate),
    supportState,
    humanPresent: mandate.humanPresent,
    vdcVerification: 'fixture-asserted',
    settlementFinalityClaimed: false,
  };
}

function failClosed(
  mandate: unknown,
  supportState: Ap2SupportState,
  reasonCodes: Ap2IngestReasonCode[],
  auditNotes: string[],
): Ap2MandateIngestionResult {
  const mandateType: Ap2MandateType = isStructuredMandate(mandate) ? mandate.mandateType : 'intent';
  return {
    schemaVersion: AP2_MANDATE_INGESTION_SCHEMA_VERSION,
    draft: false,
    externalStandard: AP2_EXTERNAL_STANDARD,
    supportState,
    mandateRef: {
      schemaVersion: AP2_MANDATE_INGESTION_SCHEMA_VERSION,
      draft: false,
      mandateType,
      mandateHash: hashAp2Mandate(mandate),
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

/** Record with a well-formed opaque VDC envelope and a string mandateType. */
function hasVdcEnvelope(value: unknown): value is Record<string, unknown> & { vdc: Ap2VerifiableDigitalCredential } {
  if (!isRecord(value)) return false;
  if (typeof value.mandateType !== 'string') return false;
  const vdc = value.vdc;
  return isRecord(vdc)
    && typeof (vdc as Ap2VerifiableDigitalCredential).signatureB64 === 'string'
    && (vdc as Ap2VerifiableDigitalCredential).verification === 'fixture-asserted';
}

function isStructuredMandate(value: unknown): value is Ap2MandateFixture {
  return hasVdcEnvelope(value)
    && AP2_MANDATE_TYPE_VOCABULARY.includes(value.mandateType as Ap2MandateType);
}

function stripSignature(mandate: Ap2MandateFixture): Record<string, unknown> {
  const clone = structuredClone(mandate) as Record<string, unknown>;
  if (isRecord(clone.vdc)) {
    const vdc = clone.vdc as Record<string, unknown>;
    delete vdc.signatureB64;
  }
  return clone;
}

/**
 * Deterministic sha256 over the canonicalized mandate with the opaque VDC
 * signature removed. Exported so the conformance surface can recompute it and
 * detect tampering on either side. One-way: the ref never reveals contents.
 */
export function hashAp2Mandate(mandate: unknown): string {
  const source = isStructuredMandate(mandate) || hasVdcEnvelope(mandate)
    ? stripSignature(mandate as Ap2MandateFixture)
    : mandate;
  return `sha256:${createHash('sha256').update(canonicalize(source)).digest('hex')}`;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) => nested !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${canonicalize(nested)}`).join(',')}}`;
}

function mandateContainsCredentialMaterial(value: unknown): boolean {
  if (typeof value === 'string') {
    return SENSITIVE_VALUE_PATTERN.test(value) || PAN_PATTERN.test(value);
  }
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(mandateContainsCredentialMaterial);
  return Object.entries(value).some(([key, nested]) => (
    SENSITIVE_KEY_PATTERN.test(key) || mandateContainsCredentialMaterial(nested)
  ));
}

/**
 * Signature/key material anywhere in the SIGNATURE-STRIPPED mandate — i.e.
 * outside the single opaque `vdc.signatureB64` slot — fails closed. RAP does no
 * key handling and never holds Visa / Mastercard / FIDO signature material.
 */
function containsSignatureMaterial(value: unknown): boolean {
  if (typeof value === 'string') return SIGNATURE_VALUE_PATTERN.test(value);
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsSignatureMaterial);
  return Object.entries(value).some(([key, nested]) => (
    SIGNATURE_KEY_PATTERN.test(key) || containsSignatureMaterial(nested)
  ));
}

function serializedContainsMarker(value: unknown, markers: string[]): boolean {
  const serialized = JSON.stringify(value).toLowerCase();
  return markers.some((marker) => serialized.includes(marker));
}

function mapCurrency(mandate: Ap2MandateFixture): BuyerAuthorityAsset | null {
  const currency = mandate.payment?.currency ?? mandate.cart?.total.currency;
  if (typeof currency !== 'string') return null;
  return AP2_CURRENCY_TO_RAP_ASSET[currency.trim().toUpperCase()] ?? null;
}

function mandateOverCap(mandate: Ap2MandateFixture): boolean {
  const cap = mandate.payment?.budgetCap;
  if (typeof cap !== 'string') return false;
  const amount = mandate.payment?.amount ?? mandate.cart?.total.amount;
  if (typeof amount !== 'string') return false;
  const capValue = parseAmount(cap);
  const amountValue = parseAmount(amount);
  if (capValue === null || amountValue === null) return true; // unparseable -> fail closed
  return amountValue > capValue;
}

function isExpired(expiresAt: string | undefined, now: string): boolean {
  if (typeof expiresAt !== 'string') return false;
  const expiry = Date.parse(expiresAt);
  const nowMs = Date.parse(now);
  if (Number.isNaN(expiry) || Number.isNaN(nowMs)) return true;
  return nowMs > expiry;
}

function parseAmount(value: string): number | null {
  if (!/^\d+(\.\d+)?$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Lossless normalization of a decimal AP2 fixture amount (≤2 decimals) into an
 * integer centi-unit string ('50.00' -> '5000'), so caps derived from a mandate
 * can be enforced by the BigInt-based buyer-authority gate. Returns null (fail
 * closed upstream) for anything with more precision — no silent rounding.
 * WITHIN-LANE only: this is never a cross-rail unit conversion.
 */
export function ap2FixtureCentiUnits(value: string): string | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const frac = (match[2] ?? '').padEnd(2, '0');
  return String(BigInt(match[1]) * 100n + BigInt(frac === '' ? '0' : frac));
}

/** BigInt comparison of two integer unit strings; null when incomparable. */
function compareUnits(a: string, b: string): number | null {
  try {
    const left = BigInt(a);
    const right = BigInt(b);
    return left < right ? -1 : left > right ? 1 : 0;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function dedupeComposition(codes: Ap2CompositionReasonCode[]): Ap2CompositionReasonCode[] {
  return [...new Set(codes)];
}

// ---------------------------------------------------------------------------
// #338 rail support-state matrix — AP2 row (fixture representation).
//
// The #338 rail-neutral support-state vocabulary is expressed per-module as a
// `supportState` union rather than a single central matrix object. There is no
// central matrix table in code, so this fixture adds the AP2 row alongside the
// existing rails, documenting the AP2 support states, their claim boundary, and
// their status.
//
// The rows stay `draft: true` / `confidence: 'low'` DELIBERATELY even though
// the RAP-side adapter contract is promoted (#563): each row describes AP2's
// EXTERNAL mandate vocabulary and governance lineage, which remain unverified
// against any live implementation (see AP2_EXTERNAL_STANDARD).
// ---------------------------------------------------------------------------

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

export const AP2_RAIL_SUPPORT_STATE_MATRIX: Ap2RailSupportStateRow[] = [
  {
    rail: 'google-ap2',
    standard: 'Google AP2 (Agent Payments Protocol)',
    supportState: 'ap2_mandate_fixture',
    mandateTypes: ['cart', 'payment', 'checkout_closed', 'payment_closed'],
    description:
      'Finalized Checkout/Cart + Payment mandate present; VDC signature treated as fixture-asserted (opaque, not verified live); buyer-authority constraints derivable and composable with a local policy that always wins; no settlement claim.',
    draft: true,
    confidence: 'low',
    governanceNote:
      '(DRAFT/unverified — FIDO/Visa/Mastercard) AP2 + Mastercard Verifiable Intent reportedly contributed to FIDO (~2026-05); Visa TAP and Mastercard Agent Pay are distinct downstream rails, NOT the mandate format. Confirm before relying.',
    claimBoundary: [
      'AP2 is a trust/authorization layer, not a settlement rail.',
      'RAP claims no settlement finality, custody, or live payment from an AP2 mandate.',
      'The VDC signature is opaque and is not verified against any live key; RAP holds no key material.',
      'A mandate can only narrow local buyer authority, never widen it.',
    ],
  },
  {
    rail: 'google-ap2',
    standard: 'Google AP2 (Agent Payments Protocol)',
    supportState: 'ap2_mandate_probe_only',
    mandateTypes: ['intent', 'checkout_open', 'payment_open'],
    description:
      'Only an Open/Intent mandate (constraints, no finalized cart) — usable for preflight/planning and parser tests, not for authorizing a specific spend. Probe-only refs never compose with a policy and never bind to a receipt.',
    draft: true,
    confidence: 'low',
    governanceNote:
      '(DRAFT/unverified — AP2) Open/Closed staging read from ap2-protocol.org (medium confidence on the v0.2 rename).',
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
    description:
      'Any mandate asserting completed settlement, custody, or finality — or carrying credential/PAN/signature material outside the opaque VDC slot — is rejected. A future live lane must first define live VDC signature verification, wallet custody, spend limits, replay handling, operator approval, and rollback.',
    draft: true,
    confidence: 'low',
    governanceNote:
      '(DRAFT/unverified — AP2/FIDO) live AP2 settlement is out of scope; no live VDC verification exists in this adapter.',
    claimBoundary: [
      'Live AP2 settlement is unsupported in this fixture corpus.',
      'Settlement-finality and custody claims fail closed.',
      'Rejected mandate refs never bind to a receipt.',
    ],
  },
];

// ---------------------------------------------------------------------------
// Illustrative fixtures (static, no I/O). AP2 shapes remain DRAFT/unverified.
// ---------------------------------------------------------------------------

const BASE_VDC: Ap2VerifiableDigitalCredential = {
  alg: 'ES256',
  signatureB64: 'Zml4dHVyZS1hc3NlcnRlZC1vcGFxdWUtdmRjLXNpZ25hdHVyZS1ub3QtdmVyaWZpZWQ',
  verification: 'fixture-asserted',
};

const checkoutClosedPaymentClosedValid: Ap2MandateFixture = {
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

const paymentOpenProbeOnly: Ap2MandateFixture = {
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

const expiredMandate: Ap2MandateFixture = {
  ...checkoutClosedPaymentClosedValid,
  expiresAt: '2026-06-01T00:00:00.000Z',
};

const humanNotPresent: Ap2MandateFixture = {
  ...checkoutClosedPaymentClosedValid,
  humanPresent: false,
};

const overBudgetMandate: Ap2MandateFixture = {
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

const railMismatchMandate: Ap2MandateFixture = {
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
const panLeakMandate: Ap2MandateFixture = {
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
} as unknown as Ap2MandateFixture;

// Mandate-type outside the supported vocabulary (valid VDC envelope) -> fail closed
// as unsupported_mandate_type, never coerced into an authorizing stage.
const unsupportedTypeMandate = {
  ...checkoutClosedPaymentClosedValid,
  mandateType: 'subscription_recurring',
} as unknown as Ap2MandateFixture;

// Signature material OUTSIDE the opaque vdc.signatureB64 slot (e.g. a stray
// scheme-level JWS field) -> rejected: RAP does no key handling.
const signatureMaterialMandate = {
  ...checkoutClosedPaymentClosedValid,
  merchant: {
    id: 'seller:listing-writer',
    name: 'Listing Writer',
    schemeJws: 'eyJhbGciOiJFUzI1NiJ9.eyJtYW5kYXRlIjoibGVhayJ9.c2lnbmF0dXJlLWJ5dGVzLWZpeHR1cmU',
  },
} as unknown as Ap2MandateFixture;

export const ap2MandateFixtures = {
  checkoutClosedPaymentClosedValid,
  paymentOpenProbeOnly,
  expiredMandate,
  humanNotPresent,
  overBudgetMandate,
  railMismatchMandate,
  panLeakMandate,
  settlementClaimMandate,
  unsupportedTypeMandate,
  signatureMaterialMandate,
} as const;

export function listAp2MandateFixtures(): Array<{ key: string; mandate: Ap2MandateFixture }> {
  return Object.entries(ap2MandateFixtures).map(([key, mandate]) => ({
    key,
    mandate: structuredClone(mandate) as Ap2MandateFixture,
  }));
}
