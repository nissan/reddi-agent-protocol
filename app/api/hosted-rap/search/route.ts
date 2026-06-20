import {
  marketplaceCatalogSearchQueryFromUrl,
  searchHostedMarketplaceCatalog,
} from "@/lib/manager/marketplace-public-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const query = marketplaceCatalogSearchQueryFromUrl(new URL(req.url));
    return Response.json({
      ok: true,
      result: searchHostedMarketplaceCatalog(query),
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Hosted RAP search failed" },
      { status: 500 },
    );
  }
}
