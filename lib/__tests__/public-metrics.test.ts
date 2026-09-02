import { reddiReceiptFixtureCases } from "@reddi/agent-protocol/fixtures";
import { SOURCE_TRUST_REQUIRED_CASES } from "@reddi/agent-protocol/source-trust-conformance-matrix";

import { specialistProfiles } from "../../packages/openrouter-specialists/src/profiles/index";
import {
  directoryFixtureProfileCount,
  receiptFixtureCaseCount,
  sourceTrustConformanceCaseCount,
} from "@/lib/assurance/public-metrics";

/**
 * The landing page publishes these three numbers as public claims. This suite
 * is what keeps the one constant honest: it loads the real specialist registry
 * (Node-only, so it cannot be imported by the client page) and requires the
 * published count to equal it.
 */
describe("landing-page assurance metrics", () => {
  it("publishes the size of the shipped specialist directory registry", () => {
    expect(directoryFixtureProfileCount).toBe(specialistProfiles.length);
  });

  it("derives the conformance counts from non-empty shipped corpora", () => {
    expect(receiptFixtureCaseCount).toBe(Object.keys(reddiReceiptFixtureCases).length);
    expect(receiptFixtureCaseCount).toBeGreaterThan(0);
    expect(sourceTrustConformanceCaseCount).toBe(SOURCE_TRUST_REQUIRED_CASES.length);
    expect(sourceTrustConformanceCaseCount).toBeGreaterThan(0);
  });
});
