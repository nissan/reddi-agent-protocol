#!/usr/bin/env node
/**
 * #384 evidence: prove that malformed and secret-shaped intake input is
 * blocked by the SAME #575 validator the intake UI calls
 * (`validateOnboardingIntakeDescriptor` via `runOnboardingAnalyserHandoff`).
 *
 * Deterministic and offline. Regenerate with:
 *   node docs/evidence/384/generate-blocked-input-proof.mjs > docs/evidence/384/blocked-input-proof.json
 */
import { validateOnboardingIntakeDescriptor } from "../../../packages/agent-protocol/dist/onboarding-analyser-handoff.js";

const TIMESTAMP = "2026-07-06T00:00:00Z";

function descriptor(overrides) {
  return {
    schemaVersion: "reddi.onboarding-intake-descriptor.v1",
    intakeId: "evidence-384",
    sourceKind: "mcp-metadata",
    ingestionMode: "static-fixture",
    source: {
      sourceUrl: "https://fixtures.example.com/mcp/server-card.json",
      snapshotRef: "fixtures/onboarding/ui-intake/evidence-384.json",
      crawlTimestamp: TIMESTAMP,
    },
    declaredMetadata: { capabilities: [{ name: "summarize-document" }] },
    staticOnly: true,
    ...overrides,
  };
}

const cases = [
  {
    label: "secret-shaped URL query key (api_key=…) — UI blocked-secret state",
    input: descriptor({
      source: {
        sourceUrl: "https://example.com/card.json?api_key=sk-evidence-REDACTED",
        snapshotRef: "fixtures/onboarding/ui-intake/evidence-384.json",
        crawlTimestamp: TIMESTAMP,
      },
    }),
  },
  {
    label: "bearer-token material in metadata — UI blocked-secret state",
    input: descriptor({
      declaredMetadata: {
        capabilities: [{ name: "summarize-document" }],
        authHints: ["Authorization: Bearer sk-evidence12345678"],
      },
    }),
  },
  {
    label: "credentials embedded in URL userinfo — UI blocked-secret state",
    input: descriptor({
      source: {
        sourceUrl: "https://user:evidencepass@example.com/card.json",
        snapshotRef: "fixtures/onboarding/ui-intake/evidence-384.json",
        crawlTimestamp: TIMESTAMP,
      },
    }),
  },
  {
    label: "malformed URL — UI invalid-url state",
    input: descriptor({
      source: {
        sourceUrl: "not-a-url",
        snapshotRef: "fixtures/onboarding/ui-intake/evidence-384.json",
        crawlTimestamp: TIMESTAMP,
      },
    }),
  },
  {
    label: "private/localhost URL — UI invalid-url state",
    input: descriptor({
      source: {
        sourceUrl: "https://localhost:8443/card.json",
        snapshotRef: "fixtures/onboarding/ui-intake/evidence-384.json",
        crawlTimestamp: TIMESTAMP,
      },
    }),
  },
  {
    label: "structurally malformed descriptor — UI blocked state",
    input: { schemaVersion: "wrong", declaredMetadata: { capabilities: "not-an-array" } },
  },
];

const results = cases.map(({ label, input }) => {
  const result = validateOnboardingIntakeDescriptor(input);
  return {
    label,
    accepted: result.ok === true,
    errors: result.ok ? [] : result.errors.map(({ code, path }) => ({ code, path })),
  };
});

if (results.some((entry) => entry.accepted)) {
  console.error("EVIDENCE FAILURE: a malformed/secret-shaped input was accepted");
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      issue: 384,
      generatedBy: "docs/evidence/384/generate-blocked-input-proof.mjs",
      validator: "reddi.onboarding-intake-descriptor.v1 (packages/agent-protocol, #575)",
      note: "Error messages omitted by design; codes+paths only, so no input material is echoed.",
      allBlocked: true,
      cases: results,
    },
    null,
    2,
  ),
);
