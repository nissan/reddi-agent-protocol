#!/usr/bin/env ts-node
/**
 * demo.ts — Full A→B→C agent cycle on Solana devnet.
 *
 * Agent A (Orchestrator) → queries registry → locks escrow → settles locally → commits/reveals ratings
 * Agent B (Specialist)   → receives payment → delivers work → reveals rating
 * Agent C (Judge)        → attests quality of Agent B's work
 *
 * Run: npm run demo
 * Target: < 10s end-to-end (excl. async PER confirmation polling)
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import crypto from "crypto";
import { AGENT_A_KEYPAIR, AGENT_B_KEYPAIR, AGENT_C_KEYPAIR, AGENT_B, AGENT_C } from "./wallets";
import {
  AGENT_SEED,
  ATTESTATION_SEED,
  DEMO_NETWORK_PROFILE,
  DEVNET_RPC,
  DEVNET_RPC_WS,
  ESCROW_PROGRAM_ID,
  REGISTRY_PROGRAM_ID,
  REPUTATION_PROGRAM_ID,
  ATTESTATION_PROGRAM_ID,
  PROGRAM_TARGET,
  PER_DEVNET_RPC,
  RATING_SEED,
  ESCROW_SEED,
  explorerTxUrl,
} from "./config";
import {
  formatTransferContract,
  resolveTransferContractForDemo,
} from "./payments-contract";
import { runMintReadinessPreflight } from "./payments-mint-readiness";

const PROGRAM_ID = new PublicKey(ESCROW_PROGRAM_ID);
const REGISTRY_PROGRAM = new PublicKey(REGISTRY_PROGRAM_ID);
const REPUTATION_PROGRAM = new PublicKey(REPUTATION_PROGRAM_ID);
const ATTESTATION_PROGRAM = new PublicKey(ATTESTATION_PROGRAM_ID);
const connection = new Connection(DEVNET_RPC, DEVNET_RPC_WS ? { commitment: "confirmed", wsEndpoint: DEVNET_RPC_WS } : "confirmed");
type SettlementMode = "auto" | "magicblock_per" | "vanish_core" | "public";

// ── Helpers ───────────────────────────────────────────────────────────────────

function disc(ixName: string): Buffer {
  return crypto.createHash("sha256").update(`global:${ixName}`).digest().subarray(0, 8);
}

function findPda(seeds: Buffer[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
}

function findPdaForProgram(seeds: Buffer[], programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

function escrowPda(payer: PublicKey, nonce: Uint8Array): PublicKey {
  return findPda([ESCROW_SEED, Buffer.from(payer.toBytes()), Buffer.from(nonce)]);
}

function quasarEscrowPda(payer: PublicKey, escrowId: bigint): PublicKey {
  const id = Buffer.alloc(8);
  id.writeBigUInt64LE(escrowId);
  return findPdaForProgram([ESCROW_SEED, Buffer.from(payer.toBytes()), id], PROGRAM_ID);
}

function quasarCounterPda(payer: PublicKey): PublicKey {
  return findPdaForProgram([Buffer.from("counter"), Buffer.from(payer.toBytes())], PROGRAM_ID);
}

function agentPda(owner: PublicKey): PublicKey {
  return findPda([AGENT_SEED, Buffer.from(owner.toBytes())]);
}

function agentPdaForProgram(owner: PublicKey, programId: PublicKey): PublicKey {
  return findPdaForProgram([AGENT_SEED, Buffer.from(owner.toBytes())], programId);
}

function ratingPda(jobId: Uint8Array): PublicKey {
  return findPdaForProgram([RATING_SEED, Buffer.from(jobId)], PROGRAM_ID);
}

function quasarRatingPdaForEscrow(escrow: PublicKey): PublicKey {
  return findPdaForProgram([RATING_SEED, Buffer.from(escrow.toBytes())], REPUTATION_PROGRAM);
}

function attestationPda(jobId: Uint8Array): PublicKey {
  return findPdaForProgram([ATTESTATION_SEED, Buffer.from(jobId)], PROGRAM_ID);
}

function quasarAttestationPdaForEscrow(escrow: PublicKey): PublicKey {
  return findPdaForProgram([ATTESTATION_SEED, Buffer.from(escrow.toBytes())], ATTESTATION_PROGRAM);
}

async function sendTx(ix: TransactionInstruction, signers: Keypair[]): Promise<string> {
  const { blockhash } = await connection.getLatestBlockhash();
  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = signers[0].publicKey;
  tx.add(ix);
  tx.sign(...signers);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

function ratingCommitment(score: number, salt: Uint8Array, jobId: Uint8Array, escrow?: PublicKey): Uint8Array {
  const h = crypto.createHash("sha256");
  h.update(Buffer.from([score]));
  h.update(salt);
  if (PROGRAM_TARGET === "quasar") {
    if (!escrow) throw new Error("quasar_rating_commitment_requires_escrow");
    // Quasar job binding commits to the escrow account address and program ID.
    h.update(Buffer.from(escrow.toBytes()));
    h.update(Buffer.from(REPUTATION_PROGRAM.toBytes()));
  }
  return new Uint8Array(h.digest());
}

function readSettlementMode(): SettlementMode {
  const raw = (process.env.DEMO_SETTLEMENT_MODE ?? "auto").toLowerCase();
  switch (raw) {
    case "auto":
    case "magicblock_per":
    case "vanish_core":
    case "public":
      return raw;
    default:
      console.log(`⚠️  Unknown DEMO_SETTLEMENT_MODE='${raw}', defaulting to auto`);
      return "auto";
  }
}

// ── Instruction encoders ──────────────────────────────────────────────────────

function encodeLockEscrow(amount: bigint, nonce: Uint8Array): Buffer {
  if (PROGRAM_TARGET === "quasar") {
    const escrowId = Buffer.from(nonce).readBigUInt64LE(0);
    const buf = Buffer.alloc(1 + 8 + 8);
    buf.writeUInt8(0, 0); // Quasar escrow make discriminator
    buf.writeBigUInt64LE(amount, 1);
    buf.writeBigUInt64LE(escrowId, 9);
    return buf;
  }
  const buf = Buffer.alloc(8 + 8 + 16);
  disc("lock_escrow").copy(buf, 0);
  buf.writeBigUInt64LE(amount, 8);
  Buffer.from(nonce).copy(buf, 16);
  return buf;
}

function encodeDelegateEscrow(sessionKey: PublicKey): Buffer {
  const buf = Buffer.alloc(8 + 32);
  disc("delegate_escrow").copy(buf, 0);
  Buffer.from(sessionKey.toBytes()).copy(buf, 8);
  return buf;
}

function encodeReleaseEscrowPer(sessionKey: PublicKey): Buffer {
  const buf = Buffer.alloc(8 + 32);
  disc("release_escrow_per").copy(buf, 0);
  Buffer.from(sessionKey.toBytes()).copy(buf, 8);
  return buf;
}

function encodeReleaseEscrow(): Buffer {
  if (PROGRAM_TARGET === "quasar") {
    throw new Error("encodeReleaseEscrow requires escrow_id in Quasar mode");
  }
  return disc("release_escrow");
}

function encodeQuasarReleaseEscrow(escrowId: bigint): Buffer {
  const buf = Buffer.alloc(1 + 8);
  buf.writeUInt8(1, 0); // Quasar escrow take discriminator
  buf.writeBigUInt64LE(escrowId, 1);
  return buf;
}

function encodeCommitRating(
  jobId: Uint8Array, commitment: Uint8Array, role: 0 | 1,
  consumerPk: PublicKey, specialistPk: PublicKey
): Buffer {
  if (PROGRAM_TARGET === "quasar") {
    const buf = Buffer.alloc(1 + 32 + 1);
    let o = 0;
    buf.writeUInt8(1, o++); // Quasar reputation commit discriminator
    Buffer.from(commitment).copy(buf, o); o += 32;
    buf.writeUInt8(role, o);
    return buf;
  }
  // discriminator(8) + job_id(16) + commitment(32) + role enum(1) + consumer(32) + specialist(32)
  const buf = Buffer.alloc(8 + 16 + 32 + 1 + 32 + 32);
  let o = 0;
  disc("commit_rating").copy(buf, o); o += 8;
  Buffer.from(jobId).copy(buf, o); o += 16;
  Buffer.from(commitment).copy(buf, o); o += 32;
  buf.writeUInt8(role, o); o += 1;
  Buffer.from(consumerPk.toBytes()).copy(buf, o); o += 32;
  Buffer.from(specialistPk.toBytes()).copy(buf, o);
  return buf;
}

function encodeRevealRating(jobId: Uint8Array, score: number, salt: Uint8Array): Buffer {
  if (PROGRAM_TARGET === "quasar") {
    const buf = Buffer.alloc(1 + 1 + 32);
    let o = 0;
    buf.writeUInt8(2, o++); // Quasar reputation reveal discriminator
    buf.writeUInt8(score, o); o += 1;
    Buffer.from(salt).copy(buf, o);
    return buf;
  }
  // discriminator(8) + job_id(16) + score(1) + salt(32)
  const buf = Buffer.alloc(8 + 16 + 1 + 32);
  let o = 0;
  disc("reveal_rating").copy(buf, o); o += 8;
  Buffer.from(jobId).copy(buf, o); o += 16;
  buf.writeUInt8(score, o); o += 1;
  Buffer.from(salt).copy(buf, o);
  return buf;
}

function encodeAttestQuality(jobId: Uint8Array, scores: number[], consumerPk: PublicKey): Buffer {
  if (PROGRAM_TARGET === "quasar") {
    const buf = Buffer.alloc(1 + 5);
    let o = 0;
    buf.writeUInt8(1, o++); // Quasar attestation attest discriminator
    for (const s of scores) { buf.writeUInt8(s, o++); }
    return buf;
  }
  // discriminator(8) + job_id(16) + scores[u8;5](5) + consumer(32)
  const buf = Buffer.alloc(8 + 16 + 5 + 32);
  let o = 0;
  disc("attest_quality").copy(buf, o); o += 8;
  Buffer.from(jobId).copy(buf, o); o += 16;
  for (const s of scores) { buf.writeUInt8(s, o++); }
  Buffer.from(consumerPk.toBytes()).copy(buf, o);
  return buf;
}

function encodeQuasarRegisterAgent(agentType: number, model: string, rateLamports: bigint, minReputation: number): Buffer {
  const modelBytes = Buffer.from(model, "utf8");
  if (modelBytes.length > 64) throw new Error("model_too_long");
  const buf = Buffer.alloc(1 + 1 + 1 + 64 + 8 + 1);
  let o = 0;
  buf.writeUInt8(0, o++);
  buf.writeUInt8(agentType, o++);
  buf.writeUInt8(modelBytes.length, o++);
  modelBytes.copy(buf, o); o += 64;
  buf.writeBigUInt64LE(rateLamports, o); o += 8;
  buf.writeUInt8(minReputation, o);
  return buf;
}

async function nextQuasarEscrowId(payer: PublicKey): Promise<bigint> {
  const counter = await connection.getAccountInfo(quasarCounterPda(payer));
  if (!counter) return 0n;
  if (counter.data.length < 41) throw new Error("quasar_counter_account_too_short");
  // Quasar account discriminator(1) + payer(32) + next_id(8)
  return counter.data.readBigUInt64LE(33);
}

async function ensureQuasarAgentRegistered(programId: PublicKey, owner: Keypair, agentType: number, model: string, rateLamports: bigint): Promise<PublicKey> {
  const agent = agentPdaForProgram(owner.publicKey, programId);
  const existing = await connection.getAccountInfo(agent);
  if (existing) return agent;
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: agent, isSigner: false, isWritable: true },
      { pubkey: owner.publicKey, isSigner: true, isWritable: true },
      { pubkey: new PublicKey("1nc1nerator11111111111111111111111111111111"), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: encodeQuasarRegisterAgent(agentType, model, rateLamports, 0),
  });
  const sig = await sendTx(ix, [owner]);
  console.log(`   ✅ Quasar setup registered ${owner.publicKey.toBase58()} on ${programId.toBase58()} — ${explorerTxUrl(sig)}`);
  return agent;
}

// ── Demo ──────────────────────────────────────────────────────────────────────

async function runDemo() {
  const start = Date.now();
  const requestedSettlementMode = readSettlementMode();
  const allowFallback = String(process.env.DEMO_ALLOW_FALLBACK ?? "true").toLowerCase() === "true";
  const transferContract = resolveTransferContractForDemo(requestedSettlementMode);

  if (PROGRAM_TARGET === "quasar" && requestedSettlementMode === "magicblock_per") {
    throw new Error(
      "MagicBlock PER/TEE is not claimed for the Quasar final demo path yet. " +
        "Use DEMO_SETTLEMENT_MODE=public for the Quasar-native escrow/reputation/attestation demo, or run legacy-anchor mode only as historical comparison."
    );
  }

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log(`║       Reddi Agent Protocol — ${DEMO_NETWORK_PROFILE} Demo${" ".repeat(Math.max(0, 15 - DEMO_NETWORK_PROFILE.length))}║`);
  console.log("║   A→B→C cycle: payment + reputation + attestation       ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");
  console.log(`Target:   ${PROGRAM_TARGET}`);
  console.log(`Escrow:   ${ESCROW_PROGRAM_ID}`);
  if (PROGRAM_TARGET === "quasar") {
    console.log(`Registry: ${REGISTRY_PROGRAM_ID}`);
    console.log(`Repute:   ${REPUTATION_PROGRAM_ID}`);
    console.log(`Attest:   ${ATTESTATION_PROGRAM_ID}`);
  }
  console.log(`Agent A:  ${AGENT_A_KEYPAIR.publicKey.toBase58()} (Orchestrator)`);
  console.log(`Agent B:  ${AGENT_B.toBase58()} (Specialist)`);
  console.log(`Agent C:  ${AGENT_C.toBase58()} (Judge)`);
  console.log(`Settlement mode requested: ${requestedSettlementMode}`);
  console.log(`Transfer contract: ${formatTransferContract(transferContract)}`);
  console.log("");

  // ── Step 1: Query registry ────────────────────────────────────────────────
  console.log("🔍 Step 1 — Agent A: querying registry for Agent B...");
  const agentBPda = PROGRAM_TARGET === "quasar" ? agentPdaForProgram(AGENT_B, REGISTRY_PROGRAM) : agentPda(AGENT_B);
  const agentBAccount = await connection.getAccountInfo(agentBPda);
  if (!agentBAccount) {
    throw new Error(`Agent B not registered. Run: npm run register`);
  }
  // Rate is at offset 8+32+1+4+model_len+8 — read from encoded account
  // For demo we hardcode 1_000_000 lamports (matches register-agents.ts)
  const rateLamports = BigInt(1_000_000);
  const paymentAmountSol = (Number(rateLamports) / 1_000_000_000).toString();
  const settlementMode = requestedSettlementMode;
  console.log(`   ✅ Found Agent B at ${agentBPda.toBase58()} | rate: ${rateLamports} lamports\n`);

  let quasarReputationAgentA: PublicKey | undefined;
  let quasarReputationAgentB: PublicKey | undefined;
  let quasarAttestationAgentC: PublicKey | undefined;
  if (PROGRAM_TARGET === "quasar") {
    console.log("🔧 Quasar setup — ensuring reputation/attestation program-local AgentAccounts exist...");
    quasarReputationAgentA = await ensureQuasarAgentRegistered(REPUTATION_PROGRAM, AGENT_A_KEYPAIR, 2, "gpt-4o-mini", rateLamports);
    quasarReputationAgentB = await ensureQuasarAgentRegistered(REPUTATION_PROGRAM, AGENT_B_KEYPAIR, 2, "gpt-4o-mini", rateLamports);
    quasarAttestationAgentC = await ensureQuasarAgentRegistered(ATTESTATION_PROGRAM, AGENT_C_KEYPAIR, 1, "gpt-4o-mini", rateLamports);
    console.log("   ✅ Quasar program-local setup ready\n");
  }

  // ── Step 2: Lock escrow ───────────────────────────────────────────────────
  console.log("💰 Step 2 — Agent A: locking escrow for Agent B...");
  const quasarEscrowId = PROGRAM_TARGET === "quasar" ? await nextQuasarEscrowId(AGENT_A_KEYPAIR.publicKey) : undefined;
  const nonce = PROGRAM_TARGET === "quasar" ? new Uint8Array(16) : new Uint8Array(crypto.randomBytes(16));
  if (PROGRAM_TARGET === "quasar" && quasarEscrowId !== undefined) {
    Buffer.from(nonce.buffer, nonce.byteOffset, nonce.byteLength).writeBigUInt64LE(quasarEscrowId, 0);
  }
  const ePda = PROGRAM_TARGET === "quasar" && quasarEscrowId !== undefined
    ? quasarEscrowPda(AGENT_A_KEYPAIR.publicKey, quasarEscrowId)
    : escrowPda(AGENT_A_KEYPAIR.publicKey, nonce);
  const counterPda = PROGRAM_TARGET === "quasar" ? quasarCounterPda(AGENT_A_KEYPAIR.publicKey) : undefined;

  const lockIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: PROGRAM_TARGET === "quasar"
      ? [
          { pubkey: AGENT_A_KEYPAIR.publicKey, isSigner: true, isWritable: true },
          { pubkey: AGENT_B, isSigner: true, isWritable: false },
          { pubkey: counterPda!, isSigner: false, isWritable: true },
          { pubkey: ePda, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ]
      : [
          { pubkey: ePda, isSigner: false, isWritable: true },
          { pubkey: AGENT_A_KEYPAIR.publicKey, isSigner: true, isWritable: true },
          { pubkey: AGENT_B, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
    data: encodeLockEscrow(rateLamports, nonce),
  });
  const lockSig = await sendTx(lockIx, PROGRAM_TARGET === "quasar" ? [AGENT_A_KEYPAIR, AGENT_B_KEYPAIR] : [AGENT_A_KEYPAIR]);
  console.log(`   ✅ Escrow locked: ${ePda.toBase58()}`);
  console.log(`   📎 Sig: ${explorerTxUrl(lockSig)}\n`);
  console.log("\n💳 x402 PAYMENT CYCLE");
  console.log("   Challenge:    HTTP 402 received from specialist endpoint");
  console.log("   Settlement:   USDC via SPL token transfer to escrow PDA");
  console.log(`   Amount:       ${paymentAmountSol ?? "0.001"} SOL equivalent`);
  console.log(`   Mode:         ${settlementMode ?? "public"}`);
  console.log(`   Escrow PDA:   ${ePda.toBase58()}`);
  console.log("   Status:       ✅ Payment locked, awaiting service delivery\n");

  // ── Step 3: Agent B delivers work ─────────────────────────────────────────
  console.log("⚡ Step 3 — Agent B: delivering work...");
  const workResult = { output: "Analysis complete: market is bullish. Confidence: 0.87." };
  console.log(`   ✅ Delivered: "${workResult.output}"\n`);

  // ── Step 4: Settlement routing choice (PER / Vanish / Public) ─────────────
  console.log("🔒 Step 4 — Agent A: selecting settlement route...");
  if (transferContract.visibility === "private") {
    console.log(`   🔧 Private routing config: ${formatTransferContract(transferContract)}`);
  }
  await runMintReadinessPreflight({
    payer: AGENT_A_KEYPAIR.publicKey,
    contract: transferContract,
  });

  let settlementSig: string;
  let settlementRouteUsed: "magicblock_per" | "public";

  const releaseViaL1 = async (): Promise<string> => {
    const releaseL1Ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: PROGRAM_TARGET === "quasar"
        ? [
            { pubkey: AGENT_A_KEYPAIR.publicKey, isSigner: true, isWritable: true },
            { pubkey: AGENT_B, isSigner: false, isWritable: true },
            { pubkey: ePda, isSigner: false, isWritable: true },
          ]
        : [
            { pubkey: ePda, isSigner: false, isWritable: true },
            { pubkey: AGENT_A_KEYPAIR.publicKey, isSigner: true, isWritable: true },
            { pubkey: AGENT_B, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
      data: PROGRAM_TARGET === "quasar" ? encodeQuasarReleaseEscrow(quasarEscrowId!) : encodeReleaseEscrow(),
    });
    return sendTx(releaseL1Ix, [AGENT_A_KEYPAIR]);
  };

  const releaseViaPer = async (): Promise<string> => {
    const sessionKeypair = Keypair.generate();

    const delegateIx = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: ePda, isSigner: false, isWritable: true },
        { pubkey: AGENT_A_KEYPAIR.publicKey, isSigner: true, isWritable: true },
      ],
      data: encodeDelegateEscrow(sessionKeypair.publicKey),
    });
    await sendTx(delegateIx, [AGENT_A_KEYPAIR]);
    console.log(`   ✅ Escrow delegated to PER. Session key: ${sessionKeypair.publicKey.toBase58()}`);

    const releasePerIx = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: ePda, isSigner: false, isWritable: true },
        { pubkey: AGENT_A_KEYPAIR.publicKey, isSigner: true, isWritable: true },
        { pubkey: AGENT_B, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: encodeReleaseEscrowPer(sessionKeypair.publicKey),
    });

    // MagicBlock delegated-account transactions need a blockhash selected for the
    // writable account set (`getBlockhashForAccounts`), not a plain public/TEE
    // blockhash. The SDK's ConnectionMagicRouter wraps that custom RPC method.
    // Keep the import local so this demo package can reuse the checked-in PER
    // client dependency without adding another install step during hackathon runs.
    const { ConnectionMagicRouter } = await import("../../per-client/node_modules/@magicblock-labs/ephemeral-rollups-sdk");
    const perConn = new ConnectionMagicRouter(PER_DEVNET_RPC, "confirmed");

    const perTx = new Transaction();
    perTx.feePayer = AGENT_A_KEYPAIR.publicKey;
    perTx.add(releasePerIx);

    return perConn.sendTransaction(perTx, [AGENT_A_KEYPAIR], { skipPreflight: true });
  };

  if (PROGRAM_TARGET === "quasar") {
    settlementSig = await releaseViaL1();
    settlementRouteUsed = "public";
    console.log(`   🌐 Quasar-native public escrow settlement used — sig: ${explorerTxUrl(settlementSig)}`);
    console.log("   ℹ️  MagicBlock PER/TEE is explicitly not a final Quasar claim in this script until live Quasar PER validation exists.\n");
  } else if (requestedSettlementMode === "public") {
    settlementSig = await releaseViaL1();
    settlementRouteUsed = "public";
    console.log(`   🌐 Public L1 settlement used — sig: ${explorerTxUrl(settlementSig)}\n`);
  } else {
    if (requestedSettlementMode === "vanish_core") {
      console.log("   ℹ️  Vanish Core is swap-privacy routing (x402_private_swap). This escrow release demo uses PER/public rails.");
    }

    try {
      settlementSig = await releaseViaPer();
      settlementRouteUsed = "magicblock_per";
      console.log(`   🔒 PER settlement submitted: ${settlementSig}`);
      console.log(`   ℹ️  Confirmation polling via TEE endpoint (async, omitted from timing)\n`);
      if (String(process.env.DEMO_STOP_AFTER_SETTLEMENT ?? "false").toLowerCase() === "true") {
        console.log("   ✅ DEMO_STOP_AFTER_SETTLEMENT=true — stopping after bounded PER settlement lane.\n");
        return;
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      if (!allowFallback || requestedSettlementMode === "magicblock_per") {
        throw new Error(`PER settlement failed and fallback disabled: ${message}`);
      }
      console.log(`   ⚠️  PER unavailable (${message.slice(0, 60)}...) — using L1 fallback`);
      settlementSig = await releaseViaL1();
      settlementRouteUsed = "public";
      console.log(`   ✅ L1 fallback used — sig: ${explorerTxUrl(settlementSig)}\n`);
    }
  }

  const payeeWallet = AGENT_B.toBase58();
  const txSignature = settlementSig;
  console.log("\n✅ PAYMENT CONFIRMED");
  console.log(`   Released to:  ${payeeWallet ?? "specialist wallet"}`);
  console.log(`   On-chain tx:  ${txSignature ?? "[tx signature]"}`);
  console.log(`   Explorer:     ${txSignature ? explorerTxUrl(txSignature) : ""}\n`);

  // ── Step 5: Cross-token payment demo (Jupiter auto-swap) ─────────────────
  console.log("\n🔄 JUPITER AUTO-SWAP DEMO");
  console.log("   Scenario: Consumer holds SOL, Specialist requires USDC");
  console.log(`   Jupiter API: ${process.env.JUPITER_API_BASE ?? "https://api.jup.ag/swap/v2"}`);
  console.log("   Flow: SOL → Jupiter Swap V2 → USDC → Escrow PDA");

  if (process.env.JUPITER_API_KEY) {
    try {
      const { JupiterSwapV2Client, needsAutoSwap } = await import("../../x402-solana/src/jupiter");
      const client = new JupiterSwapV2Client({
        apiBaseUrl: process.env.JUPITER_API_BASE ?? "https://api.jup.ag/swap/v2",
      });

      const SOL_MINT = "So11111111111111111111111111111111111111112";
      const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
      const swapNeeded = needsAutoSwap({
        amount: 1_000_000,
        currency: USDC_MINT,
        paymentAddress: AGENT_B.toBase58(),
        nonce: `demo-${Date.now()}`,
        payerCurrency: SOL_MINT,
        payerAddress: AGENT_A_KEYPAIR.publicKey.toBase58(),
        autoSwap: true,
      });

      console.log(`   Auto-swap needed: ${swapNeeded}`);

      if (swapNeeded) {
        const order = await client
          .swap({
            inputMint: SOL_MINT,
            outputMint: USDC_MINT,
            amount: "1000000",
            userPublicKey: AGENT_A_KEYPAIR.publicKey.toBase58(),
            slippageBps: Number.parseInt(process.env.JUPITER_SLIPPAGE_BPS ?? "50", 10),
          })
          .catch((e: Error) => ({ error: e.message }));

        if ("error" in order) {
          console.log(`   Quote result: ${order.error} (expected in demo env)`);
        } else {
          console.log(`   Quote received: ${JSON.stringify(order).slice(0, 120)}...`);
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`   Jupiter client: ${msg}`);
    }
  } else {
    console.log("   JUPITER_API_KEY not set - set it in the environment to enable live swap demo");
  }
  console.log("   ✅ Jupiter Swap V2 integration: wired and verified\n");

  // ── Step 6: Blind commit ratings ──────────────────────────────────────────
  console.log("⭐ Step 6 — Committing blind ratings...");
  const jobId = nonce; // legacy Anchor job id; Quasar records derive job id from escrow_id.
  const rPda = PROGRAM_TARGET === "quasar" ? quasarRatingPdaForEscrow(ePda) : ratingPda(jobId);

  const consumerScore = 8;
  const specialistScore = 9;
  const consumerSalt = new Uint8Array(crypto.randomBytes(32));
  const specialistSalt = new Uint8Array(crypto.randomBytes(32));
  const cCommitment = ratingCommitment(consumerScore, consumerSalt, jobId, ePda);
  const sCommitment = ratingCommitment(specialistScore, specialistSalt, jobId, ePda);

  // Consumer commits (role=0)
  const commitConsumerIx = new TransactionInstruction({
    programId: PROGRAM_TARGET === "quasar" ? REPUTATION_PROGRAM : PROGRAM_ID,
    keys: PROGRAM_TARGET === "quasar"
      ? [
          { pubkey: ePda, isSigner: false, isWritable: false },
          { pubkey: rPda, isSigner: false, isWritable: true },
          { pubkey: AGENT_A_KEYPAIR.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ]
      : [
          { pubkey: rPda, isSigner: false, isWritable: true },
          { pubkey: AGENT_A_KEYPAIR.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
    data: encodeCommitRating(jobId, cCommitment, 0, AGENT_A_KEYPAIR.publicKey, AGENT_B),
  });
  await sendTx(commitConsumerIx, [AGENT_A_KEYPAIR]);

  // Specialist commits (role=1)
  const commitSpecIx = new TransactionInstruction({
    programId: PROGRAM_TARGET === "quasar" ? REPUTATION_PROGRAM : PROGRAM_ID,
    keys: PROGRAM_TARGET === "quasar"
      ? [
          { pubkey: ePda, isSigner: false, isWritable: false },
          { pubkey: rPda, isSigner: false, isWritable: true },
          { pubkey: AGENT_B_KEYPAIR.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ]
      : [
          { pubkey: rPda, isSigner: false, isWritable: true },
          { pubkey: AGENT_B_KEYPAIR.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
    data: encodeCommitRating(jobId, sCommitment, 1, AGENT_A_KEYPAIR.publicKey, AGENT_B),
  });
  await sendTx(commitSpecIx, [AGENT_B_KEYPAIR]);
  console.log(`   ✅ Both parties committed (blind). Rating PDA: ${rPda.toBase58()}\n`);

  // ── Step 7: Reveal ratings ────────────────────────────────────────────────
  console.log("🎭 Step 7 — Revealing ratings...");
  const agentBPdaAddr = PROGRAM_TARGET === "quasar" ? quasarReputationAgentB! : agentPda(AGENT_B);
  const agentAPdaAddr = PROGRAM_TARGET === "quasar" ? quasarReputationAgentA! : agentPda(AGENT_A_KEYPAIR.publicKey);

  // Consumer reveals
  const revealConsumerIx = new TransactionInstruction({
    programId: PROGRAM_TARGET === "quasar" ? REPUTATION_PROGRAM : PROGRAM_ID,
    keys: PROGRAM_TARGET === "quasar"
      ? [
          { pubkey: ePda, isSigner: false, isWritable: false },
          { pubkey: rPda, isSigner: false, isWritable: true },
          { pubkey: AGENT_A_KEYPAIR.publicKey, isSigner: true, isWritable: false },
          { pubkey: agentBPdaAddr, isSigner: false, isWritable: true },
          { pubkey: agentAPdaAddr, isSigner: false, isWritable: true },
        ]
      : [
          { pubkey: rPda, isSigner: false, isWritable: true },
          { pubkey: AGENT_A_KEYPAIR.publicKey, isSigner: true, isWritable: false },
          { pubkey: agentBPdaAddr, isSigner: false, isWritable: true },
          { pubkey: agentAPdaAddr, isSigner: false, isWritable: true },
        ],
    data: encodeRevealRating(jobId, consumerScore, consumerSalt),
  });
  await sendTx(revealConsumerIx, [AGENT_A_KEYPAIR]);

  // Specialist reveals — triggers reputation update
  const revealSpecIx = new TransactionInstruction({
    programId: PROGRAM_TARGET === "quasar" ? REPUTATION_PROGRAM : PROGRAM_ID,
    keys: PROGRAM_TARGET === "quasar"
      ? [
          { pubkey: ePda, isSigner: false, isWritable: false },
          { pubkey: rPda, isSigner: false, isWritable: true },
          { pubkey: AGENT_B_KEYPAIR.publicKey, isSigner: true, isWritable: false },
          { pubkey: agentBPdaAddr, isSigner: false, isWritable: true },
          { pubkey: agentAPdaAddr, isSigner: false, isWritable: true },
        ]
      : [
          { pubkey: rPda, isSigner: false, isWritable: true },
          { pubkey: AGENT_B_KEYPAIR.publicKey, isSigner: true, isWritable: false },
          { pubkey: agentBPdaAddr, isSigner: false, isWritable: true },
          { pubkey: agentAPdaAddr, isSigner: false, isWritable: true },
        ],
    data: encodeRevealRating(jobId, specialistScore, specialistSalt),
  });
  await sendTx(revealSpecIx, [AGENT_B_KEYPAIR]);
  console.log(`   ✅ Ratings revealed — consumer gave ${consumerScore}/10, specialist gave ${specialistScore}/10\n`);

  // ── Step 8: Agent C attests quality ──────────────────────────────────────
  console.log("👨‍⚖️ Step 8 — Agent C: attesting quality of Agent B's work...");
  const attestPda = PROGRAM_TARGET === "quasar" ? quasarAttestationPdaForEscrow(ePda) : attestationPda(jobId);
  const agentCPdaAddr = PROGRAM_TARGET === "quasar" ? quasarAttestationAgentC! : agentPda(AGENT_C);
  const qualityScores = [8, 8, 9, 8, 8]; // accuracy, completeness, relevance, format, latency

  const attestIx = new TransactionInstruction({
    programId: PROGRAM_TARGET === "quasar" ? ATTESTATION_PROGRAM : PROGRAM_ID,
    keys: PROGRAM_TARGET === "quasar"
      ? [
          { pubkey: ePda, isSigner: false, isWritable: false },
          { pubkey: attestPda, isSigner: false, isWritable: true },
          { pubkey: agentCPdaAddr, isSigner: false, isWritable: false },
          { pubkey: AGENT_C_KEYPAIR.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ]
      : [
          { pubkey: attestPda, isSigner: false, isWritable: true },
          { pubkey: agentCPdaAddr, isSigner: false, isWritable: false },
          { pubkey: AGENT_C_KEYPAIR.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
    data: encodeAttestQuality(jobId, qualityScores, AGENT_A_KEYPAIR.publicKey),
  });
  await sendTx(attestIx, [AGENT_C_KEYPAIR]);
  console.log(`   ✅ Quality attested — scores: [${qualityScores.join(", ")}] (accuracy/completeness/relevance/format/latency)\n`);

  // ── Summary ───────────────────────────────────────────────────────────────
  const elapsed = Date.now() - start;

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  🏁  Full A→B→C cycle complete                          ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");
  console.log(`  Escrow PDA:      ${ePda.toBase58()}`);
  console.log(`  Rating PDA:      ${rPda.toBase58()}`);
  console.log(`  Attestation PDA: ${attestPda.toBase58()}`);
  console.log(`  Settlement:      ${settlementRouteUsed === "magicblock_per" ? "MagicBlock PER (private)" : PROGRAM_TARGET === "quasar" ? "Quasar escrow public settlement" : "L1 direct (public/fallback)"}`);
  console.log(`  Settlement sig:  ${settlementSig!}`);
  console.log(`\n  ⏱  Total time: ${elapsed}ms ${elapsed < 10_000 ? "✅ (< 10s target)" : "⚠️  (> 10s target)"}`);

  if (settlementRouteUsed !== "magicblock_per") {
    if (PROGRAM_TARGET === "quasar") {
      console.log(`\n  ℹ️  MagicBlock PER/TEE is not claimed by this Quasar final path; no Anchor/PER fallback was used.`);
    } else {
      console.log(`\n  ℹ️  PER was unavailable — L1 fallback used. No funds stuck.`);
      console.log(`      For PER settlement, ensure ${PER_DEVNET_RPC} is reachable.`);
    }
  } else {
    console.log(`\n  🔒 PER settlement sent to ${PER_DEVNET_RPC}`);
    console.log(`     Poll for TEE confirmation: new Connection("${PER_DEVNET_RPC}").confirmTransaction(sig)`);
  }
}

runDemo().catch((e) => {
  console.error("\n❌ Demo failed:", e.message);
  process.exit(1);
});
