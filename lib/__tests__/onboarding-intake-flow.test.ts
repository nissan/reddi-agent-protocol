/**
 * #384 — AI onboarding assistant intake flow adapter tests.
 *
 * The adapter must stay a thin surface over the #575 analyser handoff and the
 * #576 onboarding state machine: no new validation rules, no network, no
 * secret storage. These tests cover the source-kind mapping, every UI state
 * classification (analysed / empty / invalid_url / blocked_secret / blocked /
 * analyser_error+retry), and the no-live-path boundary.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  INTAKE_DRYRUN_TIMESTAMP,
  INTAKE_DRYRUN_URL_MARKERS,
  INTAKE_SOURCE_OPTIONS,
  buildIntakeDescriptorCandidate,
  getIntakeSourceOption,
  parseManualCapabilityLines,
  runIntakeDryRunAnalysis,
  type IntakeFormInput,
} from "@/lib/onboarding/intake-flow";
import {
  validateOnboardingIntakeDescriptor,
} from "@reddi/agent-protocol/onboarding-analyser-handoff";

const GOOD_URL = "https://fixtures.example.com/mcp/server-card.json";

function urlInput(optionId: IntakeFormInput["optionId"], sourceUrl: string): IntakeFormInput {
  return { optionId, sourceUrl };
}

describe("intake source options (#384 acceptance inputs)", () => {
  it("covers all six required inputs and maps each onto an OnboardingSourceKind", () => {
    const ids = INTAKE_SOURCE_OPTIONS.map((option) => option.id);
    expect(ids).toEqual([
      "endpoint-url",
      "ai-catalog-url",
      "mcp-card-url",
      "openapi-url",
      "a2a-card-url",
      "manual-seed",
    ]);
    expect(getIntakeSourceOption("ai-catalog-url").sourceKind).toBe("ard-ai-catalog");
    expect(getIntakeSourceOption("mcp-card-url").sourceKind).toBe("mcp-metadata");
    expect(getIntakeSourceOption("openapi-url").sourceKind).toBe("openapi");
    expect(getIntakeSourceOption("a2a-card-url").sourceKind).toBe("a2a-card");
    expect(getIntakeSourceOption("manual-seed").sourceKind).toBe("manual-descriptor");
    // A bare endpoint has no card document to snapshot: recorded as a manual seed.
    expect(getIntakeSourceOption("endpoint-url").sourceKind).toBe("manual-descriptor");
  });

  it("builds candidates that the #575 validator accepts for every URL kind", () => {
    for (const optionId of ["ai-catalog-url", "mcp-card-url", "openapi-url", "a2a-card-url"] as const) {
      const candidate = buildIntakeDescriptorCandidate(urlInput(optionId, GOOD_URL));
      const result = validateOnboardingIntakeDescriptor(candidate);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.descriptor.ingestionMode).toBe("static-fixture");
        expect(result.descriptor.staticOnly).toBe(true);
        expect(result.descriptor.source.sourceUrl).toBe(GOOD_URL);
        expect(result.descriptor.source.crawlTimestamp).toBe(INTAKE_DRYRUN_TIMESTAMP);
      }
    }
  });
});

describe("analysed state (success path)", () => {
  it("runs the full handoff chain and creates a draft read model", () => {
    const outcome = runIntakeDryRunAnalysis(urlInput("mcp-card-url", GOOD_URL));
    expect(outcome.status).toBe("analysed");
    if (outcome.status !== "analysed") return;
    expect(outcome.handoff.ok).toBe(true);
    expect(outcome.handoff.capabilityInventory.entries.length).toBeGreaterThan(0);
    expect(outcome.handoff.readiness.overall).toBe("needs_operator_review");
    expect(outcome.handoff.listingExportDraft.publicationDisabled).toBe(true);
    expect(outcome.handoff.sellerWrapperDraft.paymentPlan.activation).toBe("disabled");
    // #576 state machine: drafts always start in `draft` with open gates.
    expect(outcome.readModel.state).toBe("draft");
    expect(outcome.readModel.localReadModelOnly).toBe(true);
    expect(outcome.readModel.blockingGates.some((gate) => gate.gate === "operator_approval")).toBe(true);
    expect(outcome.nextStates.length).toBeGreaterThan(0);
    expect(outcome.nextStates).not.toContain("draft");
    // Side-effect ledger stays all-false by construction.
    expect(Object.values(outcome.readModel.publication).every((flag) => flag === false)).toBe(true);
  });

  it("is deterministic for the same input", () => {
    const first = runIntakeDryRunAnalysis(urlInput("openapi-url", GOOD_URL));
    const second = runIntakeDryRunAnalysis(urlInput("openapi-url", GOOD_URL));
    expect(second).toEqual(first);
  });

  it("marks manual-seed fields as user_provided, never verified", () => {
    const outcome = runIntakeDryRunAnalysis({
      optionId: "manual-seed",
      manualSeed: {
        displayName: "Manual Agent",
        description: "Operator-described agent",
        contactRef: "operator:test",
        capabilityLines: "summarize-document — Summarize a provided document\ntranslate-text",
        endpointUrl: "https://api.example.com/agent",
      },
    });
    expect(outcome.status).toBe("analysed");
    if (outcome.status !== "analysed") return;
    expect(outcome.handoff.rapProfileDraft.identity.displayName.provenance).toBe("user_provided");
    const provenances = outcome.handoff.capabilityInventory.entries.map((entry) => entry.name.provenance);
    expect(provenances.every((provenance) => provenance !== "verified")).toBe(true);
  });
});

describe("empty / no-results state", () => {
  it("classifies a manual seed without capabilities as empty", () => {
    const outcome = runIntakeDryRunAnalysis({
      optionId: "manual-seed",
      manualSeed: {
        displayName: "Empty Agent",
        description: "No capabilities yet",
        capabilityLines: "",
      },
    });
    expect(outcome.status).toBe("empty");
    if (outcome.status !== "empty") return;
    expect(outcome.handoff.readiness.overall).toBe("blocked");
    expect(outcome.handoff.readiness.failClosedReasons).toContain("missing_evidence");
  });

  it("classifies the empty fixture marker URL as empty", () => {
    const outcome = runIntakeDryRunAnalysis(
      urlInput("ai-catalog-url", `https://fixtures.example.com/${INTAKE_DRYRUN_URL_MARKERS.empty}/card.json`),
    );
    expect(outcome.status).toBe("empty");
  });

  it("classifies a bare endpoint URL as empty (no metadata without #459 live inspection)", () => {
    const outcome = runIntakeDryRunAnalysis(urlInput("endpoint-url", "https://api.example.com/agent"));
    expect(outcome.status).toBe("empty");
    if (outcome.status !== "empty") return;
    expect(outcome.readModel?.state).toBe("draft");
  });
});

describe("invalid URL state", () => {
  it.each([
    ["not a url", "not-a-url"],
    ["http (non-https)", "http://example.com/card.json"],
    ["localhost", "https://localhost:8443/card.json"],
    ["private range", "https://192.168.1.20/card.json"],
    ["internal suffix", "https://registry.internal/card.json"],
  ])("rejects %s as invalid_url", (_label, badUrl) => {
    const outcome = runIntakeDryRunAnalysis(urlInput("openapi-url", badUrl));
    expect(outcome.status).toBe("invalid_url");
    if (outcome.status !== "invalid_url") return;
    expect(
      outcome.errors.every(
        (error) => error.code === "private_url_blocked" || error.code === "malformed_intake_descriptor",
      ),
    ).toBe(true);
  });
});

describe("blocked secret state (#575 credential_leakage_rejected)", () => {
  it("rejects a URL with a credential-shaped query key", () => {
    const outcome = runIntakeDryRunAnalysis(
      urlInput("mcp-card-url", "https://example.com/card.json?api_key=abc123def456"),
    );
    expect(outcome.status).toBe("blocked_secret");
  });

  it("rejects a URL with embedded userinfo credentials", () => {
    const outcome = runIntakeDryRunAnalysis(
      urlInput("openapi-url", "https://user:hunter2pass@example.com/openapi.json"),
    );
    expect(outcome.status).toBe("blocked_secret");
  });

  it("rejects secret-shaped material typed into manual seed fields", () => {
    const outcome = runIntakeDryRunAnalysis({
      optionId: "manual-seed",
      manualSeed: {
        displayName: "Sneaky Agent",
        description: "Authorization: Bearer sk-fixture12345678",
        capabilityLines: "summarize-document",
      },
    });
    expect(outcome.status).toBe("blocked_secret");
    if (outcome.status !== "blocked_secret") return;
    // The classifier must not echo the secret value back in error output.
    const serialized = JSON.stringify(outcome.errors);
    expect(serialized).not.toContain("sk-fixture12345678");
  });
});

describe("analyser error + retry (simulated fixture interruption)", () => {
  const unreachableUrl = `https://fixtures.example.com/${INTAKE_DRYRUN_URL_MARKERS.unreachable}/card.json`;

  it("fails retryably on attempt 1 and succeeds on retry", () => {
    const first = runIntakeDryRunAnalysis(urlInput("mcp-card-url", unreachableUrl), 1);
    expect(first.status).toBe("analyser_error");
    if (first.status === "analyser_error") {
      expect(first.retryable).toBe(true);
      expect(first.message).toMatch(/no live request/i);
    }
    const retry = runIntakeDryRunAnalysis(urlInput("mcp-card-url", unreachableUrl), 2);
    expect(retry.status).toBe("analysed");
  });
});

describe("no-live-path boundary", () => {
  it("keeps every analyser guardrail false on successful outcomes", () => {
    const outcome = runIntakeDryRunAnalysis(urlInput("a2a-card-url", GOOD_URL));
    expect(outcome.status).toBe("analysed");
    if (outcome.status !== "analysed") return;
    expect(Object.values(outcome.handoff.guardrails).every((flag) => flag === false)).toBe(true);
    expect(Object.values(outcome.readModel.guardrails).every((flag) => flag === false)).toBe(true);
  });

  it("adapter source contains no network, wallet, or storage surface", () => {
    const source = readFileSync(join(process.cwd(), "lib/onboarding/intake-flow.ts"), "utf8");
    for (const forbidden of [
      "fetch(",
      "XMLHttpRequest",
      "WebSocket",
      "axios",
      "node:http",
      "node:https",
      "node:net",
      "child_process",
      "node:fs",
      "localStorage",
      "sessionStorage",
      "@solana/web3.js",
      "wallet-adapter",
    ]) {
      expect(source.includes(forbidden)).toBe(false);
    }
    expect(source).not.toMatch(/\basync\b|\bawait\b/);
  });
});

describe("manual capability line parsing", () => {
  it("parses name — description lines and skips blanks", () => {
    expect(parseManualCapabilityLines("a — does a\n\n b \nc — long — dash")).toEqual([
      { name: "a", description: "does a" },
      { name: "b" },
      { name: "c", description: "long — dash" },
    ]);
  });
});
