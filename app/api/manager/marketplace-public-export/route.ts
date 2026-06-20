import { getFixtureBackedMarketplacePublicExportSnapshot } from "@/lib/manager/marketplace-public-export-fixtures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const result = getFixtureBackedMarketplacePublicExportSnapshot();
    return Response.json({
      ok: true,
      result,
      guardrails: {
        readOnly: true,
        fixtureBacked: true,
        livePublication: false,
        livePayment: false,
        walletSigning: false,
        rpcProbe: false,
        mcpCall: false,
        providerCall: false,
        reputationAssignment: false,
      },
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Marketplace public export failed" },
      { status: 500 },
    );
  }
}
