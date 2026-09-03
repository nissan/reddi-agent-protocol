import {
  buildCircleX402CandidateCards,
  buildMarketplaceCandidateCards,
} from "@/lib/discovery/marketplace-candidate-cards";
import {
  MARKETPLACE_CANDIDATE_IMPORTED_FIELDS,
  type MarketplaceCandidateSourceFacetId,
} from "@/lib/discovery/source-facets";
import type { CircleX402Catalog } from "@/lib/integrations/source-adapter/circle-x402-catalog";

/**
 * `importedFields` drives which card values the public-claim DOM gate is
 * allowed to skip (`data-claim-scope="external"`). A field wrongly declared
 * imported takes repository-authored copy out of the scan, so these assert the
 * declaration against what the builders actually emit.
 */
describe("marketplace candidate card provenance", () => {
  const result = buildMarketplaceCandidateCards();

  it("gives every card the provenance its source declares", () => {
    expect(result.cards.length).toBeGreaterThan(0);
    for (const card of result.cards) {
      const facet = card.sourceFacet as MarketplaceCandidateSourceFacetId;
      expect(Object.keys(MARKETPLACE_CANDIDATE_IMPORTED_FIELDS)).toContain(facet);
      expect(card.importedFields).toEqual([...MARKETPLACE_CANDIDATE_IMPORTED_FIELDS[facet]]);
    }
  });

  it("gives every hosted-RAP card the same disclosure vocabulary", () => {
    const hosted = result.cards.filter((card) => card.sourceFacet === "hosted-rap" && card.tags.length > 0);
    expect(hosted.length).toBeGreaterThan(0);
    const vocabulary = JSON.stringify(hosted[0].tags);
    for (const card of hosted) {
      expect(JSON.stringify(card.tags)).toBe(vocabulary);
    }
  });

  it("gives every ARD card a media type from the repository origin vocabulary", () => {
    const ard = result.cards.filter((card) => card.sourceFacet === "ard-catalog");
    expect(ard.length).toBeGreaterThan(0);
    for (const card of ard) {
      expect(["static-import", "hosted-rap-registry"]).toContain(card.mediaType);
    }
  });

  it("declares the transcribed fields of an external catalog snapshot as imported", () => {
    const catalog = {
      ok: true,
      sourcePath: "artifacts/circle-x402-discovery/test/resources.json",
      summary: null,
      total: 1,
      returned: 1,
      candidates: [
        {
          candidateId: "circle-test-1",
          source: "circle-x402",
          providerName: "Third Party Provider",
          resource: "https://provider.example/x402/resource",
          category: "data",
          taskTypes: ["summarize"],
          sourceAdapter: {},
          payment: [],
          supportStates: [],
          diagnostics: [],
          attestationState: "externally_listed_unattested",
          trustNotes: [],
        },
      ],
    } as unknown as CircleX402Catalog;

    const { cards } = buildCircleX402CandidateCards(catalog);

    expect(cards).toHaveLength(1);
    expect(cards[0].importedFields).toEqual([...MARKETPLACE_CANDIDATE_IMPORTED_FIELDS["circle-x402"]]);
    expect(cards[0].name).toBe("Third Party Provider");
    expect(cards[0].resourceType).toBe("x402 discovery resource");
  });
});
