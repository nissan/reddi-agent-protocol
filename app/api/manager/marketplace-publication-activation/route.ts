import { deriveMarketplacePublicationActivationGate } from "@/lib/manager/marketplace-publication-activation";
import { getFixtureBackedMarketplacePublicExportSnapshot } from "@/lib/manager/marketplace-public-export-fixtures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const fixtureTimestamp = "2026-06-20T00:00:00Z";

export async function GET() {
  try {
    const exportSnapshot = getFixtureBackedMarketplacePublicExportSnapshot();
    const exportItem = exportSnapshot.exported[0];
    if (!exportItem) {
      return Response.json(
        { ok: false, error: "No eligible fixture export is available for dry-run activation" },
        { status: 409 },
      );
    }

    const result = deriveMarketplacePublicationActivationGate({
      id: "activation:approve-ready:dry-run",
      exportItem,
      activationApproval: {
        approved: true,
        approvedBy: "operator:fixture",
        approvedAt: fixtureTimestamp,
        evidenceRef: "evidence:activation:approve-ready",
        activationIntentRef: "evidence:activation-intent:approve-ready",
        operatorApprovalRef: "evidence:operator-approval:approve-ready",
        publicationAuditEvidenceRef: "evidence:operator-action:publish",
      },
      requestedAt: fixtureTimestamp,
    });

    return Response.json({
      ok: result.status === "dry_run_ready",
      result,
      guardrails: {
        readOnly: true,
        fixtureBacked: true,
        dryRunOnly: true,
        livePublication: false,
        livePayment: false,
        hostedRegistryWrite: false,
        walletSigning: false,
        rpcProbe: false,
        mcpCall: false,
        providerCall: false,
        reputationAssignment: false,
      },
    }, { status: result.status === "dry_run_ready" ? 200 : 409 });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Marketplace publication activation failed" },
      { status: 500 },
    );
  }
}
