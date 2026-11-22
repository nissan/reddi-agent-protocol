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
  /** The escrow's lock slot, read with the lock: the settle names this escrow by it (a rated job's opened slot is the same slot). */
  createdSlot: bigint;
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

export const SETTLE_CONFIRM_POLL_MS = 500;

/**
 * Waits for `confirmed` by asking for the signature's status over HTTP.
 * `Connection.confirmTransaction` waits on a websocket subscription and checks
 * the status only once that subscription is up; from a serverless function the
 * devnet websocket often fails to connect, which left the answer waiting until
 * the blockhash expired (about a minute) before giving up.
 */
export async function confirmByPolling(
  connection: Pick<Connection, "getSignatureStatuses" | "getBlockHeight">,
  signature: string,
  lastValidBlockHeight: number,
  options: { pollMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<"confirmed" | "failed"> {
  const pollMs = options.pollMs ?? SETTLE_CONFIRM_POLL_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (;;) {
    const { value } = await connection.getSignatureStatuses([signature]);
    const status = value[0];
    if (status?.err) return "failed";
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return "confirmed";
    if ((await connection.getBlockHeight("confirmed")) > lastValidBlockHeight) {
      // One last look: it may have landed in the final valid block.
      const last = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
      if (last && !last.err && (last.confirmationStatus === "confirmed" || last.confirmationStatus === "finalized")) return "confirmed";
      throw new Error("The settle transaction expired before it confirmed.");
    }
    await sleep(pollMs);
  }
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
          buildSandboxSettle({ escrow: input.escrow, payer: input.payer, payee: input.payee, actualLamports: input.actualLamports, rated: input.rated === true, createdSlot: input.createdSlot }),
        );
        transaction.sign(keypair);
        const signature = await connection.sendRawTransaction(transaction.serialize(), { preflightCommitment: "confirmed" });
        const confirmation = await confirmByPolling(connection, signature, latest.lastValidBlockHeight);
        if (confirmation === "failed") return { ok: false, message: "The settle transaction failed on devnet." };
        if (input.rated === true && options.rateBuyerScore !== undefined) {
          // The settle opened the rating. A failure here never fails the settle that already landed.
          await advanceSellerRating({ connection: connection as unknown as SellerRatingConnection, programId: SANDBOX_ESCROW_PROGRAM_ID, escrow: input.escrow, keypair, score: options.rateBuyerScore });
        }
        return { ok: true, signature };
      } catch (error) {
        // Say why in the server log: the page's message stays generic, but a refused settle
        // (a program error in preflight) and a busy RPC need different fixes. Public data only.
        const logs = (error as { logs?: unknown }).logs;
        console.error("[sandbox-settle] settle not sent", {
          provider: input.providerId,
          escrow: input.escrow.toBase58(),
          error: error instanceof Error ? error.message : String(error),
          ...(Array.isArray(logs) ? { logs: logs.slice(-8) } : {}),
        });
        return { ok: false, message: "The settle transaction could not be sent to devnet." };
      }
    },
  };
}
