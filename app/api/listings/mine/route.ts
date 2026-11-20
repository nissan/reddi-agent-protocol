import { authenticateWalletRequest } from "@/lib/auth/wallet-session";
import { readOwnListing } from "@/lib/listings/listing-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/listings/mine: the signed-in wallet's own listing in any status, or null. */
export async function GET(req: Request) {
  const session = await authenticateWalletRequest(req.headers);
  if (!session.ok) {
    return Response.json({ ok: false, error: { code: session.code, message: session.message } }, { status: session.status });
  }
  const result = await readOwnListing(session.wallet);
  if (!result.ok) {
    return Response.json({ ok: false, error: { code: result.code, message: result.message } }, { status: result.status });
  }
  return Response.json({ ok: true, listing: result.listing });
}
