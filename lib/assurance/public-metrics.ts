import { SOURCE_TRUST_REQUIRED_CASES } from "@reddi/agent-protocol/source-trust-conformance-matrix";

/**
 * Landing-page assurance counts.
 *
 * `app/page.tsx` is a client component, so a corpus enumerated here ships to
 * every visitor. The specialist registry (which reaches `node:fs` through the
 * `@reddi/x402-solana` barrel) and the receipt fixture corpus are therefore
 * published as constants and pinned to the real corpora Node-side by
 * `lib/__tests__/public-metrics.test.ts`.
 *
 * `SOURCE_TRUST_REQUIRED_CASES` is a bare string array in a `sideEffects: false`
 * package, so reading its length leaves nothing else in the bundle.
 */
export const directoryFixtureProfileCount = 30;
export const receiptFixtureCaseCount = 6;
export const sourceTrustConformanceCaseCount = SOURCE_TRUST_REQUIRED_CASES.length;
