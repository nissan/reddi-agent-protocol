import { reddiReceiptFixtureCases } from "@reddi/agent-protocol/fixtures";
import { SOURCE_TRUST_REQUIRED_CASES } from "@reddi/agent-protocol/source-trust-conformance-matrix";

import { specialistProfiles } from "../../packages/openrouter-specialists/src/profiles/index";

/**
 * Landing-page assurance counts, derived from the shipped corpora rather than
 * restated by hand, so public copy cannot quote a figure the repository does
 * not contain.
 */
export const directoryFixtureProfileCount = specialistProfiles.length;
export const receiptFixtureCaseCount = Object.keys(reddiReceiptFixtureCases).length;
export const sourceTrustConformanceCaseCount = SOURCE_TRUST_REQUIRED_CASES.length;
