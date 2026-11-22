/**
 * Server-held devnet provider keys for the sandbox's metered settle. Server-side only.
 *
 * Owner decision, 21 November 2026: sandbox providers settle with devnet-only
 * keys the server holds, so a visitor approves one lock and the provider
 * settles the actual cost after the answer, as a real provider would.
 *
 * The keys come from `SANDBOX_DEVNET_PAYEE_KEYS`, a JSON object mapping a
 * sandbox provider id to its secret key as the 64-number array solana-keygen
 * writes. They hold devnet SOL only. A key whose public address is not the
 * catalog's payTo for that provider is ignored, so a misconfigured key can
 * never settle to a wallet the page did not show.
 */
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { SANDBOX_PROVIDERS } from "./catalog";
import { buildSandboxSettle, SANDBOX_ESCROW_PROGRAM_ID } from "./escrow";
import { advanceSellerRating, type SellerRatingConnection } from "./seller-rating";
import { isDevnetConnection } from "@/lib/sandbox/devnet-genesis";

export type SandboxSettleInput = {
  providerId: string;
  escrow: PublicKey;
  payer: PublicKey;
  payee: PublicKey;
  actualLamports: bigint;
  /** The escrow is opted in to rating, so the settle must pass its rating account. */
  rated?: boolean;
  /** For a rated escrow, the rating's opened slot read with the lock: the settle names this job. */
  openedSlot?: bigint;
};
export type SandboxSettleResult = { ok: true; signature: string } | { ok: false; message: string };

export interface SandboxSettler {
  /** True when the server holds this provider's devnet key. */
  canSettle(providerId: string): boolean;
  settle(input: SandboxSettleInput): Promise<SandboxSettleResult>;
}

export const SANDBOX_PAYEE_KEYS_ENV = "SANDBOX_DEVNET_PAYEE_KEYS";

/** Parses the env value into keypairs per provider, keeping only keys that match the catalog. */
export function parseSandboxPayeeKeys(raw: string | undefined): Map<string, Keypair> {
  const keys = new Map<string, Keypair>();
  if (!raw?.trim()) return keys;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return keys;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return keys;
  for (const provider of SANDBOX_PROVIDERS) {
    const secret = (parsed as Record<string, unknown>)[provider.id];
    if (!Array.isArray(secret) || secret.length !== 64 || !secret.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) continue;
    try {
      const keypair = Keypair.fromSecretKey(Uint8Array.from(secret as number[]));
      if (keypair.publicKey.toBase58() === provider.payTo) keys.set(provider.id, keypair);
    } catch {
      // Not a valid Ed25519 secret key: skipped.
    }
  }
  return keys;
}

export interface SandboxSettlerOptions {
  /**
   * After settling a rated escrow, commit the provider's rating of the buyer with this score
   * (`seller-rating.ts`). Set only when the sandbox accepts rated escrows. The commit is best
   * effort here: the scheduled sweep commits what this missed, and reveals later.
   */
  rateBuyerScore?: number;
}

export function createSandboxSettler(connection: Connection, keys: Map<string, Keypair>, options: SandboxSettlerOptions = {}): SandboxSettler {
  return {
    canSettle: (providerId) => keys.has(providerId),
    async settle(input) {
      const keypair = keys.get(input.providerId);
      if (!keypair || !keypair.publicKey.equals(input.payee)) return { ok: false, message: "This provider cannot settle on devnet right now." };
      if (!(await isDevnetConnection(connection))) return { ok: false, message: "The sandbox settles on devnet only, and the server RPC is not devnet." };
      try {
        const latest = await connection.getLatestBlockhash("confirmed");
        const transaction = new Transaction({ feePayer: keypair.publicKey, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }).add(
          buildSandboxSettle({ escrow: input.escrow, payer: input.payer, payee: input.payee, actualLamports: input.actualLamports, rated: input.rated === true, openedSlot: input.openedSlot }),
        );
        transaction.sign(keypair);
        const signature = await connection.sendRawTransaction(transaction.serialize(), { preflightCommitment: "confirmed" });
        const confirmation = await connection.confirmTransaction({ signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, "confirmed");
        if (confirmation.value.err) return { ok: false, message: "The settle transaction failed on devnet." };
        if (input.rated === true && options.rateBuyerScore !== undefined) {
          // The settle opened the rating. A failure here never fails the settle that already landed.
          await advanceSellerRating({ connection: connection as unknown as SellerRatingConnection, programId: SANDBOX_ESCROW_PROGRAM_ID, escrow: input.escrow, keypair, score: options.rateBuyerScore });
        }
        return { ok: true, signature };
      } catch {
        return { ok: false, message: "The settle transaction could not be sent to devnet." };
      }
    },
  };
}
