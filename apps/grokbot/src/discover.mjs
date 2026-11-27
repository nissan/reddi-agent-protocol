// Finding the team: the app's public listings on devnet, filtered by the task type each role needs, then
// each candidate's own price offer (the 402 its paid endpoint answers with), checked against the listing.
import { ROLES, ROLE_NAMES } from "./plan.mjs";

export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

/** Listed devnet providers per role, healthy first. */
export async function listCandidates(appUrl, fetchImpl = fetch) {
  const response = await fetchImpl(`${appUrl.replace(/\/+$/, "")}/api/listings`, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`the app's listings answered ${response.status}`);
  const body = await response.json();
  if (body?.network !== "solana-devnet" || !Array.isArray(body.listings)) throw new Error("the app did not return devnet listings");
  return candidatesFrom(body.listings);
}

export function candidatesFrom(listings) {
  const out = {};
  for (const role of ROLE_NAMES) {
    out[role] = listings
      .filter((l) => l?.status === "listed" && l.priceMint === DEVNET_USDC && typeof l.endpointUrl === "string" && l.endpointUrl.startsWith("https://"))
      .filter((l) => Array.isArray(l.capabilities?.taskTypes) && l.capabilities.taskTypes.includes(ROLES[role].taskType))
      .sort((a, b) => Number(b.healthStatus === "pass") - Number(a.healthStatus === "pass") || Number(BigInt(a.priceOutputPerMillionBaseUnits) - BigInt(b.priceOutputPerMillionBaseUnits)));
    if (!out[role].length) throw new Error(`no listed devnet provider does ${ROLES[role].taskType}`);
  }
  return out;
}

/** The provider's Budget offer, from the 402 to an unpaid call; refuses one that does not match its listing. */
export async function readOffer(listing, judge, fetchImpl = fetch) {
  const response = await fetchImpl(`${listing.endpointUrl.replace(/\/+$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: '{"action":"status","task":"t_0000000000000000"}' }], max_tokens: 1 }),
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status !== 402) throw new Error(`${listing.displayName} answered ${response.status} to an unpaid call, not a price`);
  const quote = await response.json();
  return checkOffer(listing, quote, judge);
}

export function checkOffer(listing, quote, judge) {
  const offer = quote?.budget;
  const name = listing.displayName;
  if (offer?.scheme !== "budget") throw new Error(`${name} takes no Budgets`);
  if (offer.network !== DEVNET_GENESIS) throw new Error(`${name} is not on devnet`);
  if (offer.mint !== DEVNET_USDC) throw new Error(`${name} is not priced in devnet USDC`);
  if (offer.payee !== listing.wallet) throw new Error(`${name}'s offer pays ${offer.payee}, not its listed wallet`);
  if (!Array.isArray(offer.acceptedJudges) || !offer.acceptedJudges.includes(judge)) throw new Error(`${name} does not accept the RAP judge`);
  // The slices are planned from the listed price; the slice is also the most a provider can take.
  return { offer, outputPerMillion: BigInt(listing.priceOutputPerMillionBaseUnits) };
}
