import { GET } from "@/app/api/economic-demo/public-proof-page-data/route";
import {
  getPublicProofPageData,
  PUBLIC_PROOF_PAGE_DATA_SCHEMA_VERSION,
} from "@/lib/economic-demo/public-proof-page-data";

describe("economic demo public proof page data", () => {
  it("builds the public proof page contract with quote policy preflight and proof labels", () => {
    const data = getPublicProofPageData();

    expect(data.schemaVersion).toBe(PUBLIC_PROOF_PAGE_DATA_SCHEMA_VERSION);
    expect(data.scenarioId).toBe("webpage");
    expect(data.quote).toMatchObject({
      currency: "USDC",
      totalUsdc: 3.33125,
      protocolRailFeeBps: 5,
    });
    expect(data.policyDecision).toMatchObject({
      status: "allowed_fixture_only",
      reasonCodes: expect.arrayContaining(["fixture_only", "no_live_payment"]),
    });
    expect(data.auddPaymentPlanPreflight).toMatchObject({
      status: "allowed_fixture_only",
      paymentMode: "dry-run",
      evidenceRequired: true,
    });
    expect(data.stateLabels).toEqual(
      expect.arrayContaining([
        "fixture_zero_spend",
        "planned_dry_run",
        "simulated",
        "devnet_proof_metadata",
        "live_gated",
        "production_live_disabled",
      ]),
    );
  });

  it("surfaces only sanitized rail-neutral proof-chain refs and fail-closed states", () => {
    const data = getPublicProofPageData();
    const bindingReady = data.railNeutralProofChain.cases.find((item) => item.case === "pay_sh_sandbox_single_charge_binding");

    expect(bindingReady).toMatchObject({
      status: "binding_ready",
      sourceRef: {
        rail: "pay-sh-sandbox",
      },
      payment: {
        network: "solana-devnet",
        asset: "USDC",
      },
      receipt: {
        attestationStatus: "not_requested",
        supportState: "receipt_binding_candidate",
      },
    });
    expect(bindingReady?.bindingRefs).toEqual(
      expect.objectContaining({
        paymentProofRef: expect.any(String),
        requestHash: expect.any(String),
        responseHash: expect.any(String),
        evidenceRef: expect.any(String),
        nonceRef: expect.any(String),
        recipientRef: expect.any(String),
        operatorApprovalRef: expect.any(String),
      }),
    );
    expect(bindingReady).not.toHaveProperty("evidenceArchive.evidencePayload");

    expect(data.railNeutralProofChain.blockedCases.sort()).toEqual([
      "live_path_overclaim",
      "malformed_receipt",
      "mpp_tempo_unsupported_network",
      "policy_denied",
      "unsupported_asset_network",
    ]);
    expect(
      data.railNeutralProofChain.cases
        .filter((item) => item.status === "blocked")
        .every((item) => item.blockedBy.length > 0 && !JSON.stringify(item).includes("provider call performed")),
    ).toBe(true);
  });

  it("keeps public copy and machine flags closed for live payment settlement custody trust and reputation", () => {
    const data = getPublicProofPageData();

    expect(data.copyBoundaries.join(" ")).toContain("No AUDD is settled, escrowed, or held in Quasar custody");
    expect(Object.values(data.boundaryFlags).every((value) => value === false)).toBe(true);
    expect(data.railNeutralProofChain.cases.every((item) => Object.values(item.boundaryFlags).every((value) => value === false))).toBe(true);
    expect(data.attestationDraft).toMatchObject({
      status: "draft_only",
      result: "not_submitted",
    });
    expect(data.reputationDraft).toMatchObject({
      status: "draft_only",
      mutationAllowed: false,
      commitTx: null,
      revealTx: null,
    });
    expect(data.sourceListingRefs.dryRunPlan).toMatchObject({
      orchestratorProfileId: "agentic-workflow-system",
      downstreamCallsExecuted: 0,
    });
  });

  it("serves the same data contract from the read-only API route", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      schemaVersion: PUBLIC_PROOF_PAGE_DATA_SCHEMA_VERSION,
      railNeutralProofChain: {
        bindingReadyCase: "pay_sh_sandbox_single_charge_binding",
      },
    });
  });
});
