import { ComputeBudgetProgram, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { SANDBOX_ESCROW_DISCRIMINATORS, SANDBOX_ESCROW_PROGRAM_ID } from "@/lib/sandbox/escrow";
import { buildTryRefundTransaction, type TryRefundConnection } from "@/lib/try/refund";
import { sandboxBuildOfRecord, UPGRADEABLE_LOADER_ID } from "@/lib/sandbox/deployment";

const BLOCKHASH = "11111111111111111111111111111111";
const CREATED_SLOT = BigInt(1_000);
const CANCEL_WINDOW = BigInt(4_500);

function escrowData(fields: { payer: PublicKey; payee: PublicKey; status?: number; rated?: boolean }): Uint8Array {
  const out = Buffer.alloc(165);
  let o = 0;
  Buffer.from(SANDBOX_ESCROW_DISCRIMINATORS.escrowAccount).copy(out, o); o += 8;
  fields.payer.toBuffer().copy(out, o); o += 32;
  fields.payee.toBuffer().copy(out, o); o += 32;
  out.writeBigUInt64LE(BigInt(5_354), o); o += 8;
  o += 16; // nonce
  out[o] = fields.status ?? 0; o += 1;
  out.writeBigInt64LE(BigInt(1_795_338_158), o); o += 8;
  out.writeBigUInt64LE(CREATED_SLOT, o); o += 8;
  out.writeBigUInt64LE(BigInt(1_500), o); o += 8;
  out.writeBigUInt64LE(CANCEL_WINDOW, o); o += 8;
  out[o] = 0; o += 1; // not delegated
  out[o] = 0; o += 1; // no session
  o += 1; // bump
  out[o] = fields.rated ? 0x03 : 0x01; // metered, plus rated
  return out;
}

const PROGRAM_DATA = Keypair.generate().publicKey;

/** The program account and its ProgramData, last deployed in `deployedSlot`. */
function programAccounts(deployedSlot: bigint) {
  const program = Buffer.alloc(36);
  program.writeUInt32LE(2, 0);
  PROGRAM_DATA.toBuffer().copy(program, 4);
  const programData = Buffer.alloc(45);
  programData.writeUInt32LE(3, 0);
  programData.writeBigUInt64LE(deployedSlot, 4);
  return new Map([
    [SANDBOX_ESCROW_PROGRAM_ID.toBase58(), { owner: UPGRADEABLE_LOADER_ID, data: new Uint8Array(program), lamports: 1 }],
    [PROGRAM_DATA.toBase58(), { owner: UPGRADEABLE_LOADER_ID, data: new Uint8Array(programData), lamports: 1 }],
  ]);
}

function connection(data: Uint8Array | null, slot: bigint, owner = SANDBOX_ESCROW_PROGRAM_ID, deployedSlot = sandboxBuildOfRecord()!.deployedSlot): TryRefundConnection {
  const program = programAccounts(deployedSlot);
  return {
    getAccountInfo: async (address: PublicKey) => program.get(address.toBase58()) ?? (data ? { owner, data, lamports: 1_493_794 } : null),
    getSlot: async () => Number(slot),
    getLatestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 100 }),
  };
}

describe("try refund (Solana Pay transaction request)", () => {
  const payer = Keypair.generate().publicKey;
  const payee = Keypair.generate().publicKey;
  const escrow = Keypair.generate().publicKey.toBase58();
  const open = CREATED_SLOT + CANCEL_WINDOW + BigInt(1);

  it("builds the payer's refund after the window: budget first, then cancel_escrow signed by the payer", async () => {
    const built = await buildTryRefundTransaction({ escrow, account: payer.toBase58(), connection: connection(escrowData({ payer, payee }), open) });
    if (!built.ok) throw new Error(built.message);
    const tx = Transaction.from(Buffer.from(built.transaction, "base64"));
    expect(tx.feePayer?.equals(payer)).toBe(true);
    const [limit, price, refund] = tx.instructions;
    expect(limit.programId.equals(ComputeBudgetProgram.programId) && price.programId.equals(ComputeBudgetProgram.programId)).toBe(true);
    expect(refund.programId.equals(SANDBOX_ESCROW_PROGRAM_ID)).toBe(true);
    expect(Buffer.from(refund.data)).toEqual(Buffer.from(SANDBOX_ESCROW_DISCRIMINATORS.cancelEscrow));
    expect(refund.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).toEqual([
      [escrow, false, true],
      [payer.toBase58(), true, true],
      // Authority and payer are the same wallet: one account in the message, so both read back as signer.
      [payer.toBase58(), true, true],
      ["11111111111111111111111111111111", false, false],
    ]);
  });

  it("names a rated escrow's job: rating account and slot", async () => {
    const built = await buildTryRefundTransaction({ escrow, account: payer.toBase58(), connection: connection(escrowData({ payer, payee, rated: true }), open) });
    if (!built.ok) throw new Error(built.message);
    const refund = Transaction.from(Buffer.from(built.transaction, "base64")).instructions[2];
    expect(refund.keys).toHaveLength(5);
    expect(Buffer.from(refund.data).subarray(8).readBigUInt64LE(0)).toBe(CREATED_SLOT);
  });

  it("encodes the refund for the build devnet runs, and refuses when that build is not the one of record (audit S7-Codex-R2-06)", async () => {
    const built = await buildTryRefundTransaction({ escrow, account: payer.toBase58(), connection: connection(escrowData({ payer, payee }), open) });
    if (!built.ok) throw new Error(built.message);
    const refund = Transaction.from(Buffer.from(built.transaction, "base64")).instructions[2];
    // The build of record before the freeze takes no slot on an unrated exit.
    expect(sandboxBuildOfRecord()!.namesUnratedExits).toBe(false);
    expect(refund.data).toHaveLength(8);
    const unknown = await buildTryRefundTransaction({ escrow, account: payer.toBase58(), connection: connection(escrowData({ payer, payee }), open, SANDBOX_ESCROW_PROGRAM_ID, BigInt(1)) });
    expect(unknown).toMatchObject({ ok: false, code: "refund_paused" });
  });

  it("refuses before the window, for another wallet, for a closed or foreign escrow", async () => {
    const early = await buildTryRefundTransaction({ escrow, account: payer.toBase58(), connection: connection(escrowData({ payer, payee }), CREATED_SLOT + CANCEL_WINDOW) });
    expect(early).toMatchObject({ ok: false, code: "refund_not_open" });
    const stranger = await buildTryRefundTransaction({ escrow, account: payee.toBase58(), connection: connection(escrowData({ payer, payee }), open) });
    expect(stranger).toMatchObject({ ok: false, code: "not_payer" });
    expect(await buildTryRefundTransaction({ escrow, account: payer.toBase58(), connection: connection(null, open) })).toMatchObject({ ok: false, code: "escrow_closed" });
    expect(await buildTryRefundTransaction({ escrow, account: payer.toBase58(), connection: connection(escrowData({ payer, payee, status: 2 }), open) })).toMatchObject({ ok: false, code: "escrow_closed" });
    expect(await buildTryRefundTransaction({ escrow, account: payer.toBase58(), connection: connection(escrowData({ payer, payee }), open, payee) })).toMatchObject({ ok: false, code: "escrow_invalid" });
    expect(await buildTryRefundTransaction({ escrow: "nope", account: payer.toBase58(), connection: connection(null, open) })).toMatchObject({ ok: false, code: "escrow_invalid" });
  });
});
