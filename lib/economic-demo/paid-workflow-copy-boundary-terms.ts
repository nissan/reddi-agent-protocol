/**
 * Paid-workflow copy-boundary terms (#501).
 *
 * Single source of truth for the copy-boundary regression gate over the
 * buyer paid-workflow route (`/economic-demo/paid-workflow`, #497/#498/#499).
 * Consumed by BOTH gate layers so they cannot drift apart:
 *
 * - `scripts/check-paid-workflow-copy-boundaries.mjs` — deterministic static
 *   scan of the rendered route-model fixtures (no browser), wired into the
 *   `rap-package-guard` CI workflow.
 * - `e2e/economic-demo-paid-workflow-copy-gate.spec.ts` — the same forbidden /
 *   required assertions against the rendered DOM.
 *
 * Every forbidden claim is derived from — and cites an exact anchor in —
 * docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md (#452), the repo-wide copy
 * authority ("the fail-closed reading here wins"). The gate script verifies
 * each anchor still exists in that doc, so editing the authority doc without
 * re-deriving the gate fails closed instead of silently drifting.
 *
 * Pattern design: the route legitimately renders these concepts in NEGATED
 * form ("no custody", "No mainnet settlement", "Any live Airwallex settlement
 * claim fails closed", the 16-flag grid labels). The forbidden patterns
 * therefore match only AFFIRMATIVE claim shapes (concept + upgrading verb),
 * never the bare concept noun — a silent upgrade from "no X" to "X is live"
 * is exactly the regression this gate exists to catch.
 */

export const PAID_WORKFLOW_COPY_BOUNDARY_TERMS_SCHEMA_VERSION =
  "reddi.economic-demo.paid-workflow-copy-boundary-terms.v1" as const;

/** Repo-relative path to the copy authority doc (#452). */
export const COPY_BOUNDARY_AUTHORITY_DOC_PATH =
  "docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md" as const;

export type ForbiddenCopyClaim = {
  /** Stable id for reporting. */
  id: string;
  /** The claim upgrade this rule forbids. */
  claim: string;
  /**
   * Exact substring (whitespace-normalized) that must exist in
   * COPY_BOUNDARY_AUTHORITY_DOC_PATH. If the anchor disappears, the doc and
   * the gate have drifted and the gate fails closed.
   */
  docAnchor: string;
  /** Affirmative-overclaim patterns. Must match NO rendered copy. No /g flags. */
  patterns: RegExp[];
  /**
   * Negative-control phrase: injecting this into the model output must make
   * the gate exit non-zero. The gate self-test asserts every injection is
   * caught on every run.
   */
  injectionExample: string;
};

export type RequiredCopyLabel = {
  id: string;
  label: string;
  /** Must match somewhere in the rendered copy. No /g flags. */
  pattern: RegExp;
};

/**
 * Forbidden copy/claim upgrades (issue #501 acceptance list + the Airwallex /
 * AP2 overclaim cases added by the 2026-07-06 audit refresh).
 */
export const FORBIDDEN_COPY_CLAIMS: ForbiddenCopyClaim[] = [
  {
    id: "custody",
    claim: "RAP/route takes or holds custody of funds",
    docAnchor: "Claim custody, settlement finality, or live publication",
    patterns: [
      /\b(?:takes?|took|taking|holds?|held|holding|assumes?|assumed|gains?|gained)\s+custody\b/i,
      /\bcustody\s+of\s+(?:user|buyer|seller)?\s*funds\b/i,
      /\bfunds?\s+(?:are|is|remain|held)\s+(?:held\s+)?in\s+custody\b/i,
      /\bcustodial\s+(?:wallet|service|account|rail|escrow)\b/i,
    ],
    injectionExample: "RAP takes custody of buyer funds during this workflow.",
  },
  {
    id: "settlement_finality",
    claim: "Settlement finality is achieved/guaranteed",
    docAnchor:
      "no custody, no settlement-finality claims, no live payments, no trust upgrades",
    patterns: [
      /\bsettlement\s+(?:is|was|becomes?|became)\s+final\b/i,
      /\bsettlement\s+finality\s+(?:is\s+)?(?:achieved|guaranteed|provided|reached|proven|complete)\b/i,
      /\b(?:guarantees?|provides?|achieves?|proves?)\s+settlement\s+finality\b/i,
    ],
    injectionExample: "This receipt guarantees settlement finality.",
  },
  {
    id: "production_audd_rail",
    claim: "Production AUDD rail is live/enabled",
    docAnchor: "payment-plan/preflight gates (AUDD/x402 dry-run planning)",
    patterns: [
      /\bproduction\s+AUDD\s+rail\s+(?:is\s+)?(?:live|enabled|active|activated|available)\b/i,
      /\bAUDD\s+(?:payments?\s+|settlement\s+)?(?:is|are)\s+(?:live|enabled|active)\s+in\s+production\b/i,
      /\bAUDD\s+auto-?settl/i,
    ],
    injectionExample: "The production AUDD rail is live for this buyer.",
  },
  {
    id: "default_usdc_auto_pay",
    claim: "USDC auto-pay is enabled by default",
    docAnchor:
      "spend caps, allowlists, expiry, operator approval",
    patterns: [
      /\bUSDC\s+auto-?pay\s+(?:is\s+)?(?:enabled|on|active|activated)(?:\s+by\s+default)?\b/i,
      /\bdefaults?\s+to\s+USDC\s+auto-?pay/i,
      /\bauto-?pays?\s+(?:in\s+)?USDC\b/i,
    ],
    injectionExample: "This route defaults to USDC auto-pay.",
  },
  {
    id: "pay_sh_production_activation",
    claim: "Pay.sh is activated in production",
    docAnchor:
      "They do not publish raw imported drafts, activate payments, probe endpoints, call providers, assign trust or reputation, or mutate registry state",
    patterns: [
      /\bPay\.sh\s+(?:is\s+)?(?:activated|live|enabled|active)\s+in\s+production\b/i,
      /\bPay\.sh\s+production\s+(?:activation\s+is\s+complete|is\s+(?:live|enabled|active|activated))\b/i,
      /\bactivates?\s+Pay\.sh\s+production\b/i,
    ],
    injectionExample: "Pay.sh is activated in production for this route.",
  },
  {
    id: "mainnet_settlement",
    claim: "Funds settle on mainnet",
    docAnchor: "no Quasar instruction building or on-chain writes",
    patterns: [
      /\bsettl(?:es?|ed|ement)\s+on\s+mainnet\b/i,
      /\bmainnet\s+settlement\s+(?:is\s+)?(?:live|enabled|completed?|executed|occurred|final)\b/i,
    ],
    injectionExample: "Funds settled on mainnet for this workflow.",
  },
  {
    id: "hosted_registry_write",
    claim: "Hosted registry writes / live listing publication happen",
    docAnchor:
      "They do not publish raw imported drafts, activate payments, probe endpoints, call providers, assign trust or reputation, or mutate registry state",
    patterns: [
      /\b(?:writes?|wrote|written)\s+to\s+the\s+hosted\s+registry\b/i,
      /\bhosted\s+registry\s+(?:write|publication)\s+(?:succeeded|completed|performed|executed)\b/i,
      /\bpublish(?:es|ed)?\s+(?:a\s+)?live\s+listing\b/i,
    ],
    injectionExample: "This run writes to the hosted registry.",
  },
  {
    id: "live_trust_reputation_mutation",
    claim: "Live trust/reputation mutation occurs",
    docAnchor:
      "No reputation mutation happens on failed policy, missing evidence, failed attestation, or unverified payment proof",
    patterns: [
      /\breputation\s+(?:was|is|has\s+been)\s+(?:mutated|updated\s+on-?chain|committed\s+on-?chain)\b/i,
      /\b(?:trust|reputation)\s+mutation\s+(?:is\s+)?(?:enabled|live|performed|executed)\b/i,
      /\btrust\s+(?:is|was|has\s+been)\s+(?:upgraded|granted)\b/i,
      /\bupgrades?\s+trust\b/i,
    ],
    injectionExample: "Reputation was mutated on-chain after this run.",
  },
  {
    id: "airwallex_settlement_overclaim",
    claim: "Airwallex settlement is live/completed (rail is probe-only)",
    docAnchor:
      "probe-only rails (e.g. webhook-derived card-rail fixtures) are capped at `probe_only` and can never become binding receipts or settlement claims",
    patterns: [
      /\bAirwallex\s+settlement\s+(?:is|was|has\s+been)\s+(?:live|completed?|final|executed|enabled|succeeded)\b/i,
      /\bsettl(?:es?|ed)\s+(?:via|through|with)\s+Airwallex\b/i,
      /\blive\s+Airwallex\s+settlement\s+is\s+(?:enabled|supported|active|available)\b/i,
    ],
    injectionExample: "Airwallex settlement is live for this workflow.",
  },
  {
    id: "ap2_mandate_overclaim",
    claim: "AP2 mandate authorizes/widens payment authority",
    docAnchor:
      "external mandates and rail metadata can only narrow it, never widen it",
    patterns: [
      /\bAP2\s+mandate\s+authoriz(?:es?|ed)\s+(?:a\s+|this\s+|the\s+)?payment/i,
      /\bAP2\s+(?:mandate\s+)?(?:grants?|widens?|approves?)\s+(?:payment|spend|authority)/i,
      /\bAP2\s+settlement\b/i,
    ],
    injectionExample: "The AP2 mandate authorizes payment on this rail.",
  },
];

/**
 * Labels that MUST be present in the rendered copy (#501 acceptance list:
 * dry-run, no-spend, recorded-devnet, optional fresh-devnet, live-gated,
 * production-disabled).
 */
export const REQUIRED_COPY_LABELS: RequiredCopyLabel[] = [
  { id: "dry_run", label: "dry-run", pattern: /dry.?run/i },
  { id: "no_spend", label: "no-spend", pattern: /no.?spend/i },
  {
    id: "recorded_devnet",
    label: "recorded-devnet",
    pattern: /recorded.?devnet|devnet_proof_metadata/i,
  },
  {
    id: "optional_fresh_devnet",
    label: "optional fresh-devnet",
    pattern: /optional\s+fresh.?devnet/i,
  },
  { id: "live_gated", label: "live-gated", pattern: /live.?gated/i },
  {
    id: "production_disabled",
    label: "production-disabled",
    pattern: /production.?(?:live.?)?disabled/i,
  },
];

/**
 * The full #497 16-flag hard-boundary grid. The gate asserts the model
 * exposes exactly these keys and that every one of them is `false`.
 */
export const EXPECTED_HARD_BOUNDARY_FLAG_KEYS = [
  "walletSigning",
  "rpcCall",
  "providerCall",
  "paidRequest",
  "sandboxExecution",
  "hostedRegistryWrite",
  "marketplacePublication",
  "trustUpgrade",
  "reputationMutation",
  "custodyClaim",
  "settlementFinalityProof",
  "livePayment",
  "productionAuddRail",
  "defaultUsdcAutoPay",
  "mainnetSettlement",
  "payShProductionActivation",
] as const;
