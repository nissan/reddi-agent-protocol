import { reddiReceiptFixtureCases } from "@reddi/agent-protocol/fixtures";
import {
  SOURCE_TRUST_REQUIRED_CASES,
  SOURCE_TRUST_STATES,
} from "@reddi/agent-protocol/source-trust-conformance-matrix";

/**
 * Landing-page assurance counts, derived from the shipped conformance corpora
 * rather than restated by hand, so public copy cannot quote a figure the
 * repository does not contain.
 */
export const receiptFixtureCaseCount = Object.keys(reddiReceiptFixtureCases).length;
export const sourceTrustStateCount = SOURCE_TRUST_STATES.length;
export const sourceTrustConformanceCaseCount = SOURCE_TRUST_REQUIRED_CASES.length;
