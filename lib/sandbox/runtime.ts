/**
 * Process-wide sandbox gateway dependencies. Server-side only.
 *
 * The RPC endpoint is devnet by construction, and the gateway also requires the
 * endpoint to report the devnet genesis hash before it accepts a transfer, so an
 * override pointed at another cluster is refused instead of trusted.
 */
import { Connection, type PublicKey } from "@solana/web3.js";
import type { NonceReplayStore } from "@reddi/x402-solana";
import type { SandboxGatewayDeps } from "./gateway";
import { createSandboxSettler, parseSandboxPayeeKeys, SANDBOX_PAYEE_KEYS_ENV } from "./settle-signer";
import { ACCEPT_RATED_ESCROWS_ENV, acceptRatedEscrowsConfigured, SELLER_RATING_SCORE_ENV, sellerRatingScore } from "./seller-rating";

const DEFAULT_DEVNET_RPC = "https://api.devnet.solana.com";
const MAX_REMEMBERED_PAYMENTS = 50_000;

/**
 * Remembers used payments for the life of this server instance. That is enough
 * for a sandbox with no money at stake; V1 uses the durable store instead.
 */
class BoundedReplayStore implements NonceReplayStore {
  private readonly seen = new Set<string>();

  checkAndStore(key: string): boolean {
    if (this.seen.has(key)) return false;
    if (this.seen.size >= MAX_REMEMBERED_PAYMENTS) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    this.seen.add(key);
    return true;
  }
}

let deps: SandboxGatewayDeps | undefined;

export function sandboxGatewayDeps(): SandboxGatewayDeps {
  if (!deps) {
    const rpcUrl = process.env.SANDBOX_DEVNET_RPC_URL?.trim() || DEFAULT_DEVNET_RPC;
    const connection = new Connection(rpcUrl, "confirmed");
    // Off by default: a rated escrow is declined before serving. When the operator turns it on, the
    // provider also commits and reveals its own rating of the buyer, as a seller that settles a rated job must.
    const acceptRatedEscrows = acceptRatedEscrowsConfigured(process.env[ACCEPT_RATED_ESCROWS_ENV]);
    deps = {
      connection,
      replayStore: new BoundedReplayStore(),
      readAccount: async (address: PublicKey) => {
        const info = await connection.getAccountInfo(address, "confirmed");
        return info ? { owner: info.owner, data: new Uint8Array(info.data) } : null;
      },
      readSlot: () => connection.getSlot("confirmed"),
      acceptRatedEscrows,
      settler: createSandboxSettler(
        connection,
        parseSandboxPayeeKeys(process.env[SANDBOX_PAYEE_KEYS_ENV]),
        acceptRatedEscrows ? { rateBuyerScore: sellerRatingScore(process.env[SELLER_RATING_SCORE_ENV]) } : {},
      ),
    };
  }
  return deps;
}
