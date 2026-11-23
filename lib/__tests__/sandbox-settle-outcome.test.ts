import { Keypair, SendTransactionError, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { DEVNET_GENESIS_HASH } from "@/lib/sandbox/devnet-genesis";
import { sandboxBuildOfRecord } from "@/lib/sandbox/deployment";
import { buildSandboxSettle } from "@/lib/sandbox/escrow";
import { SANDBOX_FEE_TREASURY } from "@/lib/sandbox/pricing";
import { createSandboxSettler, lookupSandboxSettle } from "@/lib/sandbox/settle-signer";

const payee = Keypair.generate();
const payer = Keypair.generate().publicKey;
const escrow = Keypair.generate().publicKey;
const BLOCKHASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const ACTUAL = BigInt(40_000);
const input = { providerId: "swift-infer", escrow, payer, payee: payee.publicKey, actualLamports: ACTUAL, createdSlot: BigInt(4242) };
const expected = { escrow, payer, payee: payee.publicKey, actualLamports: ACTUAL };
const noSleep = async () => {};

/** A confirmed transaction as getTransaction returns it, with the treasury credited `fee`. */
function confirmed(tx: Transaction, fee: bigint, err: unknown = null) {
  const message = tx.compileMessage();
  const keys = message.accountKeys.map((key) => key.toBase58());
  const pre = keys.map(() => 1_000_000);
  const post = keys.map((key, i) => (key === SANDBOX_FEE_TREASURY ? pre[i] + Number(fee) : pre[i]));
  return { slot: 1, blockTime: null, meta: { err, fee: 5000, preBalances: pre, postBalances: post, loadedAddresses: undefined }, transaction: { message, signatures: [] } };
}

function settleTx(overrides: Partial<Parameters<typeof buildSandboxSettle>[0]> = {}, signer = payee) {
  const tx = new Transaction({ feePayer: signer.publicKey, blockhash: BLOCKHASH, lastValidBlockHeight: 100 }).add(
    buildSandboxSettle({ escrow, payer, payee: payee.publicKey, actualLamports: ACTUAL, createdSlot: BigInt(4242), namesUnratedExits: false, ...overrides }),
  );
  tx.sign(signer);
  return tx;
}

describe("sandbox settle read-back (audit S7-Codex-R2-05)", () => {
  it("reads the fee from the treasury's credit in the confirmed settle", async () => {
    const tx = settleTx();
    const result = await lookupSandboxSettle({ getTransaction: (async () => confirmed(tx, BigInt(2_000))) as never }, "sig", expected, { sleep: noSleep });
    expect(result).toEqual({ state: "settled", feeLamports: BigInt(2_000) });
  });

  it("calls anything else failed, and an unreadable transaction unknown", async () => {
    const read = (value: unknown) => ({ getTransaction: (async () => value) as never });
    expect(await lookupSandboxSettle(read(confirmed(settleTx(), BigInt(1), { InstructionError: [0, { Custom: 6053 }] })), "sig", expected, { sleep: noSleep })).toEqual({ state: "failed" });
    // Another amount, escrow or payee is not this settle.
    expect(await lookupSandboxSettle(read(confirmed(settleTx({ actualLamports: ACTUAL - BigInt(1) }), BigInt(1))), "sig", expected, { sleep: noSleep })).toEqual({ state: "failed" });
    expect(await lookupSandboxSettle(read(confirmed(settleTx({ escrow: Keypair.generate().publicKey }), BigInt(1))), "sig", expected, { sleep: noSleep })).toEqual({ state: "failed" });
    const stranger = Keypair.generate();
    expect(await lookupSandboxSettle(read(confirmed(settleTx({ payee: stranger.publicKey }, stranger), BigInt(1))), "sig", expected, { sleep: noSleep })).toEqual({ state: "failed" });
    expect(await lookupSandboxSettle(read(null), "sig", expected, { sleep: noSleep })).toEqual({ state: "unknown" });
    expect(await lookupSandboxSettle({ getTransaction: (async () => { throw new Error("rpc down"); }) as never }, "sig", expected, { sleep: noSleep })).toEqual({ state: "unknown" });
  });
});

describe("sandbox settler outcomes (audit S7-Codex-R2-04)", () => {
  function connection(behaviour: { send?: "ok" | "preflight" | "timeout"; status?: "confirmed" | "failed" | "throws"; fee?: bigint }) {
    let sent: Transaction | undefined;
    return {
      getGenesisHash: async () => DEVNET_GENESIS_HASH,
      getLatestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 100 }),
      sendRawTransaction: async (raw: Buffer) => {
        sent = Transaction.from(raw);
        if (behaviour.send === "preflight") throw new SendTransactionError({ action: "send", signature: "", transactionMessage: "Simulation failed", logs: ["custom program error: 0x17a5"] });
        if (behaviour.send === "timeout") throw new Error("fetch failed: socket hang up");
        return bs58.encode(sent.signature!);
      },
      getSignatureStatuses: async () => {
        if (behaviour.status === "throws") throw new Error("429 Too Many Requests");
        return { context: { slot: 1 }, value: [behaviour.status === "failed" ? { err: { InstructionError: [0, "Custom"] }, confirmationStatus: "confirmed" } : { err: null, confirmationStatus: "confirmed" }] };
      },
      getBlockHeight: async () => 10,
      getTransaction: async () => (sent && behaviour.fee !== undefined ? confirmed(sent, behaviour.fee) : null),
    };
  }
  const settlerFor = (c: ReturnType<typeof connection>) =>
    createSandboxSettler(c as never, new Map([["swift-infer", payee]]), { deployment: async () => ({ ok: true, build: sandboxBuildOfRecord()! }), lookup: (signature, exp) => lookupSandboxSettle(c as never, signature, exp, { sleep: noSleep }) });

  it("returns the confirmed fee when the settle lands", async () => {
    const result = await settlerFor(connection({ send: "ok", status: "confirmed", fee: BigInt(1_000) })).settle(input);
    expect(result).toMatchObject({ ok: true, feeLamports: BigInt(1_000) });
  });

  it("is pending, naming the signature, when the send or the confirmation fails after signing", async () => {
    for (const c of [connection({ send: "timeout" }), connection({ send: "ok", status: "throws" }), connection({ send: "ok", status: "confirmed" })]) {
      const result = await settlerFor(c).settle(input);
      expect(result).toMatchObject({ ok: false, pending: true });
      if (result.ok || !result.pending) continue;
      expect(result.signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
    }
  });

  it("says not charged only when the cluster refused it or it failed on chain", async () => {
    for (const c of [connection({ send: "preflight" }), connection({ send: "ok", status: "failed" })]) {
      const result = await settlerFor(c).settle(input);
      expect(result.ok).toBe(false);
      expect("pending" in result && result.pending).toBeFalsy();
    }
  });

  it("does not sign while the program build is not the one of record", async () => {
    const c = connection({ send: "ok", status: "confirmed", fee: BigInt(1) });
    const send = jest.spyOn(c, "sendRawTransaction");
    const settler = createSandboxSettler(c as never, new Map([["swift-infer", payee]]), { deployment: async () => ({ ok: false, message: "paused" }) });
    expect(await settler.settle(input)).toEqual({ ok: false, message: "paused" });
    expect(send).not.toHaveBeenCalled();
  });
});
