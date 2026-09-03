/**
 * Landing-page assurance counts.
 *
 * `app/page.tsx` is a client component, so a corpus enumerated here ships to
 * every visitor. The specialist registry (which reaches `node:fs` through the
 * `@reddi/x402-solana` barrel), the receipt fixture corpus, and the
 * source-trust conformance corpus are therefore published as constants and
 * pinned to the real corpora Node-side by `lib/__tests__/public-metrics.test.ts`.
 */
export const directoryFixtureProfileCount = 30;
export const receiptFixtureCaseCount = 6;
export const sourceTrustConformanceCaseCount = 7;
