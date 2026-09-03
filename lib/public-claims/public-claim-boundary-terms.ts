/**
 * Shared public-claim boundary terms for RAP Assurance.
 *
 * Authority: `docs/PUBLIC-CLAIM-BOUNDARY.md`. Two consumers share this list so
 * the owned-text contract and the rendered-copy contract cannot drift apart:
 *
 * - `scripts/check-public-claim-boundaries.mjs` scans the repository's owned
 *   public prose and package metadata (README/docs/package.json), whose literal
 *   text is itself the published artifact.
 * - `e2e/public-claim-boundary.spec.ts` scans the rendered DOM of the public
 *   routes, which is where app copy is actually a claim.
 */

export const PUBLIC_CLAIM_BOUNDARY_DOC_PATH = "docs/PUBLIC-CLAIM-BOUNDARY.md";

export const CENTRAL_MESSAGE = "Payments prove transfer; RAP Assurance proves paid work";

export type ForbiddenPublicClaim = {
  id: string;
  pattern: RegExp;
  reason: string;
  /** Affirmative phrasing the pattern must catch; drives the negative-control self-test. */
  injectionExample: string;
};

export const FORBIDDEN_PUBLIC_CLAIMS: ForbiddenPublicClaim[] = [
  {
    id: "marketplace-rail",
    pattern: /\b(?:is|as|becomes?|provides?|gives|gives existing agent systems|turns|lets|handles)\b[^\n]{0,120}?\bmarketplace\s+rail\b/i,
    reason: "Do not position RAP as a marketplace rail.",
    injectionExample: "Reddi Agent Protocol is the marketplace rail for agent commerce.",
  },
  {
    id: "payment-facilitator",
    pattern: /\b(?:is|as|becomes?|provides?|runs|operates|handles)\b[^\n]{0,100}?\bpayment\s+facilitator\b/i,
    reason: "Do not position RAP as a payment facilitator.",
    injectionExample: "RAP Assurance operates as a payment facilitator for paid agent work.",
  },
  {
    id: "generic-runtime",
    pattern: /\b(?:generic|hosted|production)\s+(?:agent\s+)?runtime\b[^\n]{0,80}?\b(?:live|ready|available|provided|built in)\b/i,
    reason: "Do not claim a generic/hosted runtime product is live.",
    injectionExample: "Our hosted agent runtime is live for every registered specialist.",
  },
  {
    id: "custody-provider",
    pattern: /\b(?:takes?|holds?|provides?|offers?|assumes?)\s+(?:production\s+)?(?:funds?\s+)?custody\b|\bcustody\s+(?:provider|service|product)\b/i,
    reason: "Do not claim custody.",
    injectionExample: "The protocol takes custody of buyer funds with no delay.",
  },
  {
    id: "escrow-provider",
    pattern: /\b(?:production\s+)?escrow\s+(?:provider|service|product|finality|guarantee)\b/i,
    reason: "Do not claim an escrow product or escrow finality.",
    injectionExample: "RAP ships production escrow finality with no configuration.",
  },
  {
    id: "collected-fee",
    pattern: /\b(?:collects?|charges?|takes?)\s+(?:a\s+)?(?:0\.05\s*%|5\s*bps\b|protocol\s+fee\b|take-?rate\b)/i,
    reason: "Protocol fee/take-rate is not implemented.",
    injectionExample: "The protocol collects a 0.05% take-rate on every settled job.",
  },
  {
    id: "production-ready",
    pattern: /\b(?:production[-\s]?ready|ready\s+for\s+production|production\s+readiness\s+(?:passed|complete|green))\b/i,
    reason: "Production readiness is not established.",
    injectionExample: "The RAP Assurance stack is production-ready with no caveats.",
  },
  {
    id: "mainnet-ready",
    pattern: /\b(?:mainnet[-\s]?ready|ready\s+for\s+mainnet|mainnet\s+readiness\s+(?:passed|complete|green))\b/i,
    reason: "Mainnet readiness is not established.",
    injectionExample: "The Quasar program set is mainnet-ready.",
  },
  {
    id: "security-audited",
    pattern: /\b(?:security[-\s]?audited|audit\s+(?:passed|complete|completed)|audited\s+(?:release|contracts?|programs?))\b/i,
    reason: "No completed security audit is claimed.",
    injectionExample: "This is a security-audited release of the escrow programs.",
  },
  {
    id: "live-audd-settlement",
    pattern: /\bAUDD\b[^\n]{0,120}?\b(?:live|production|settled|settlement\s+(?:complete|enabled|ready)|custody)\b/i,
    reason: "AUDD is proof/payment-plan/read-only observation metadata unless separately approved.",
    injectionExample: "AUDD custody is available for every specialist invoice.",
  },
  {
    id: "payment-proves-work",
    pattern: /\bpayment\s+(?:proof|receipt|evidence)\s+(?:proves|guarantees|certifies)\s+(?:work|quality|success|delivery)\b/i,
    reason: "Payment proves transfer, not work quality.",
    injectionExample: "A payment receipt proves work quality for the buyer.",
  },
];

/**
 * Boundary forms that qualify a claim. There are no standalone qualifier
 * words: every pattern belongs to one claim and contains that claim's own
 * predicate, so a negation elsewhere in the clause ("with no extra setup",
 * "without delay", "outside the demo") cannot excuse an affirmative claim it
 * never touches. QUALIFIER_CASES pins both directions, including the
 * cross-product of each boundary form against the other claims.
 */
const NEGATED_BEFORE = "(?:\\bnot\\b|\\bnever\\b|\\bnor\\b|\\bunless\\b)";

const CLAIM_PREDICATES: Record<string, string> = {
  "marketplace-rail": "\\bmarketplace\\s+rail\\b",
  "payment-facilitator": "\\bpayment\\s+facilitator\\b",
  "generic-runtime": "\\b(?:generic|hosted|production)\\s+(?:agent\\s+)?runtime\\b",
  "custody-provider": "\\bcustody\\b",
  "escrow-provider": "\\bescrow\\s+(?:provider|service|product|finality|guarantee)\\b",
  "collected-fee": "(?:0\\.05\\s*%|5\\s*bps|protocol\\s+fee|take-?rate)",
  "production-ready": "\\bproduction[-\\s]?read(?:y|iness)\\b",
  "mainnet-ready": "\\bmainnet[-\\s]?read(?:y|iness)\\b",
  "security-audited": "\\baudit(?:ed|s)?\\b",
  "live-audd-settlement": "\\b(?:live|production|settled|settlement|custody)\\b",
  "payment-proves-work": "\\b(?:proves|guarantees|certifies)\\b",
};

function boundaryFormsFor(claimId: string): RegExp[] {
  const predicate = CLAIM_PREDICATES[claimId];
  if (!predicate) return [];
  const forms = [
    new RegExp(`${NEGATED_BEFORE}[^.;|]{0,260}?${predicate}`, "i"),
    new RegExp(`\\bwithout\\b[^.;|]{0,120}?${predicate}`, "i"),
  ];
  if (claimId === "escrow-provider") {
    forms.push(
      new RegExp(`\\bno\\s+\\S+(?:\\s+\\S+)?\\s+(?:asserts?|claims?|proves?|implies|guarantees?)[^.;|]{0,80}?${predicate}`, "i"),
    );
  }
  if (claimId === "live-audd-settlement") {
    forms.push(
      /\bno-(?:custody|spend|settlement)\b/i,
      /\bno\b[^.;|]{0,24}\b(?:AUDD|USDC|SPL)\b[^.;|]{0,12}\bcustody\b/i,
      new RegExp(`${predicate}[^.;|]{0,80}?\\b(?:is|are|remains?)\\s+not\\b`, "i"),
      new RegExp(`${predicate}[^.;|]{0,120}?\\bremains?\\s+outside\\b`, "i"),
    );
  }
  return forms;
}

/** Per-claim boundary forms, each one binding a negation to that claim's predicate. */
export const CLAIM_SPECIFIC_QUALIFIERS: Record<string, RegExp[]> = Object.fromEntries(
  Object.keys(CLAIM_PREDICATES).map((claimId) => [claimId, boundaryFormsFor(claimId)]),
);

/**
 * Expected `claimIsQualified` verdicts, asserted by the gate's always-on
 * self-test. Negatives include the cross-product of each boundary form against
 * claims it must not excuse; positives are the genuine boundary prose each
 * claim actually ships.
 */
export const QUALIFIER_CASES: { line: string; claimId: string; qualified: boolean }[] = [
  { line: "RAP provides custody with no extra setup.", claimId: "custody-provider", qualified: false },
  { line: "The protocol takes custody of buyer funds with no delay.", claimId: "custody-provider", qualified: false },
  { line: "RAP provides custody with no payment friction.", claimId: "custody-provider", qualified: false },
  { line: "Our custody service ships with no spend limits.", claimId: "custody-provider", qualified: false },
  { line: "The protocol takes custody of buyer funds without delay.", claimId: "custody-provider", qualified: false },
  {
    line: "RAP Assurance is the open receipt and conformance layer for paid MCP/API and agent work. It records terms, policy, payment-proof references, evidence, attestations, replay metadata, and reputation inputs without becoming the payment rail or custody provider.",
    claimId: "custody-provider",
    qualified: true,
  },
  { line: "The protocol takes custody of buyer funds, gated behind approval.", claimId: "custody-provider", qualified: false },
  { line: "RAP ships production escrow finality with no configuration.", claimId: "escrow-provider", qualified: false },
  { line: "RAP offers an escrow service with no-fee onboarding.", claimId: "escrow-provider", qualified: false },
  { line: "We ship escrow finality without delay.", claimId: "escrow-provider", qualified: false },
  { line: "RAP offers an escrow service, blocked elsewhere.", claimId: "escrow-provider", qualified: false },
  { line: "The RAP Assurance stack is production-ready with no caveats.", claimId: "production-ready", qualified: false },
  { line: "The RAP Assurance stack is production-ready with no-claims caveats.", claimId: "production-ready", qualified: false },
  { line: "The RAP Assurance stack is production-ready outside the demo.", claimId: "production-ready", qualified: false },
  { line: "The RAP Assurance stack is production-ready until further notice.", claimId: "production-ready", qualified: false },
  { line: "Quasar is mainnet-ready until further notice.", claimId: "mainnet-ready", qualified: false },
  { line: "Quasar is mainnet-ready, refused only on request.", claimId: "mainnet-ready", qualified: false },
  { line: "The protocol collects a 0.05% take-rate with no fee cap.", claimId: "collected-fee", qualified: false },
  { line: "RAP collects a protocol fee, gated behind approval.", claimId: "collected-fee", qualified: false },
  { line: "AUDD settlement is live with no custody limits.", claimId: "live-audd-settlement", qualified: false },
  { line: "AUDD settlement is live, avoid the demo path.", claimId: "live-audd-settlement", qualified: false },
  { line: "Reddi Agent Protocol is the marketplace rail with no lock-in.", claimId: "marketplace-rail", qualified: false },
  { line: "RAP Assurance operates as a payment facilitator without fees.", claimId: "payment-facilitator", qualified: false },
  { line: "This is a security-audited release with no findings.", claimId: "security-audited", qualified: false },
  {
    line: "- Not a payment facilitator, custody service, escrow provider, wallet SDK, or generic hosted agent runtime.",
    claimId: "custody-provider",
    qualified: true,
  },
  {
    line: "- Not a payment facilitator, custody service, escrow provider, wallet SDK, or generic hosted agent runtime.",
    claimId: "escrow-provider",
    qualified: true,
  },
  {
    line: "It is not a payment facilitator, marketplace operator, custody provider, or production runtime.",
    claimId: "payment-facilitator",
    qualified: true,
  },
  { line: "- Not mainnet-ready and not a live-funds production deployment.", claimId: "mainnet-ready", qualified: true },
  { line: "the reputation path is neither audited nor mainnet-ready.", claimId: "mainnet-ready", qualified: true },
  { line: "- Not a security-audited release;", claimId: "security-audited", qualified: true },
  {
    line: "This repository's claims should use this boundary unless a later audited release note supersedes it.",
    claimId: "security-audited",
    qualified: true,
  },
  {
    line: "No row here asserts custody, escrow finality, mainnet readiness, or a completed security audit.",
    claimId: "escrow-provider",
    qualified: true,
  },
  {
    line: "AUDD is payment-plan/proof metadata and read-only SPL observation unless a separate approved live rail lands.",
    claimId: "live-audd-settlement",
    qualified: true,
  },
  { line: "AUDD/SPL custody is not claimed.", claimId: "live-audd-settlement", qualified: true },
  {
    line: "See [AUDD non-custodial foundation](#audd-non-custodial-foundation) for the canonical x402 export and read-only observation boundary; actual wallet actions, SPL custody, Quasar escrow, and settlement proof verification remain outside this package.",
    claimId: "live-audd-settlement",
    qualified: true,
  },
  {
    line: "| `quickstart-no-spend-workflow` | failure states and AUDD proof-metadata/no-custody labels |",
    claimId: "live-audd-settlement",
    qualified: true,
  },
  { line: "- no AUDD custody path is approved in the current contract scope;", claimId: "live-audd-settlement", qualified: true },
  { line: "scope, and no current AUDD/USDC custody.", claimId: "live-audd-settlement", qualified: true },
];

/**
 * Markdown headings that open an explicit prohibition list. Bullets under such
 * a heading are prohibitions even when the bullet itself carries no negation.
 *
 * The alternation has to name a prohibition, not merely contain a negation:
 * bare `is not`/`are not` also match descriptive headings such as "Evidence
 * artifacts that are not committed", which would exempt that whole section
 * from scanning.
 */
export const PROHIBITION_HEADING_PATTERN =
  /^#{1,6}\s.*\b(?:must not|do not|does not|not yet|non-?claims?|not claim(?:ed|ing)?|out of scope|prohibited|forbidden|never claim)\b/i;

/**
 * Separators that end a clause. Sentence terminators require trailing space so
 * `0.05%`, `5/7/5`, and `deployments.json` do not split a clause apart. A comma
 * ends a clause only before a contrastive conjunction, which starts a new
 * independent clause ("…takes custody of buyer funds, but no mainnet claim is
 * made"). `and`/`or` are excluded because they are the serial-comma tail of an
 * enumeration governed by one leading negation ("Not a payment facilitator,
 * custody service, escrow provider, or wallet SDK"). Splitting on those two as
 * well was tried and fails closed the wrong way: it flags the serial-comma
 * boundary lists this repository actually ships. So a claim joined to an
 * unrelated negation by ", and"/", or" stays a reviewer's call, not the
 * regex's.
 */
const CLAUSE_SEPARATOR =
  /[.!?](?=\s|$)|[;|]|—|–|,\s+(?:but|yet|so|while|whereas|though|although|however)\b/g;

/** The single clause containing `position`. */
function clauseWindow(line: string, position: number): string {
  const boundaries = [0];
  CLAUSE_SEPARATOR.lastIndex = 0;
  let separator: RegExpExecArray | null;
  while ((separator = CLAUSE_SEPARATOR.exec(line)) !== null) {
    boundaries.push(separator.index + separator[0].length);
  }
  boundaries.push(line.length);

  let from = 0;
  let to = line.length;
  for (const boundary of boundaries) {
    if (boundary > position) {
      to = boundary;
      break;
    }
    from = boundary;
  }
  return line.slice(from, to);
}

/**
 * True when every occurrence of the claim on this line states its own boundary.
 *
 * Each occurrence is judged by the clause holding the phrase the pattern ends
 * on, because that is where the claim is actually asserted. Windowing on the
 * whole match would let a pattern's greedy middle reach back into an earlier
 * negated clause, and stopping at the first occurrence would let a later
 * unqualified assertion ride on an earlier boundary sentence.
 */
export function claimIsQualified(line: string, claim: ForbiddenPublicClaim): boolean {
  const qualifiers = CLAIM_SPECIFIC_QUALIFIERS[claim.id] ?? [];
  const flags = claim.pattern.flags.includes("g") ? claim.pattern.flags : `${claim.pattern.flags}g`;
  const scanner = new RegExp(claim.pattern.source, flags);
  let match: RegExpExecArray | null;
  let matched = false;
  while ((match = scanner.exec(line)) !== null) {
    matched = true;
    const assertedAt = Math.max(match.index, match.index + match[0].length - 1);
    const window = clauseWindow(line, assertedAt);
    if (!qualifiers.some((pattern) => pattern.test(window))) return false;
    if (match.index === scanner.lastIndex) scanner.lastIndex += 1;
  }
  return matched;
}

export type PublicClaimDomRoute = {
  path: string;
  /**
   * Heading that only the route's own content tree renders. The DOM gate waits
   * for it before snapshotting, so a green result cannot come from an
   * unhydrated shell.
   */
  readyHeading: RegExp;
  /**
   * Selector for a route's data-dependent region, where the heading renders
   * above a loading skeleton and so cannot vouch for the copy below it. The
   * gate waits for this too, so the snapshot covers the claim-bearing content
   * rather than the placeholder that stands in for it.
   */
  settledContent?: string;
};

/**
 * Registry- and user-supplied text is marked with this scope so the DOM gate
 * can drop it before scanning. Specialist and candidate cards render strings a
 * third party wrote when registering on devnet; this repository cannot edit
 * them, so they are not part of its owned-copy contract.
 */
export const CLAIM_SCOPE_ATTRIBUTE = "data-claim-scope";
export const EXTERNAL_CLAIM_SCOPE = "external";
export const EXTERNAL_CLAIM_SCOPE_SELECTOR = `[${CLAIM_SCOPE_ATTRIBUTE}="${EXTERNAL_CLAIM_SCOPE}"]`;

/**
 * Public routes whose *first-party* rendered copy is gated at the DOM layer.
 * The gate scans each route's DOM with `EXTERNAL_CLAIM_SCOPE_SELECTOR` subtrees
 * removed. Routes are listed here only when their owned copy renders
 * deterministically without a wallet; see docs/PUBLIC-CLAIM-BOUNDARY.md for the
 * routes deliberately left out and why.
 */
export const PUBLIC_CLAIM_DOM_ROUTES: PublicClaimDomRoute[] = [
  { path: "/", readyHeading: /payments prove transfer\. RAP Assurance proves paid work\./i },
  {
    path: "/agents",
    readyHeading: /specialist directory/i,
    settledContent:
      '[data-testid="agent-card"], [data-testid="marketplace-candidate-card"], [data-testid="discovery-empty-state"]',
  },
  { path: "/spec", readyHeading: /ADL/i },
  { path: "/whitepaper", readyHeading: /Reddi Agent Protocol Whitepaper/i },
  { path: "/start", readyHeading: /proof walkthrough|walkthrough recording is currently withheld/i },
  { path: "/playbook", readyHeading: /Start fast, then go deep/i },
  { path: "/dogfood", readyHeading: /Dogfood Specialist \+ Attestor Flow/i },
  { path: "/leaderboard", readyHeading: /Specialist Leaderboard/i },
];
