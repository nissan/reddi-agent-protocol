import { getFixtureBackedMarketplacePublicExportSnapshot } from "@/lib/manager/marketplace-public-export-fixtures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const snapshot = getFixtureBackedMarketplacePublicExportSnapshot();
    return Response.json(snapshot.aiCatalog);
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "AI Catalog export failed" },
      { status: 500 },
    );
  }
}
