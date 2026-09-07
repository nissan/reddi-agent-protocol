import {
  classifySourceTrustCandidate,
  sourceTrustConformanceFixtureCases,
} from "@reddi/agent-protocol/source-trust-conformance-matrix";

/**
 * Required cases the shipped classifier still demonstrates end to end: a
 * fixture counts only if classifying its input reproduces the expected state
 * and every expected finding code.
 *
 * Node-side only. It is deliberately not re-exported from
 * `lib/assurance/public-metrics.ts`, which the client landing page imports —
 * referencing the fixture corpus there would pull it into the browser bundle.
 */
export function demonstratedSourceTrustCaseCount(): number {
  const demonstrated = new Set<string>();

  for (const fixture of Object.values(sourceTrustConformanceFixtureCases)) {
    if (!fixture.requiredCase) continue;
    const row = classifySourceTrustCandidate(fixture.input);
    if (row.state !== fixture.expectedState) continue;
    const codes = new Set(row.findings.map((finding) => finding.code));
    if (!fixture.expectedFindingCodes.every((code) => codes.has(code))) continue;
    demonstrated.add(fixture.requiredCase);
  }

  return demonstrated.size;
}
