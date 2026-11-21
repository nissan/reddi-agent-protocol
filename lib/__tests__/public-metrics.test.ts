import { SOURCE_TRUST_REQUIRED_CASES } from "@redditech/agent-protocol/source-trust-conformance-matrix";

import { specialistProfiles } from "../../packages/openrouter-specialists/src/profiles/index";
import { demonstratedSourceTrustCaseCount } from "@/lib/assurance/source-trust-coverage";
import {
  directoryFixtureProfileCount,
  sourceTrustConformanceCaseCount,
} from "@/lib/assurance/public-metrics";

/**
 * The landing page publishes these two numbers as public claims. Both
 * are pinned constants kept out of the client bundle, so the assertions below
 * are what hold them to the real corpora Node-side; the source-trust count is
 * further checked against classifier behaviour so the claimed coverage is
 * proven end to end.
 */
describe("landing-page assurance metrics", () => {
  it("publishes the size of the shipped specialist directory registry", () => {
    expect(directoryFixtureProfileCount).toBe(specialistProfiles.length);
    expect(new Set(specialistProfiles.map((profile) => profile.id)).size).toBe(
      directoryFixtureProfileCount,
    );
  });

  it("counts the source-trust cases the classifier still demonstrates end to end", () => {
    expect(sourceTrustConformanceCaseCount).toBe(SOURCE_TRUST_REQUIRED_CASES.length);
    expect(demonstratedSourceTrustCaseCount()).toBe(sourceTrustConformanceCaseCount);
    expect(sourceTrustConformanceCaseCount).toBeGreaterThan(0);
  });
});
