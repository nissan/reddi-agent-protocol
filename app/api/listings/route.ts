import { authenticateWalletRequest } from "@/lib/auth/wallet-session";
import { resolveNetworkProfileName } from "@/lib/config/network";
import { listingAdl } from "@/lib/listings/listing-adl";
import { listingNetworkForProfile, readPublicListings, saveOwnListing, validateListingInput } from "@/lib/listings/listing-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function refusal(status: number, code: string, message: string) {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

/** GET /api/listings: the listed providers on this deployment's network. Public. */
export async function GET() {
  const network = listingNetworkForProfile(resolveNetworkProfileName());
  if (!network) return refusal(503, "network_not_supported", "Listings are not available on this network profile.");
  const result = await readPublicListings(network);
  if (!result.ok) return refusal(result.status, result.code, result.message);
  return Response.json({ ok: true, network, listings: result.listings });
}

/**
 * PUT /api/listings: create or update the signed-in wallet's own listing.
 * The wallet, the owner and the network are taken from the checked session and
 * the server's profile. Anything the body says about them is ignored.
 * `adl` is the provider's ADL v0.3 document as text: it must pass Level 3 and
 * match the listing. Without one, the server makes one from the listing.
 */
export async function PUT(req: Request) {
  const session = await authenticateWalletRequest(req.headers);
  if (!session.ok) return refusal(session.status, session.code, session.message);
  const network = listingNetworkForProfile(resolveNetworkProfileName());
  if (!network) return refusal(503, "network_not_supported", "Listings are not available on this network profile.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return refusal(400, "invalid_listing", "Send the listing as a JSON object.");
  }
  const checked = validateListingInput(body);
  if (!checked.ok) return refusal(checked.status, checked.code, checked.message);

  const adl = listingAdl(checked.input, (body as Record<string, unknown>).adl, { wallet: session.wallet, network });
  if (!adl.ok) return refusal(400, "invalid_adl", adl.message);

  const saved = await saveOwnListing({ userId: session.userId, wallet: session.wallet }, checked.input, { adl: adl.adl, source: adl.source }, network);
  if (!saved.ok) return refusal(saved.status, saved.code, saved.message);
  return Response.json({ ok: true, listing: saved.listing });
}
