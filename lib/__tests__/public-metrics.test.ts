import { reddiReceiptFixtureCases } from "@reddi/agent-protocol/fixtures";

import { specialistProfiles } from "../../packages/openrouter-specialists/src/profiles/index";
import { demonstratedSourceTrustCaseCount } from "@/lib/assurance/source-trust-coverage";
import {
  directoryFixtureProfileCount,
  receiptFixtureCaseCount,
  sourceTrustConformanceCaseCount,
} from "@/lib/assurance/public-metrics";

/**
 * The landing page publishes these three numbers as public claims. Two are
 * pinned constants kept out of the client bundle, so the assertions below are
 * what hold them to the real corpora; the third is checked against classifier
 * behaviour rather than a restatement of its own definition.
 */
describe("landing-page assurance metrics", () => {
  it("publishes the size of the shipped specialist directory registry", () => {
    expect(directoryFixtureProfileCount).toBe(specialistProfiles.length);
    expect(new Set(specialistProfiles.map((profile) => profile.id)).size).toBe(
      directoryFixtureProfileCount,
    );
  });

  it("counts only well-formed, distinct receipt fixture cases", () => {
    const entries = Object.entries(reddiReceiptFixtureCases);
    const wellFormed = entries.filter(
      ([, fixture]) =>
        typeof fixture.description === "string" &&
        fixture.description.length > 0 &&
        fixture.receipt !== undefined &&
        typeof fixture.expectedValid === "boolean" &&
        Array.isArray(fixture.expectedErrorCodes),
    );

    expect(wellFormed).toHaveLength(receiptFixtureCaseCount);
    expect(new Set(entries.map(([name]) => name)).size).toBe(receiptFixtureCaseCount);
    expect(receiptFixtureCaseCount).toBeGreaterThan(0);
    expect(wellFormed.some(([, fixture]) => fixture.expectedValid)).toBe(true);
    expect(wellFormed.some(([, fixture]) => !fixture.expectedValid)).toBe(true);
  });

  it("counts the source-trust cases the classifier still demonstrates end to end", () => {
    expect(demonstratedSourceTrustCaseCount()).toBe(sourceTrustConformanceCaseCount);
    expect(sourceTrustConformanceCaseCount).toBeGreaterThan(0);
  });
});
