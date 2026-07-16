import {
  SOURCE_TRUST_BOUNDARIES_DOC_REF,
  SOURCE_TRUST_STATES,
} from "@reddi/agent-protocol/source-trust-conformance-matrix";

import {
  DISCOVERY_SOURCE_BOUNDARY,
  SOURCE_TRUST_STATE_VALUES,
  DISCOVERY_SOURCE_FACET_IDS,
  DISCOVERY_SOURCE_FACETS,
  classifySpecialistListingSourceFacet,
  describeDiscoverySourceFacet,
  describeSourceTrustState,
  isDiscoverySourceFacetId,
  mapAdapterAttestationStateToSourceTrustState,
  parseDiscoverySourceFacetParam,
  serializeDiscoverySourceFacetParam,
  sourceTrustStateFromLaneState,
} from "@/lib/discovery/source-facets";

jest.mock("@/lib/registry/bridge", () => {
  throw new Error("server-only registry bridge must not be imported by the source-facet vocabulary");
});

jest.mock("@solana/web3.js", () => {
  throw new Error("Solana RPC helpers must not be imported by the source-facet vocabulary");
});

describe("discovery source facets (#381)", () => {
  it("covers every source class required by the issue", () => {
    expect(DISCOVERY_SOURCE_FACET_IDS).toEqual([
      "rap-registry",
      "ard-catalog",
      "circle-x402",
      "pay-sh",
      "openrouter",
      "local-demo",
      "hosted-rap",
    ]);
    for (const facet of DISCOVERY_SOURCE_FACETS) {
      expect(facet.label.length).toBeGreaterThan(0);
      expect(facet.description.length).toBeGreaterThan(0);
      expect(describeDiscoverySourceFacet(facet.id)).toEqual(facet);
    }
  });

  describe("URL-addressable filter state", () => {
    it("round-trips the CSV source param in stable facet order", () => {
      const serialized = serializeDiscoverySourceFacetParam(["hosted-rap", "rap-registry"]);
      expect(serialized).toBe("rap-registry,hosted-rap");
      expect(parseDiscoverySourceFacetParam(serialized)).toEqual(["rap-registry", "hosted-rap"]);
    });

    it("drops unknown facet ids, whitespace, and duplicates when parsing", () => {
      expect(
        parseDiscoverySourceFacetParam(" circle-x402 , not-a-source, circle-x402,PAY-SH "),
      ).toEqual(["circle-x402", "pay-sh"]);
      expect(parseDiscoverySourceFacetParam(null)).toEqual([]);
      expect(parseDiscoverySourceFacetParam("")).toEqual([]);
    });

    it("validates facet ids", () => {
      expect(isDiscoverySourceFacetId("openrouter")).toBe(true);
      expect(isDiscoverySourceFacetId("registry")).toBe(false);
    });
  });

  describe("#593 vocabulary reuse (no new trust words)", () => {
    it("mirrors the canonical #593 vocabulary exactly (no drift, no new words)", () => {
      expect(SOURCE_TRUST_STATE_VALUES).toEqual(SOURCE_TRUST_STATES);
      expect(DISCOVERY_SOURCE_BOUNDARY.docRef).toBe(SOURCE_TRUST_BOUNDARIES_DOC_REF);
    });

    it("maps the legacy adapter literal externally_listed_unattested to listed_untrusted", () => {
      expect(mapAdapterAttestationStateToSourceTrustState("externally_listed_unattested")).toBe(
        "listed_untrusted",
      );
    });

    it("passes through finalized #593 states and fails closed on unknown input", () => {
      for (const state of SOURCE_TRUST_STATES) {
        expect(mapAdapterAttestationStateToSourceTrustState(state)).toBe(state);
      }
      expect(mapAdapterAttestationStateToSourceTrustState("totally_new_state")).toBe("listed_untrusted");
      expect(mapAdapterAttestationStateToSourceTrustState("")).toBe("listed_untrusted");
    });

    it("only ever describes states from the #593 vocabulary", () => {
      for (const state of SOURCE_TRUST_STATES) {
        const badge = describeSourceTrustState(state);
        expect(badge.state).toBe(state);
        expect(badge.label.length).toBeGreaterThan(0);
        expect(["neutral", "caution", "negative", "positive"]).toContain(badge.tone);
      }
      expect(describeSourceTrustState("trusted").tone).toBe("positive");
      expect(describeSourceTrustState("blocked").tone).toBe("negative");
      expect(describeSourceTrustState("listed_untrusted").tone).toBe("caution");
    });

    it("maps #577 lane states onto #593 trust states, failing closed to listed_untrusted", () => {
      expect(sourceTrustStateFromLaneState("verified")).toBe("trusted");
      expect(sourceTrustStateFromLaneState("claimed")).toBe("claimed");
      expect(sourceTrustStateFromLaneState("self_asserted")).toBe("unverified");
      expect(sourceTrustStateFromLaneState("failed_verification")).toBe("failed_verification");
      expect(sourceTrustStateFromLaneState("blocked")).toBe("blocked");
      expect(sourceTrustStateFromLaneState("production_disabled")).toBe("blocked");
      expect(sourceTrustStateFromLaneState("needs_human_review")).toBe("needs_human_review");
      expect(sourceTrustStateFromLaneState("unavailable")).toBe("listed_untrusted");
      expect(sourceTrustStateFromLaneState("dry_run_ready")).toBe("listed_untrusted");
      expect(sourceTrustStateFromLaneState("live_gated")).toBe("listed_untrusted");
    });
  });

  describe("registry listing classification", () => {
    it("classifies on-chain listings as rap-registry", () => {
      expect(
        classifySpecialistListingSourceFacet({ pda: "SomePda1111", capabilities: null }),
      ).toBe("rap-registry");
    });

    it("classifies index-only listings as local-demo", () => {
      expect(classifySpecialistListingSourceFacet({ pda: "", capabilities: null })).toBe("local-demo");
    });

    it("classifies OpenRouter-bridged profiles by control loop", () => {
      expect(
        classifySpecialistListingSourceFacet({
          pda: "",
          capabilities: {
            agent_composition: { control_loop: "openrouter-x402-specialist-runtime" },
          },
        }),
      ).toBe("openrouter");
    });

    it("classifies OpenRouter-bridged profiles by openrouter: agent calls even when on-chain", () => {
      expect(
        classifySpecialistListingSourceFacet({
          pda: "SomePda1111",
          capabilities: {
            manifest: { non_marketplace_agent_calls: ["openrouter:anthropic/claude-sonnet-4"] },
          },
        }),
      ).toBe("openrouter");
    });
  });

  it("carries the discovery/trust boundary copy anchored to the boundaries doc", () => {
    expect(DISCOVERY_SOURCE_BOUNDARY.docRef).toBe("docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md");
    expect(DISCOVERY_SOURCE_BOUNDARY.note).toMatch(/never RAP trust/i);
    expect(DISCOVERY_SOURCE_BOUNDARY.note).toMatch(/no paid call, wallet action, or endpoint invocation/i);
  });
});
