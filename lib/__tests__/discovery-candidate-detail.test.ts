import {
  buildDiscoveryCandidateDetail,
  parseDiscoveryCandidateDetailId,
  DETAIL_CANDIDATE_FACETS,
  DISCOVERY_CANDIDATE_DETAIL_SCHEMA_VERSION,
  DISCOVERY_LIFECYCLE_STAGE_ORDER,
  type DiscoveryCandidateDetailResult,
} from "@/lib/discovery/candidate-detail";
import {
  buildArdCatalogCandidateCards,
  buildHostedRapCandidateCards,
} from "@/lib/discovery/marketplace-candidate-cards";
import { DISCOVERY_SOURCE_BOUNDARY } from "@/lib/discovery/source-facets";
import { DISCOVERY_ACTIONABILITY_LANE_ORDER } from "@/lib/manager/discovery-actionability-matrix";
import type { CircleX402Catalog } from "@/lib/integrations/source-adapter/circle-x402-catalog";
import type { PayShCatalog } from "@/lib/integrations/source-adapter/pay-sh-catalog";
import type { ReddiCircleX402Candidate } from "@/lib/integrations/source-adapter/profiles/circle-x402";
import type { ReddiPayShCandidate } from "@/lib/integrations/source-adapter/profiles/pay-sh";

jest.mock("@/lib/registry/bridge", () => {
  throw new Error("live registry bridge must not be imported by candidate detail");
});

jest.mock("@solana/web3.js", () => {
  throw new Error("Solana RPC helpers must not be imported by candidate detail");
});

function circleCandidate(overrides: Partial<ReddiCircleX402Candidate> = {}): ReddiCircleX402Candidate {
  return {
    candidateId: "circle-x402:fixture-provider",
    source: "circle-x402",
    providerName: "Fixture Provider",
    resource: "https://example.com/api/insights",
    category: "WEB_SEARCH_RESEARCH",
    taskTypes: ["research", "web-search"],
    sourceAdapter: { source: "circle-x402", version: "test" } as ReddiCircleX402Candidate["sourceAdapter"],
    payment: [
      {
        rail: "circle_gateway",
        scheme: "exact",
        network: "eip155:8453",
        asset: "usdc",
        priceUsdc: 0.05,
      },
    ],
    supportStates: ["discovery_visible", "externally_listed_unattested", "live_payment_disabled"],
    diagnostics: [],
    attestationState: "externally_listed_unattested",
    trustNotes: ["Externally listed metadata is unverified."],
    ...overrides,
  };
}

function circleCatalog(candidates: ReddiCircleX402Candidate[]): CircleX402Catalog {
  return {
    ok: true,
    sourcePath: "artifacts/circle-x402-discovery/test/resources.json",
    summary: { crawledAt: "2026-05-13T00:00:00Z", source: "https://x402.example/discovery" },
    candidates,
    total: candidates.length,
    returned: candidates.length,
  };
}

function payShCandidate(overrides: Partial<ReddiPayShCandidate> = {}): ReddiPayShCandidate {
  return {
    candidateId: "pay-sh:fixture-provider",
    source: "pay-sh",
    providerFqn: "fixture.pay.sh",
    providerName: "Fixture Pay.sh Provider",
    serviceUrl: "https://fixture.pay.sh",
    sourceMetadata: {
      sourceUrl: "https://pay.sh/api/catalog",
      rawProviderFqn: "fixture.pay.sh",
    },
    category: "data",
    taskTypes: ["research", "data-enrichment"],
    endpointCount: 2,
    pricing: {
      currency: "USDC",
      network: "solana",
      minUsd: 0.01,
      maxUsd: 0.1,
      hasFreeTier: false,
      hasMetering: true,
    },
    environmentCapabilities: {
      sandbox: { supported: true },
    } as ReddiPayShCandidate["environmentCapabilities"],
    supportStates: ["catalog_visible", "dry_run_only", "live_disabled"],
    diagnostics: [],
    sourceAdapter: { source: "pay-sh", version: "test" } as ReddiPayShCandidate["sourceAdapter"],
    attestationState: "externally_listed_unattested",
    trustNotes: [],
    ...overrides,
  };
}

function payShCatalog(candidates: ReddiPayShCandidate[]): PayShCatalog {
  return {
    ok: true,
    sourcePath: "artifacts/pay-sh-catalog/test/catalog.json",
    summary: { generated_at: "2026-05-13T00:00:00Z" },
    candidates,
    total: candidates.length,
    returned: candidates.length,
  };
}

function expectCommonInvariants(result: DiscoveryCandidateDetailResult) {
  expect(result.schemaVersion).toBe(DISCOVERY_CANDIDATE_DETAIL_SCHEMA_VERSION);
  expect(result.trustBoundary).toEqual(DISCOVERY_SOURCE_BOUNDARY);
  expect(Object.values(result.guardrails).every((value) => value === false)).toBe(true);
  if (result.availability === "found") {
    const { detail } = result;
    expect(detail.trustBoundary).toEqual(DISCOVERY_SOURCE_BOUNDARY);
    expect(Object.values(detail.guardrails).every((value) => value === false)).toBe(true);
    // Every candidate served here is discovery-stage only: no later lifecycle
    // stage may ever be marked reached.
    expect(detail.lifecycle.map((stage) => stage.id)).toEqual([...DISCOVERY_LIFECYCLE_STAGE_ORDER]);
    expect(detail.lifecycle[0].reached).toBe(true);
    for (const stage of detail.lifecycle.slice(1)) {
      expect(stage.reached).toBe(false);
      expect(stage.note.length).toBeGreaterThan(0);
    }
    // Matrix and its absence reason are mutually exclusive and never both null.
    expect(detail.matrix === null).toBe(detail.matrixUnavailableReason !== null);
    if (detail.matrix) {
      expect(detail.matrix.lanes.map((lane) => lane.lane)).toEqual([...DISCOVERY_ACTIONABILITY_LANE_ORDER]);
    }
  }
}

describe("discovery candidate detail (#382)", () => {
  describe("id parsing", () => {
    it("parses ids for every candidate detail facet", () => {
      for (const facet of DETAIL_CANDIDATE_FACETS) {
        expect(parseDiscoveryCandidateDetailId(`${facet}:some:id`)).toEqual({ facet, rest: "some:id" });
      }
    });

    it("fails closed on malformed and registry-native ids", () => {
      expect(parseDiscoveryCandidateDetailId("")).toBeNull();
      expect(parseDiscoveryCandidateDetailId("no-colon")).toBeNull();
      expect(parseDiscoveryCandidateDetailId("ard-catalog:")).toBeNull();
      expect(parseDiscoveryCandidateDetailId(":rest")).toBeNull();
      expect(parseDiscoveryCandidateDetailId("rap-registry:wallet")).toBeNull();
      expect(parseDiscoveryCandidateDetailId("openrouter:profile")).toBeNull();
      expect(parseDiscoveryCandidateDetailId("local-demo:profile")).toBeNull();
      expect(parseDiscoveryCandidateDetailId("unknown-source:x")).toBeNull();
    });
  });

  describe("hosted RAP registry detail", () => {
    const cards = buildHostedRapCandidateCards();

    it("returns the full detail for a listed (untrusted) hosted candidate", () => {
      const card = cards.find((item) => item.renderState === "untrusted");
      expect(card).toBeDefined();
      const result = buildDiscoveryCandidateDetail(card!.id);
      expectCommonInvariants(result);
      expect(result.availability).toBe("found");
      if (result.availability !== "found") return;

      // The embedded card is the exact #381 card model — no drift possible.
      expect(result.detail.card).toEqual(card);
      expect(result.detail.matrix).not.toBeNull();
      expect(result.detail.gatingReasons).toEqual(card!.reasonCodes);

      const sectionIds = result.detail.sections.map((section) => section.id);
      expect(sectionIds).toEqual(["provenance", "identity", "endpoint", "payment", "trust_manifest"]);

      // Hosted listings expose no endpoint URL — the field must be honestly null.
      const endpoint = result.detail.sections.find((section) => section.id === "endpoint");
      expect(endpoint?.fields.find((entry) => entry.id === "endpoint-url")?.value).toBeNull();
      // Payment activation is disabled at discovery; auth metadata is absent.
      const payment = result.detail.sections.find((section) => section.id === "payment");
      expect(payment?.fields.find((entry) => entry.id === "payment-activation")?.value).toBe("disabled");
      expect(payment?.fields.find((entry) => entry.id === "auth")?.value).toBeNull();
    });

    it("renders blocked export records fail-closed with recovery actions and no invented matrix", () => {
      const card = cards.find((item) => item.id.startsWith("hosted-rap:blocked:"));
      expect(card).toBeDefined();
      const result = buildDiscoveryCandidateDetail(card!.id);
      expectCommonInvariants(result);
      expect(result.availability).toBe("found");
      if (result.availability !== "found") return;

      expect(result.detail.card.renderState).toBe("blocked");
      expect(result.detail.matrix).toBeNull();
      expect(result.detail.matrixUnavailableReason).toMatch(/export gating/i);
      expect(result.detail.recoveryActions.length).toBeGreaterThan(0);
      expect(result.detail.validationFindings.length).toBeGreaterThan(0);
      expect(result.detail.validationFindings.every((finding) => finding.blocksPublication)).toBe(true);
    });

    it("fails closed to not_found for unknown hosted identifiers", () => {
      const result = buildDiscoveryCandidateDetail("hosted-rap:does-not-exist");
      expectCommonInvariants(result);
      expect(result.availability).toBe("not_found");
      if (result.availability === "found") return;
      expect(result.recoveryActions.length).toBeGreaterThan(0);
    });
  });

  describe("ARD / AI Catalog static-stack detail", () => {
    const cards = buildArdCatalogCandidateCards();

    it("returns the full detail for a valid imported candidate", () => {
      const card = cards.find((item) => item.renderState === "ard-imported");
      expect(card).toBeDefined();
      const result = buildDiscoveryCandidateDetail(card!.id);
      expectCommonInvariants(result);
      expect(result.availability).toBe("found");
      if (result.availability !== "found") return;

      expect(result.detail.card).toEqual(card);
      expect(result.detail.matrix).not.toBeNull();
      // Capability groups and snapshot/evidence references come straight from
      // the fixture read model.
      expect(result.detail.capabilityGroups.length).toBeGreaterThan(0);
      expect(result.detail.rawSnapshotRefs.length).toBeGreaterThan(0);
      const provenance = result.detail.sections.find((section) => section.id === "provenance");
      expect(provenance?.fields.find((entry) => entry.id === "checked-commit")?.value).toBeTruthy();
      // Crawl timestamp is not recorded for static imports — honest null.
      expect(provenance?.fields.find((entry) => entry.id === "crawl-timestamp")?.value).toBeNull();
    });

    it("renders malformed/rejected fixtures blocked with findings and recovery actions", () => {
      const card = cards.find((item) => item.renderState === "blocked");
      expect(card).toBeDefined();
      const result = buildDiscoveryCandidateDetail(card!.id);
      expectCommonInvariants(result);
      expect(result.availability).toBe("found");
      if (result.availability !== "found") return;

      expect(result.detail.card.renderState).toBe("blocked");
      expect(["failed_verification", "blocked", "needs_human_review"]).toContain(result.detail.card.trust.state);
      expect(result.detail.validationFindings.length).toBeGreaterThan(0);
      expect(result.detail.recoveryActions.length).toBeGreaterThan(0);
      // The matrix stays derivable for ARD candidates — blocked lanes included.
      expect(result.detail.matrix).not.toBeNull();
      const actionability = result.detail.matrix!.lanes.find((lane) => lane.lane === "actionability");
      expect(["blocked", "production_disabled", "needs_human_review"]).toContain(actionability!.state);
    });

    it("fails closed to not_found for unknown ARD candidate ids", () => {
      const result = buildDiscoveryCandidateDetail("ard-catalog:rev-x:missingFixture");
      expectCommonInvariants(result);
      expect(result.availability).toBe("not_found");
    });
  });

  describe("Circle x402 externally listed detail", () => {
    it("returns detail from an injected catalog with an honest matrix-unavailable reason", () => {
      const candidate = circleCandidate();
      const result = buildDiscoveryCandidateDetail(`circle-x402:${candidate.candidateId}`, {
        circle: circleCatalog([candidate]),
      });
      expectCommonInvariants(result);
      expect(result.availability).toBe("found");
      if (result.availability !== "found") return;

      expect(result.detail.matrix).toBeNull();
      expect(result.detail.matrixUnavailableReason).toMatch(/not derivable|unavailable/i);
      // The endpoint URL is metadata text, never an invocation affordance.
      const endpoint = result.detail.sections.find((section) => section.id === "endpoint");
      expect(endpoint?.fields.find((entry) => entry.id === "endpoint-url")?.value).toBe(candidate.resource);
      const payment = result.detail.sections.find((section) => section.id === "payment");
      expect(payment?.fields.find((entry) => entry.id === "payment-rail-0")?.value).toContain("circle_gateway");
      expect(result.detail.guardrailNotes).toEqual(candidate.trustNotes);
    });

    it("degrades to source_unavailable when the snapshot artifact is absent (repo default)", () => {
      const result = buildDiscoveryCandidateDetail("circle-x402:anything");
      expectCommonInvariants(result);
      expect(result.availability).toBe("source_unavailable");
      if (result.availability === "found") return;
      expect(result.reason).toMatch(/not ingested|not found/i);
      expect(result.recoveryActions.length).toBeGreaterThan(0);
    });

    it("fails closed to not_found for unknown candidates in an ingested catalog", () => {
      const result = buildDiscoveryCandidateDetail("circle-x402:unknown", {
        circle: circleCatalog([circleCandidate()]),
      });
      expectCommonInvariants(result);
      expect(result.availability).toBe("not_found");
    });

    it("marks blocker diagnostics as blocking validation findings", () => {
      const candidate = circleCandidate({
        diagnostics: [{ code: "missing_payee", severity: "blocker", detail: "No payee is declared." }],
      });
      const result = buildDiscoveryCandidateDetail(`circle-x402:${candidate.candidateId}`, {
        circle: circleCatalog([candidate]),
      });
      expect(result.availability).toBe("found");
      if (result.availability !== "found") return;
      expect(result.detail.card.renderState).toBe("blocked");
      expect(result.detail.validationFindings[0].blocksPublication).toBe(true);
      expect(result.detail.recoveryActions.length).toBeGreaterThan(0);
    });
  });

  describe("Pay.sh externally listed detail", () => {
    it("returns detail from an injected catalog with declared pricing metadata", () => {
      const candidate = payShCandidate();
      const result = buildDiscoveryCandidateDetail(`pay-sh:${candidate.candidateId}`, {
        paySh: payShCatalog([candidate]),
      });
      expectCommonInvariants(result);
      expect(result.availability).toBe("found");
      if (result.availability !== "found") return;

      expect(result.detail.matrix).toBeNull();
      const payment = result.detail.sections.find((section) => section.id === "payment");
      expect(payment?.fields.find((entry) => entry.id === "pricing")?.value).toContain("USDC");
      const endpoint = result.detail.sections.find((section) => section.id === "endpoint");
      expect(endpoint?.fields.find((entry) => entry.id === "endpoint-url")?.value).toBe(candidate.serviceUrl);
    });

    it("degrades to source_unavailable when the snapshot artifact is absent (repo default)", () => {
      const result = buildDiscoveryCandidateDetail("pay-sh:anything");
      expectCommonInvariants(result);
      expect(result.availability).toBe("source_unavailable");
    });
  });

  describe("unsupported and malformed ids", () => {
    it("points registry-native ids at the existing /agents/[wallet] detail", () => {
      const result = buildDiscoveryCandidateDetail("rap-registry:SomeWallet111");
      expectCommonInvariants(result);
      expect(result.availability).toBe("unsupported_id");
      if (result.availability === "found") return;
      expect(result.reason).toMatch(/\/agents\/\[wallet\]/);
      expect(result.sourceFacet).toBe("rap-registry");
    });

    it("fails closed on garbage ids without throwing", () => {
      for (const id of ["", "garbage", "::", "weird id with spaces", "%zz"]) {
        const result = buildDiscoveryCandidateDetail(id);
        expectCommonInvariants(result);
        expect(result.availability).toBe("unsupported_id");
      }
    });
  });

  describe("determinism", () => {
    it("produces identical results for identical inputs", () => {
      const cards = [...buildHostedRapCandidateCards(), ...buildArdCatalogCandidateCards()];
      for (const card of cards.slice(0, 6)) {
        const first = buildDiscoveryCandidateDetail(card.id);
        const second = buildDiscoveryCandidateDetail(card.id);
        expect(JSON.parse(JSON.stringify(second))).toEqual(JSON.parse(JSON.stringify(first)));
      }
    });
  });

  describe("no-live boundary", () => {
    it("never emits a guardrail set with any live capability enabled", () => {
      const cards = [...buildHostedRapCandidateCards(), ...buildArdCatalogCandidateCards()];
      for (const card of cards) {
        const result = buildDiscoveryCandidateDetail(card.id);
        expectCommonInvariants(result);
        expect(result.availability).toBe("found");
      }
    });
  });
});
