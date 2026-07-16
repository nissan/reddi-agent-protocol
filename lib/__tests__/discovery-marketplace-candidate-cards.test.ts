import { SOURCE_TRUST_STATES } from "@reddi/agent-protocol/source-trust-conformance-matrix";

import {
  buildArdCatalogCandidateCards,
  buildCircleX402CandidateCards,
  buildHostedRapCandidateCards,
  buildMarketplaceCandidateCards,
  buildPayShCandidateCards,
  MARKETPLACE_CANDIDATE_CARDS_SCHEMA_VERSION,
} from "@/lib/discovery/marketplace-candidate-cards";
import type { CircleX402Catalog } from "@/lib/integrations/source-adapter/circle-x402-catalog";
import type { PayShCatalog } from "@/lib/integrations/source-adapter/pay-sh-catalog";
import type { ReddiCircleX402Candidate } from "@/lib/integrations/source-adapter/profiles/circle-x402";
import type { ReddiPayShCandidate } from "@/lib/integrations/source-adapter/profiles/pay-sh";

jest.mock("@/lib/registry/bridge", () => {
  throw new Error("live registry bridge must not be imported by marketplace candidate cards");
});

jest.mock("@solana/web3.js", () => {
  throw new Error("Solana RPC helpers must not be imported by marketplace candidate cards");
});

const TRUST_STATES: readonly string[] = SOURCE_TRUST_STATES;

function circleCandidate(overrides: Partial<ReddiCircleX402Candidate> = {}): ReddiCircleX402Candidate {
  return {
    candidateId: "circle-x402:fixture-provider",
    source: "circle-x402",
    providerName: "Fixture Provider",
    resource: "https://example.com/api/insights",
    category: "WEB_SEARCH_RESEARCH",
    taskTypes: ["research", "web-search"],
    sourceAdapter: { source: "circle-x402", version: "test" } as ReddiCircleX402Candidate["sourceAdapter"],
    payment: [],
    supportStates: ["discovery_visible", "externally_listed_unattested", "live_payment_disabled"],
    diagnostics: [],
    attestationState: "externally_listed_unattested",
    trustNotes: [],
    ...overrides,
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

describe("marketplace candidate cards (#381)", () => {
  describe("hosted RAP registry cards (#369 search + #577 hosted matrix)", () => {
    const cards = buildHostedRapCandidateCards();

    it("builds a card per hosted search result plus blocked export records", () => {
      expect(cards.length).toBeGreaterThan(0);
      expect(cards.every((card) => card.sourceFacet === "hosted-rap")).toBe(true);
      expect(cards.some((card) => card.renderState === "blocked")).toBe(true);
      expect(cards.some((card) => card.renderState === "untrusted")).toBe(true);
    });

    it("drives trust and readiness from the #577 matrix and #593 vocabulary", () => {
      for (const card of cards) {
        expect(TRUST_STATES).toContain(card.trust.state);
        expect(card.trust.label.length).toBeGreaterThan(0);
        expect(card.readiness.label.length).toBeGreaterThan(0);
        expect(card.trustBoundaryNote.length).toBeGreaterThan(0);
      }
      const listed = cards.filter((card) => card.renderState === "untrusted");
      for (const card of listed) {
        // Hosted listings are never trusted at discovery; hire stays gated.
        expect(["claimed", "unverified"]).toContain(card.trust.state);
        expect(card.readiness.state).toBe("live_gated");
        expect(card.reasonCodes).toContain("not_rap_attested");
      }
    });

    it("marks blocked export records blocked in both trust and readiness", () => {
      const blocked = cards.filter((card) => card.renderState === "blocked");
      for (const card of blocked) {
        expect(card.trust.state).toBe("blocked");
        expect(card.readiness.state).toBe("blocked");
        expect(card.reasonCodes.length).toBeGreaterThan(0);
      }
    });
  });

  describe("ARD / AI Catalog static-stack cards (#383 fixtures + #577 matrix)", () => {
    const cards = buildArdCatalogCandidateCards();

    it("renders imported and blocked/malformed fixtures distinctly", () => {
      expect(cards.length).toBeGreaterThan(0);
      expect(cards.every((card) => card.sourceFacet === "ard-catalog")).toBe(true);
      expect(cards.some((card) => card.renderState === "ard-imported")).toBe(true);
      expect(cards.some((card) => card.renderState === "blocked")).toBe(true);
    });

    it("maps malformed-connector fixtures to failed_verification / blocked", () => {
      const blocked = cards.filter((card) => card.renderState === "blocked");
      expect(blocked.length).toBeGreaterThan(0);
      expect(
        blocked.some(
          (card) => card.trust.state === "failed_verification" || card.trust.state === "blocked",
        ),
      ).toBe(true);
    });

    it("keeps non-blocked imports untrusted and short of any live-ready state", () => {
      const imported = cards.filter((card) => card.renderState === "ard-imported");
      expect(imported.length).toBeGreaterThan(0);
      for (const card of imported) {
        expect(TRUST_STATES).toContain(card.trust.state);
        expect(card.trust.state).not.toBe("trusted");
        // #577 actionability lane: never blocked here, and never a state that
        // implies live invocation is available.
        expect(["dry_run_ready", "needs_human_review", "live_gated"]).toContain(card.readiness.state);
        expect(card.mediaType).toBe("static-import");
      }
    });
  });

  describe("Circle x402 cards", () => {
    it("maps the legacy externally_listed_unattested literal to listed_untrusted", () => {
      const catalog: CircleX402Catalog = {
        ok: true,
        sourcePath: "fixture",
        summary: null,
        candidates: [circleCandidate()],
        total: 1,
        returned: 1,
      };
      const { cards, availability } = buildCircleX402CandidateCards(catalog);
      expect(availability.available).toBe(true);
      expect(cards).toHaveLength(1);
      expect(cards[0].sourceFacet).toBe("circle-x402");
      expect(cards[0].trust.state).toBe("listed_untrusted");
      expect(cards[0].renderState).toBe("untrusted");
      expect(cards[0].readiness.state).toBe("live_gated");
    });

    it("renders blocker diagnostics as blocked cards", () => {
      const catalog: CircleX402Catalog = {
        ok: true,
        sourcePath: "fixture",
        summary: null,
        candidates: [
          circleCandidate({
            candidateId: "circle-x402:malformed",
            diagnostics: [
              { code: "malformed_resource", severity: "blocker", detail: "malformed resource entry" },
            ],
          }),
        ],
        total: 1,
        returned: 1,
      };
      const { cards } = buildCircleX402CandidateCards(catalog);
      expect(cards[0].renderState).toBe("blocked");
      expect(cards[0].readiness.state).toBe("blocked");
      expect(cards[0].reasonCodes).toContain("malformed_resource");
    });

    it("degrades to an explicit no-candidates availability note when the snapshot is absent", () => {
      const catalog: CircleX402Catalog = {
        ok: false,
        sourcePath: "artifacts/circle-x402-discovery/20260513-iteration1/resources.json",
        summary: null,
        candidates: [],
        total: 0,
        returned: 0,
        error: "Circle x402 ingest artifact not found",
      };
      const { cards, availability } = buildCircleX402CandidateCards(catalog);
      expect(cards).toHaveLength(0);
      expect(availability.available).toBe(false);
      expect(availability.note).toMatch(/not found/i);
    });
  });

  describe("Pay.sh cards", () => {
    it("maps candidates onto the #593 vocabulary with blocked diagnostics distinct", () => {
      const catalog: PayShCatalog = {
        ok: true,
        sourcePath: "fixture",
        summary: null,
        candidates: [
          payShCandidate(),
          payShCandidate({
            candidateId: "pay-sh:unsafe",
            diagnostics: [
              { code: "unsafe_category_use_case", severity: "blocker", detail: "unsafe category" },
            ],
          }),
        ],
        total: 2,
        returned: 2,
      };
      const { cards } = buildPayShCandidateCards(catalog);
      expect(cards).toHaveLength(2);
      expect(cards[0].trust.state).toBe("listed_untrusted");
      expect(cards[0].renderState).toBe("untrusted");
      expect(cards[1].renderState).toBe("blocked");
      expect(cards[1].reasonCodes).toContain("unsafe_category_use_case");
    });
  });

  describe("combined read model", () => {
    const result = buildMarketplaceCandidateCards();

    it("aggregates all fixture-backed sources with availability notes", () => {
      expect(result.schemaVersion).toBe(MARKETPLACE_CANDIDATE_CARDS_SCHEMA_VERSION);
      expect(result.cards.length).toBeGreaterThan(0);
      const facets = result.sources.map((source) => source.facet);
      expect(facets).toEqual(["hosted-rap", "ard-catalog", "circle-x402", "pay-sh"]);
      for (const source of result.sources) {
        expect(source.note.length).toBeGreaterThan(0);
      }
    });

    it("keeps every live boundary hard-disabled", () => {
      expect(result.guardrails).toEqual({
        endpointInvocation: false,
        walletSigning: false,
        rpcCall: false,
        livePayment: false,
        publication: false,
        trustMutation: false,
        reputationMutation: false,
      });
      expect(result.trustBoundary.docRef).toBe("docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md");
    });

    it("never emits a trust state outside the #593 vocabulary or a legacy adapter literal", () => {
      for (const card of result.cards) {
        expect(TRUST_STATES).toContain(card.trust.state);
        expect(JSON.stringify(card)).not.toContain("externally_listed_unattested");
      }
    });

    it("is deterministic for fixture-backed sources", () => {
      const again = buildMarketplaceCandidateCards();
      expect(again.cards.map((card) => card.id)).toEqual(result.cards.map((card) => card.id));
    });
  });
});
