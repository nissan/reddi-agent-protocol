/**
 * The visitor's refund on the try page: after a sandbox escrow's refund window,
 * the wallet that locked it takes the whole amount back, no fee. Served as a
 * Solana Pay transaction request, so a phone wallet can sign it from a QR code
 * or a link, like the lock. Server only.
 */
import { ComputeBudgetProgram, PublicKey, Transaction } from "@solana/web3.js";
import { buildSandboxRefund, decodeSandboxEscrow, SANDBOX_ESCROW_PROGRAM_ID } from "@/lib/sandbox/escrow";

/** A refund is four accounts and no transfer to anyone else: a small budget keeps wallets from adding a priority fee. */
export const TRY_REFUND_COMPUTE_UNITS = 20_000;
export const TRY_REFUND_MICRO_LAMPORTS_PER_UNIT = 1_000;

export type TryRefundConnection = {
  getAccountInfo(address: PublicKey, commitment: "confirmed"): Promise<{ owner: PublicKey; data: Uint8Array; lamports: number } | null>;
  getSlot(commitment: "confirmed"): Promise<number>;
  getLatestBlockhash(commitment: "confirmed"): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
};

export type TryRefundResult =
  | { ok: true; transaction: string; message: string }
  | { ok: false; status: number; code: string; message: string };

const fail = (status: number, code: string, message: string): TryRefundResult => ({ ok: false, status, code, message });

function key(value: unknown): PublicKey | undefined {
  try {
    return typeof value === "string" ? new PublicKey(value) : undefined;
  } catch {
    return undefined;
  }
}

/** Slots are about 0.4 s each on devnet. */
const MS_PER_SLOT = 400;

export async function buildTryRefundTransaction(input: { escrow: unknown; account: unknown; connection: TryRefundConnection }): Promise<TryRefundResult> {
  const escrow = key(input.escrow);
  if (!escrow) return fail(400, "escrow_invalid", "This refund link does not name an escrow.");
  const payer = key(input.account);
  if (!payer) return fail(400, "account_invalid", "The wallet sent an account that is not a Solana address.");
  const account = await input.connection.getAccountInfo(escrow, "confirmed");
  if (!account) return fail(404, "escrow_closed", "This escrow is already closed, so there is nothing left to refund.");
  if (!account.owner.equals(SANDBOX_ESCROW_PROGRAM_ID)) return fail(400, "escrow_invalid", "That address is not a sandbox escrow.");
  const decoded = decodeSandboxEscrow(account.data);
  if (!decoded) return fail(400, "escrow_invalid", "That address is not a sandbox escrow.");
  if (decoded.status !== "locked") return fail(409, "escrow_closed", "This escrow has already been paid out or refunded.");
  if (!decoded.payer.equals(payer)) return fail(403, "not_payer", "Only the wallet that locked this escrow can take it back. Open the link in that wallet.");
  const opensAt = decoded.createdSlot + decoded.cancelWindowSlots;
  const slot = BigInt(await input.connection.getSlot("confirmed"));
  if (slot <= opensAt) {
    const minutes = Math.max(1, Math.ceil((Number(opensAt - slot) * MS_PER_SLOT) / 60_000));
    return fail(409, "refund_not_open", `The refund opens in about ${minutes} minute${minutes === 1 ? "" : "s"}, so the provider has time to settle first. Try again then.`);
  }
  const { blockhash, lastValidBlockHeight } = await input.connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: payer, blockhash, lastValidBlockHeight }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: TRY_REFUND_COMPUTE_UNITS }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: TRY_REFUND_MICRO_LAMPORTS_PER_UNIT }),
    buildSandboxRefund({ escrow, payer, rated: decoded.rated, createdSlot: decoded.createdSlot }),
  );
  const transaction = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  return { ok: true, transaction, message: "Take back everything locked in this devnet escrow. No fee; the escrow closes and its storage deposit comes back too." };
}
