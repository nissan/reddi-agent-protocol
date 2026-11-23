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
import { Connection, Keypair, PublicKey, SendTransactionError, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { SANDBOX_PROVIDERS } from "./catalog";
import { buildSandboxSettle, SANDBOX_ESCROW_DISCRIMINATORS, SANDBOX_ESCROW_PROGRAM_ID } from "./escrow";
import { SANDBOX_FEE_TREASURY } from "./pricing";
import { advanceSellerRating, type SellerRatingConnection } from "./seller-rating";
import { isDevnetConnection } from "@/lib/sandbox/devnet-genesis";
import { cachedSandboxDeploymentCheck, type SandboxDeploymentCheck } from "./deployment";

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
/**
 * What happened to a settle, as far as the chain shows (audit S7-Codex-R2-04 and R2-05):
 * - `ok: true`: it confirmed, and `feeLamports` is what the treasury received in it, read from the
 *   confirmed transaction (the program takes the fee rate in force at payout, so the server's clock
 *   is not used);
 * - `ok: false` without `pending`: nothing was charged, because it was never sent or it failed on chain;
 * - `ok: false, pending: true`: it was signed and may have been sent, but whether it landed is not
 *   known. The escrow may already be paid out: never tell the payer nothing was charged.
 */
export type SandboxSettleResult =
  | { ok: true; signature: string; feeLamports: bigint }
  | { ok: false; message: string; pending?: undefined }
  | { ok: false; pending: true; signature: string; message: string };

/** What the chain shows for a settle the server sent earlier. */
export type SandboxSettleLookup = { state: "settled"; feeLamports: bigint } | { state: "failed" } | { state: "unknown" };

/** The settle a payer's retry names: the escrow, its payer and payee, and the amount it must settle. */
export type SandboxSettleExpectation = { escrow: PublicKey; payer: PublicKey; payee: PublicKey; actualLamports: bigint };

export interface SandboxSettler {
  /** True when the server holds this provider's devnet key. */
  canSettle(providerId: string): boolean;
  /**
   * Whether devnet runs the escrow build of record, and how that build encodes an exit (deployment.ts).
   * A paid call is offered and served only when it passes.
   */
  deployment(): Promise<SandboxDeploymentCheck>;
  settle(input: SandboxSettleInput): Promise<SandboxSettleResult>;
  /**
   * Reads back a settle this server sent: `settled` only when the confirmed transaction is a
   * successful settle of exactly this escrow, payer, payee and amount, signed by the payee.
   */
  lookup(signature: string, expected: SandboxSettleExpectation): Promise<SandboxSettleLookup>;
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
  /** Replaces the cached check of the devnet program build (tests). */
  deployment?: () => Promise<SandboxDeploymentCheck>;
  /** Replaces the read-back of a sent settle (tests). */
  lookup?: (signature: string, expected: SandboxSettleExpectation) => Promise<SandboxSettleLookup>;
}

function pending(signature: string): SandboxSettleResult {
  return { ok: false, pending: true, signature, message: `The settle transaction ${signature} was sent, but devnet did not confirm whether it landed.` };
}

function logNotSent(input: SandboxSettleInput, error: unknown) {
  // Say why in the server log: the page's message stays generic, but a refused settle
  // (a program error in preflight) and a busy RPC need different fixes. Public data only.
  const logs = (error as { logs?: unknown }).logs;
  console.error("[sandbox-settle] settle not sent", {
    provider: input.providerId,
    escrow: input.escrow.toBase58(),
    error: error instanceof Error ? error.message : String(error),
    ...(Array.isArray(logs) ? { logs: logs.slice(-8) } : {}),
  });
}

type SettleTransactionReader = { getTransaction: Connection["getTransaction"] };

/** Reads `getTransaction` a few times: a transaction just confirmed is not always readable at once. */
async function readConfirmedTransaction(connection: SettleTransactionReader, signature: string, attempts = 3, sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const tx = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      if (tx) return tx;
    } catch {
      // Read again.
    }
    if (attempt + 1 < attempts) await sleep(400);
  }
  return undefined;
}

/**
 * The chain's account of a settle: `settled` with the treasury's credit when the confirmed transaction
 * succeeded and holds a settle_escrow of this escrow, payer and payee (the payee signing) for exactly
 * `actualLamports`; `failed` when it is confirmed and failed or settles something else; `unknown`
 * when it cannot be read (not landed, not landed yet, or the RPC is down).
 */
export async function lookupSandboxSettle(connection: SettleTransactionReader, signature: string, expected: SandboxSettleExpectation, options: { attempts?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<SandboxSettleLookup> {
  const tx = await readConfirmedTransaction(connection, signature, options.attempts, options.sleep);
  if (!tx || !tx.meta) return { state: "unknown" };
  if (tx.meta.err) return { state: "failed" };
  const message = tx.transaction.message;
  const keys = message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses }).keySegments().flat();
  const at = (index: number) => keys[index]?.toBase58();
  const program = SANDBOX_ESCROW_PROGRAM_ID.toBase58();
  const settles = message.compiledInstructions.filter((ix) => {
    if (at(ix.programIdIndex) !== program) return false;
    const data = Buffer.from(ix.data);
    if (data.length < 16 || !data.subarray(0, 8).equals(Buffer.from(SANDBOX_ESCROW_DISCRIMINATORS.settleEscrow))) return false;
    return (
      data.readBigUInt64LE(8) === expected.actualLamports &&
      at(ix.accountKeyIndexes[0]) === expected.escrow.toBase58() &&
      at(ix.accountKeyIndexes[1]) === expected.payer.toBase58() &&
      at(ix.accountKeyIndexes[2]) === expected.payee.toBase58() &&
      message.isAccountSigner(ix.accountKeyIndexes[2]) &&
      at(ix.accountKeyIndexes[3]) === SANDBOX_FEE_TREASURY
    );
  });
  if (settles.length !== 1) return { state: "failed" };
  const treasury = keys.findIndex((key) => key.toBase58() === SANDBOX_FEE_TREASURY);
  const fee = BigInt(tx.meta.postBalances[treasury] ?? 0) - BigInt(tx.meta.preBalances[treasury] ?? 0);
  if (treasury < 0 || fee < BigInt(0) || fee > expected.actualLamports) return { state: "unknown" };
  return { state: "settled", feeLamports: fee };
}

export function createSandboxSettler(connection: Connection, keys: Map<string, Keypair>, options: SandboxSettlerOptions = {}): SandboxSettler {
  const deployment =
    options.deployment ??
    cachedSandboxDeploymentCheck(async (address) => {
      const info = await connection.getAccountInfo(address, "confirmed");
      return info ? { owner: info.owner, data: new Uint8Array(info.data) } : null;
    });
  const lookup = options.lookup ?? ((signature: string, expected: SandboxSettleExpectation) => lookupSandboxSettle(connection, signature, expected));
  return {
    canSettle: (providerId) => keys.has(providerId),
    deployment,
    async settle(input) {
      const keypair = keys.get(input.providerId);
      if (!keypair || !keypair.publicKey.equals(input.payee)) return { ok: false, message: "This provider cannot settle on devnet right now." };
      if (!(await isDevnetConnection(connection))) return { ok: false, message: "The sandbox settles on devnet only, and the server RPC is not devnet." };
      // The exit's encoding depends on the build devnet runs (audit S7-Codex-R2-06): checked before anything is signed.
      const build = await deployment();
      if (!build.ok) return { ok: false, message: build.message };
      let signature: string | undefined;
      let lastValidBlockHeight: number;
      let raw: Buffer;
      try {
        const latest = await connection.getLatestBlockhash("confirmed");
        lastValidBlockHeight = latest.lastValidBlockHeight;
        const transaction = new Transaction({ feePayer: keypair.publicKey, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }).add(
          buildSandboxSettle({ escrow: input.escrow, payer: input.payer, payee: input.payee, actualLamports: input.actualLamports, rated: input.rated === true, createdSlot: input.createdSlot, namesUnratedExits: build.build.namesUnratedExits }),
        );
        transaction.sign(keypair);
        raw = transaction.serialize();
        // Known before anything is sent, so every later outcome can name it.
        signature = bs58.encode(transaction.signature!);
      } catch (error) {
        logNotSent(input, error);
        return { ok: false, message: "The settle transaction could not be built." };
      }
      try {
        await connection.sendRawTransaction(raw, { preflightCommitment: "confirmed" });
      } catch (error) {
        logNotSent(input, error);
        // A refused preflight (a program error in simulation) means the cluster never took it.
        // Any other failure (a timeout, a dropped connection) may come after the cluster took it.
        if (error instanceof SendTransactionError) return { ok: false, message: "The settle transaction could not be sent to devnet." };
        return pending(signature);
      }
      let confirmation: "confirmed" | "failed";
      try {
        confirmation = await confirmByPolling(connection, signature, lastValidBlockHeight);
      } catch (error) {
        console.error("[sandbox-settle] settle outcome unknown", { provider: input.providerId, escrow: input.escrow.toBase58(), signature, error: error instanceof Error ? error.message : String(error) });
        return pending(signature);
      }
      if (confirmation === "failed") return { ok: false, message: "The settle transaction failed on devnet." };
      // The fee is what the treasury received in the confirmed settle (audit S7-Codex-R2-05).
      const facts = await lookup(signature, { escrow: input.escrow, payer: input.payer, payee: input.payee, actualLamports: input.actualLamports });
      if (facts.state !== "settled") return pending(signature);
      if (input.rated === true && options.rateBuyerScore !== undefined) {
        // The settle opened the rating. A failure here never fails the settle that already landed.
        try {
          await advanceSellerRating({ connection: connection as unknown as SellerRatingConnection, programId: SANDBOX_ESCROW_PROGRAM_ID, escrow: input.escrow, keypair, score: options.rateBuyerScore });
        } catch {
          // The scheduled sweep commits what this missed.
        }
      }
      return { ok: true, signature, feeLamports: facts.feeLamports };
    },
    lookup,
  };
}
