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
 * Qualifiers that turn a pattern hit into a stated boundary rather than a
 * claim. Deliberately narrow, and evaluated only against the clause the match
 * sits in: words the remediation sprinkles everywhere ("planned", "fixture",
 * "boundary", "historical") are NOT qualifiers, and a negation elsewhere on
 * the line does not excuse an affirmative claim made in its own clause.
 *
 * A bare `no` is not a qualifier: it exempted any clause that merely trailed
 * "with no extra setup". Nor is a shared list of `no <noun>` compounds, which
 * let "no payment friction" excuse a custody claim. These global entries are
 * negations of whatever predicate they sit with; compounds that only bound one
 * predicate live in CLAIM_SPECIFIC_QUALIFIERS, and QUALIFIER_CASES pins both
 * directions.
 */
export const CLAIM_QUALIFIER_PATTERNS: RegExp[] = [
  /\bnot\b/i,
  /\bno\s+\S+(?:\s+\S+)?\s+(?:asserts?|claims?|proves?|implies|guarantees?|establishes?)\b/i,
  /\bnor\b/i,
  /\bnever\b/i,
  /\bwithout\b/i,
  /\bunless\b/i,
  /\buntil\b/i,
  /\bavoid\b/i,
  /\bblocked\b/i,
  /\brefused\b/i,
  /\bgated\b/i,
  /\bout of scope\b/i,
  /\boutside\b/i,
  /\bnon-?claims?\b/i,
];

/**
 * Boundary forms that qualify one claim only, because they negate that claim's
 * own predicate. Keyed by claim id so "no spend limits" cannot excuse a custody
 * claim the way a shared list did.
 */
export const CLAIM_SPECIFIC_QUALIFIERS: Record<string, RegExp[]> = {
  "live-audd-settlement": [
    /\bno-(?:custody|spend|settlement)\b/i,
    /\bno\b[^.;|]{0,24}\b(?:AUDD|USDC|SPL)\b[^.;|]{0,12}\bcustody\b/i,
  ],
};

/**
 * Expected `claimIsQualified` verdicts, asserted by the gate's always-on
 * self-test. Negatives are affirmative claims that must stay flagged, including
 * cross-claim bypasses; positives are genuine boundary prose that must stay
 * green.
 */
export const QUALIFIER_CASES: { line: string; claimId: string; qualified: boolean }[] = [
  { line: "RAP provides custody with no extra setup.", claimId: "custody-provider", qualified: false },
  { line: "The protocol takes custody of buyer funds with no delay.", claimId: "custody-provider", qualified: false },
  { line: "RAP provides custody with no payment friction.", claimId: "custody-provider", qualified: false },
  { line: "Our custody service ships with no spend limits.", claimId: "custody-provider", qualified: false },
  { line: "RAP ships production escrow finality with no configuration.", claimId: "escrow-provider", qualified: false },
  { line: "RAP offers an escrow service with no-fee onboarding.", claimId: "escrow-provider", qualified: false },
  { line: "The RAP Assurance stack is production-ready with no caveats.", claimId: "production-ready", qualified: false },
  { line: "The RAP Assurance stack is production-ready with no-claims caveats.", claimId: "production-ready", qualified: false },
  { line: "The protocol collects a 0.05% take-rate with no fee cap.", claimId: "collected-fee", qualified: false },
  { line: "AUDD settlement is live with no custody limits.", claimId: "live-audd-settlement", qualified: false },
  {
    line: "- Not a payment facilitator, custody service, escrow provider, wallet SDK, or generic hosted agent runtime.",
    claimId: "custody-provider",
    qualified: true,
  },
  {
    line: "No row here asserts custody, escrow finality, mainnet readiness, or a completed security audit.",
    claimId: "escrow-provider",
    qualified: true,
  },
  {
    line: "| `quickstart-no-spend-workflow` | the §2 demo end-to-end, including failure states and AUDD proof-metadata/no-custody labels |",
    claimId: "live-audd-settlement",
    qualified: true,
  },
  {
    line: "| AUDD proof-metadata / no-custody state labels | demo stateLabels |",
    claimId: "live-audd-settlement",
    qualified: true,
  },
  {
    line: "- no AUDD custody path is approved in the current contract scope;",
    claimId: "live-audd-settlement",
    qualified: true,
  },
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
  const qualifiers = [
    ...CLAIM_QUALIFIER_PATTERNS,
    ...(CLAIM_SPECIFIC_QUALIFIERS[claim.id] ?? []),
  ];
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

/** Public routes whose rendered copy is gated at the DOM layer. */
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
];
