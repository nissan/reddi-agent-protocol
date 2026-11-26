/**
 * Process-wide sandbox gateway dependencies. Server-side only.
 *
 * The RPC endpoint is devnet by construction, and the gateway also requires the
 * endpoint to report the devnet genesis hash before it accepts a transfer, so an
 * override pointed at another cluster is refused instead of trusted.
 */
import { Connection, type PublicKey } from "@solana/web3.js";
import { transactionFactsReader, type NonceReplayStore } from "@redditech/x402-solana";
import type { SandboxGatewayDeps } from "./gateway";
import { createSandboxSettler, loadSandboxPayeeKeys, type parseSandboxPayeeKeys } from "./settle-signer";
import { defaultBudgetJudge } from "@/lib/budget/page";
import { sandboxBudgetChain, sandboxBudgetSliceStore, type SandboxBudgetDeps } from "./budget-desk";
import { SANDBOX_ESCROW_PROGRAM_ID } from "./escrow";
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
    // A mainnet app holds no provider key (#1203): the keys are never read there, whatever is set.
    const payeeKeys = loadSandboxPayeeKeys();
    deps = {
      connection,
      replayStore: new BoundedReplayStore(),
      readAccount: async (address: PublicKey) => {
        const info = await connection.getAccountInfo(address, "confirmed");
        return info ? { owner: info.owner, data: new Uint8Array(info.data) } : null;
      },
      readSlot: () => connection.getSlot("confirmed"),
      acceptRatedEscrows,
      // Devnet escrow sessions: every call is signed by a session key the payer's wallet delegated.
      acceptMeteredSessions: true,
      // Solana Pay try page (#925): a single call may prove its delegation with a memo in the lock.
      readTransaction: transactionFactsReader(connection),
      settler: createSandboxSettler(
        connection,
        payeeKeys,
        acceptRatedEscrows ? { rateBuyerScore: sellerRatingScore(process.env[SELLER_RATING_SCORE_ENV]) } : {},
      ),
      ...(budget(connection, payeeKeys) ? { budget: budget(connection, payeeKeys) } : {}),
    };
  }
  return deps;
}

/** Pooled Budgets in SOL: needs the shared slice ledger (Supabase) and at least one provider key. */
let budgetDeps: SandboxBudgetDeps | undefined;
function budget(connection: Connection, keys: ReturnType<typeof parseSandboxPayeeKeys>): SandboxBudgetDeps | undefined {
  if (budgetDeps) return budgetDeps;
  const store = sandboxBudgetSliceStore();
  if (!store || keys.size === 0) return undefined;
  const judge = defaultBudgetJudge();
  budgetDeps = {
    chain: sandboxBudgetChain(connection, keys),
    store,
    programId: SANDBOX_ESCROW_PROGRAM_ID,
    acceptedJudges: judge ? [judge] : [],
    log: (event) => console.log(JSON.stringify({ source: "sandbox-budget", ...event })),
  };
  return budgetDeps;
}

/** The sandbox's Budget desk, for the sweep. Undefined while it is not set up. */
export function sandboxBudgetDeps(): SandboxBudgetDeps | undefined {
  return sandboxGatewayDeps().budget;
}

/** The devnet connection the sandbox gateway reads, for the try page's Solana Pay endpoints (#925). */
export function sandboxDevnetConnection(): Connection {
  return sandboxGatewayDeps().connection as unknown as Connection;
}
