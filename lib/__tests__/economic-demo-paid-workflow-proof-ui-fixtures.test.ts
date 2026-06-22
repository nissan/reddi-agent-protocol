import {
  getPaidWorkflowProofUiFixturePack,
  PAID_WORKFLOW_PROOF_UI_FIXTURE_PACK_SCHEMA_VERSION,
} from "@/lib/economic-demo/paid-workflow-proof-ui-fixtures";
import { PUBLIC_PROOF_PAGE_DATA_SCHEMA_VERSION } from "@/lib/economic-demo/public-proof-page-data";

describe("economic demo paid workflow proof UI fixture pack", () => {
  it("builds a UI fixture pack that consumes the #417 public proof page data contract", () => {
    const pack = getPaidWorkflowProofUiFixturePack();

    expect(pack.schemaVersion).toBe(PAID_WORKFLOW_PROOF_UI_FIXTURE_PACK_SCHEMA_VERSION);
    expect(pack.consumes.publicProofPageDataSchemaVersion).toBe(PUBLIC_PROOF_PAGE_DATA_SCHEMA_VERSION);
    expect(pack.happyPathCaseId).toBe("pay_sh_sandbox_single_charge_binding_ready");
    expect(pack.cases.map((item) => item.id)).toContain(pack.happyPathCaseId);
    expect(pack.cases.every((item) => item.stateLabels.includes("planned_dry_run"))).toBe(true);
    expect(pack.cases.every((item) => item.stateLabels.includes("devnet_proof_metadata"))).toBe(true);
    expect(pack.cases.every((item) => item.stateLabels.includes("live_gated"))).toBe(true);
    expect(pack.cases.every((item) => item.stateLabels.includes("production_live_disabled"))).toBe(true);
    expect(pack.copyBoundaries.join(" ")).toContain("UI fixtures are deterministic no-network/no-spend data");
  });

  it("covers mobile tablet and desktop fixture expectations for every case", () => {
    const pack = getPaidWorkflowProofUiFixturePack();
    const requiredSections = [
      "quote",
      "budget_ledger",
      "result",
      "receipt",
      "evidence",
      "attestation_preview",
      "reputation_preview",
    ];

    expect(pack.viewports.map((item) => item.viewport)).toEqual(["mobile", "tablet", "desktop"]);
    expect(pack.cases.length).toBeGreaterThanOrEqual(6);
    for (const item of pack.cases) {
      expect(item.viewports.map((viewport) => viewport.viewport)).toEqual(["mobile", "tablet", "desktop"]);
      expect(item.sections.map((section) => section.key)).toEqual(requiredSections);
      expect(item.viewports.every((viewport) => viewport.requiredSections.join("|") === requiredSections.join("|"))).toBe(true);
    }
  });

  it("represents the no-network no-spend happy path with refs and hashes only", () => {
    const pack = getPaidWorkflowProofUiFixturePack();
    const happy = pack.cases.find((item) => item.id === pack.happyPathCaseId);

    expect(happy).toMatchObject({
      status: "no_network_no_spend_happy_path",
      rail: "pay-sh-sandbox",
      supportState: "receipt_binding_candidate",
      paymentProofLabel: "refs_hashes_only",
    });
    expect(happy?.sections.find((section) => section.key === "receipt")).toMatchObject({
      state: "binding_ready",
      primaryLabel: "Receipt binding ready",
    });
    expect(happy?.sections.find((section) => section.key === "evidence")?.refs).toEqual(
      expect.arrayContaining([expect.stringMatching(/^evidence:/), expect.any(String)]),
    );
    expect(JSON.stringify(happy)).not.toContain("rawPrompt");
    expect(JSON.stringify(happy)).not.toContain("providerResponseBody");
  });

  it("keeps blocked variants fail-closed for downstream rendering", () => {
    const pack = getPaidWorkflowProofUiFixturePack();
    const blocked = pack.cases.filter((item) => item.status === "blocked");

    expect(pack.blockedCaseIds.sort()).toEqual([
      "live_path_overclaim_blocked",
      "malformed_receipt_blocked",
      "mpp_tempo_unsupported_network_blocked",
      "policy_denied_blocked",
      "unsupported_asset_network_blocked",
    ]);
    expect(blocked).toHaveLength(5);
    expect(blocked.every((item) => item.paymentProofLabel === "fail_closed")).toBe(true);
    expect(blocked.every((item) => item.blockedBy.length > 0)).toBe(true);
    expect(blocked.every((item) => item.sections.find((section) => section.key === "receipt")?.state === "blocked")).toBe(true);
    expect(JSON.stringify(blocked)).not.toContain("provider call performed");
  });

  it("keeps all live and sensitive boundaries disabled", () => {
    const pack = getPaidWorkflowProofUiFixturePack();

    expect(Object.values(pack.boundaryFlags).every((value) => value === false)).toBe(true);
    expect(pack.cases.every((item) => Object.values(item.boundaryFlags).every((value) => value === false))).toBe(true);
    expect(pack.cases.every((item) => item.sections.find((section) => section.key === "attestation_preview")?.state === "draft")).toBe(true);
    expect(pack.cases.every((item) => item.sections.find((section) => section.key === "reputation_preview")?.primaryLabel === "No mutation")).toBe(true);
  });
});
