import { reddiReceiptFixtureCases } from "@reddi/agent-protocol/fixtures";
import { SOURCE_TRUST_REQUIRED_CASES } from "@reddi/agent-protocol/source-trust-conformance-matrix";

/**
 * Landing-page assurance counts.
 *
 * The two conformance corpora are dependency-free, so they are read directly.
 * The specialist directory registry is not: it reaches `node:fs` through the
 * `@reddi/x402-solana` barrel, so it must stay out of the browser graph. Its
 * size is published here as a constant and pinned to the real registry by
 * `lib/__tests__/public-metrics.test.ts`, which runs on the Node side.
 */
export const directoryFixtureProfileCount = 30;
export const receiptFixtureCaseCount = Object.keys(reddiReceiptFixtureCases).length;
export const sourceTrustConformanceCaseCount = SOURCE_TRUST_REQUIRED_CASES.length;
