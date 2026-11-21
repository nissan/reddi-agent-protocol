/**
 * Landing-page assurance counts.
 *
 * `app/page.tsx` renders these. Keep them as constants so no corpus is pulled
 * into a page bundle: the specialist registry (which reaches `node:fs` through the
 * `@reddi/x402-solana` barrel), and the source-trust
 * conformance corpus are therefore published as constants and
 * pinned to the real corpora Node-side by `lib/__tests__/public-metrics.test.ts`.
 */
export const directoryFixtureProfileCount = 30;
export const sourceTrustConformanceCaseCount = 7;
