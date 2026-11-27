// The Budget on devnet: open it with the four providers allowlisted and the spender allowed to waive,
// close it when the work is in, waive each posted slice (the work was checked on delivery), pay each out
// at once, and read back from the chain who was paid what.
import { randomBytes } from "node:crypto";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import x402 from "@redditech/x402-solana";
import budgets from "@redditech/x402-solana/budget";
import { DEVNET_GENESIS, DEVNET_USDC } from "./discover.mjs";

const { treasuryTokenAccount, ESCROW_PROTOCOL_TREASURY } = x402;
const { budgetAddress, closeBudgetInstruction, decodeBudget, decodeReservation, openBudgetInstruction, payoutInstruction, reservationAddress, waiveInstruction } = budgets;

export const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const MINT = new PublicKey(DEVNET_USDC);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const explorer = (signature) => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
export const accountLink = (address) => `https://explorer.solana.com/address/${address}?cluster=devnet`;

export async function connect(rpcUrl) {
  const connection = new Connection(rpcUrl, "confirmed");
  if ((await connection.getGenesisHash()) !== DEVNET_GENESIS) throw new Error("SOLANA_RPC_URL is not a devnet endpoint");
  return connection;
}

export function createBudgetChain({ connection, payer, spender, programId, log = () => {}, wait = sleep }) {
  const ata = (owner) => treasuryTokenAccount({ mint: MINT, tokenProgram: TOKEN_PROGRAM }, owner);
  const payerTokens = ata(payer.publicKey);
  const treasuryTokens = treasuryTokenAccount({ mint: MINT, tokenProgram: TOKEN_PROGRAM });

  async function send(instructions, signers) {
    const latest = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: payer.publicKey, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }).add(...instructions);
    tx.sign(payer, ...signers.filter((s) => !s.publicKey.equals(payer.publicKey)));
    const signature = await connection.sendRawTransaction(tx.serialize());
    const result = await connection.confirmTransaction({ signature, ...latest }, "confirmed");
    if (result.value.err) throw new Error(`transaction ${signature} failed: ${JSON.stringify(result.value.err)}`);
    return signature;
  }

  async function readBudget(budget) {
    const account = await connection.getAccountInfo(budget, "confirmed");
    if (!account) throw new Error(`Budget ${budget.toBase58()} was not found`);
    if (!account.owner.equals(programId)) throw new Error("the Budget account is not the program's");
    return decodeBudget(account.data);
  }

  async function readReservation(budget, payee) {
    const account = await connection.getAccountInfo(reservationAddress(budget, payee, programId), "confirmed");
    return account ? decodeReservation(account.data) : null;
  }

  return {
    payerTokens,
    treasuryTokens,
    async usdcBalance(owner = payer.publicKey) {
      const b = await connection.getTokenAccountBalance(ata(owner), "confirmed").catch(() => null);
      return BigInt(b?.value?.amount ?? 0);
    },
    async open({ total, judge, allowlist, openSlots }) {
      const nonce = randomBytes(16);
      const budget = budgetAddress(payer.publicKey, nonce, programId);
      const signature = await send(
        [
          openBudgetInstruction({
            programId,
            payer: payer.publicKey,
            nonce,
            spender: spender.publicKey,
            judge,
            allowlist,
            spenderMayWaive: true,
            openSlots,
            disputeSlots: 9_000n,
            judgeSlots: 1_500n,
            total,
            token: { mint: MINT, source: payerTokens, tokenProgram: TOKEN_PROGRAM },
          }),
        ],
        [],
      );
      const { createdSlot } = await readBudget(budget);
      log({ event: "budget_opened", budget: budget.toBase58(), total: total.toString(), signature });
      return { budget, createdSlot, signature };
    },
    async close({ budget, createdSlot }) {
      const signature = await send([closeBudgetInstruction({ programId, budget, createdSlot, signer: payer.publicKey, payer: payer.publicKey, token: { mint: MINT, refund: payerTokens, tokenProgram: TOKEN_PROGRAM } })], []);
      log({ event: "budget_closed", budget: budget.toBase58(), signature });
      return signature;
    },
    /** Waits until every payee has posted its total (each provider's sweep does it after the close). */
    async waitPosted({ budget, payees, nudge, maxMinutes = 20 }) {
      const until = Date.now() + maxMinutes * 60_000;
      while (Date.now() < until) {
        const states = await Promise.all(payees.map(async (p) => [p.toBase58(), (await readReservation(budget, p))?.state ?? "none"]));
        log({ event: "slices", states: Object.fromEntries(states) });
        if (states.every(([, s]) => s !== "open")) return Object.fromEntries(states);
        await nudge?.().catch((e) => log({ event: "sweep_nudge_failed", error: e.message }));
        await wait(20_000);
      }
      throw new Error("not every provider posted its total in time");
    },
    /** The spender (or the payer) waives the dispute window on a posted slice, then anyone may pay it out: one transaction. */
    async waiveAndPay({ budget, createdSlot, payee, waiver = spender }) {
      const r = await readReservation(budget, payee);
      if (!r) throw new Error(`no reservation for ${payee.toBase58()}`);
      if (r.state !== "posted") throw new Error(`the slice of ${payee.toBase58()} is ${r.state}, not posted`);
      const pay = payoutInstruction({
        programId,
        budget,
        createdSlot,
        payee,
        payer: payer.publicKey,
        treasury: ESCROW_PROTOCOL_TREASURY,
        token: { mint: MINT, payoutAccount: r.payoutAccount, treasuryToken: treasuryTokens, refund: payerTokens, tokenProgram: TOKEN_PROGRAM },
      });
      const waive = r.waived ? [] : [waiveInstruction({ programId, budget, createdSlot, payee, signer: waiver.publicKey })];
      const signature = await send([...waive, pay], [waiver]);
      log({ event: "paid_out", payee: payee.toBase58(), posted: r.finalAmount.toString(), reserved: r.reserved.toString(), signature });
      return { signature, posted: r.finalAmount, reserved: r.reserved, payoutAccount: r.payoutAccount };
    },
    /** USDC moved by a transaction, per token account, from its pre and post balances. */
    async tokenMoves(signature) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const tx = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
        if (tx?.meta) {
          const keys = tx.transaction.message.getAccountKeys ? tx.transaction.message.getAccountKeys().staticAccountKeys : tx.transaction.message.accountKeys;
          const moves = {};
          const pre = new Map(tx.meta.preTokenBalances.filter((b) => b.mint === DEVNET_USDC).map((b) => [b.accountIndex, BigInt(b.uiTokenAmount.amount)]));
          for (const b of tx.meta.postTokenBalances.filter((x) => x.mint === DEVNET_USDC)) {
            const delta = BigInt(b.uiTokenAmount.amount) - (pre.get(b.accountIndex) ?? 0n);
            if (delta !== 0n) moves[keys[b.accountIndex].toBase58()] = { owner: b.owner, delta };
          }
          return moves;
        }
        await wait(2_000);
      }
      throw new Error(`transaction ${signature} could not be read back`);
    },
    readBudget,
    readReservation,
  };
}
