#!/usr/bin/env ts-node
/**
 * register-new-agent-demo.ts — one-off devnet CLI demo registration.
 *
 * Generates an ephemeral owner keypair in memory, funds it from the configured
 * devnet payer, submits register_agent, and writes a public-only summary.
 */
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { DEVNET_RPC, DEVNET_RPC_WS, PROGRAM_TARGET, REGISTRY_PROGRAM_ID, explorerTxUrl } from "./config";
import { buildDemoRegisterAgentInstruction, demoAgentPda } from "./registration-instruction";

const AgentType = { Primary: 0, Attestation: 1, Both: 2 } as const;

function loadKeypair(file: string): Keypair {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(raw)) throw new Error(`Keypair file is not a byte array: ${file}`);
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function solscanTxUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}?cluster=devnet`;
}

async function main() {
  const runId = `agent-registration-${new Date().toISOString().replace(/[:.]/g, "")}`;
  const outDir = process.env.DEMO_REGISTRATION_OUT_DIR || path.join(process.cwd(), "artifacts", "agent-registration-cli", runId);
  mkdirSync(outDir, { recursive: true });

  const connection = new Connection(DEVNET_RPC, DEVNET_RPC_WS ? { commitment: "confirmed", wsEndpoint: DEVNET_RPC_WS } : "confirmed");
  const programId = new PublicKey(REGISTRY_PROGRAM_ID);
  const funderPath = process.env.DEMO_REGISTRATION_FUNDER_KEYPAIR || "/Users/loki/.config/solana/id.json";
  const funder = loadKeypair(funderPath);
  const owner = Keypair.generate();
  const agentPda = demoAgentPda(owner.publicKey, programId);

  const label = process.env.DEMO_AGENT_LABEL || `RAP Peekaboo CLI Agent ${runId.slice(-6)}`;
  const model = process.env.DEMO_AGENT_MODEL || "qwen3:8b-cli-demo";
  const rateLamports = BigInt(process.env.DEMO_AGENT_RATE_LAMPORTS || "1000000");
  const minReputation = Number(process.env.DEMO_AGENT_MIN_REPUTATION || "0");
  const fundingLamports = Number(process.env.DEMO_AGENT_FUNDING_LAMPORTS || String(Math.floor(0.025 * LAMPORTS_PER_SOL)));

  console.log("Reddi Agent Protocol — CLI agent registration demo");
  console.log(`Run ID: ${runId}`);
  console.log(`Network: devnet`);
  console.log(`RPC: ${DEVNET_RPC}`);
  console.log(`Registry program: ${REGISTRY_PROGRAM_ID}`);
  console.log(`Program target: ${PROGRAM_TARGET}`);
  console.log("");
  console.log("New agent metadata");
  console.log(`  label: ${label}`);
  console.log(`  model: ${model}`);
  console.log(`  type: Primary`);
  console.log(`  rate: ${rateLamports.toString()} lamports per call`);
  console.log(`  owner: ${owner.publicKey.toBase58()}`);
  console.log(`  agent PDA: ${agentPda.toBase58()}`);
  console.log("");

  console.log(`Funding ephemeral owner with ${fundingLamports} lamports for rent + registration fee...`);
  const fundingTx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: owner.publicKey, lamports: fundingLamports }),
  );
  const fundingSig = await sendAndConfirmTransaction(connection, fundingTx, [funder], { commitment: "confirmed" });
  console.log(`  funding tx: ${fundingSig}`);
  console.log(`  solscan: ${solscanTxUrl(fundingSig)}`);
  console.log(`  explorer: ${explorerTxUrl(fundingSig)}`);
  console.log("");

  console.log("Submitting register_agent instruction...");
  const registerIx = buildDemoRegisterAgentInstruction({
    target: PROGRAM_TARGET,
    programId,
    owner: owner.publicKey,
    agentType: AgentType.Primary,
    model,
    rateLamports,
    minReputation,
  });
  const registerTx = new Transaction().add(registerIx);
  const registerSig = await sendAndConfirmTransaction(connection, registerTx, [owner], { commitment: "confirmed" });
  console.log(`  registration tx: ${registerSig}`);
  console.log(`  solscan: ${solscanTxUrl(registerSig)}`);
  console.log(`  explorer: ${explorerTxUrl(registerSig)}`);
  console.log("");

  const account = await connection.getAccountInfo(agentPda, "confirmed");
  console.log("On-chain readback");
  console.log(`  agent PDA exists: ${Boolean(account)}`);
  console.log(`  owner program: ${account?.owner.toBase58() ?? "missing"}`);
  console.log(`  data bytes: ${account?.data.length ?? 0}`);
  console.log(`  lamports: ${account?.lamports ?? 0}`);

  const summary = {
    runId,
    network: "devnet",
    rpc: DEVNET_RPC,
    programTarget: PROGRAM_TARGET,
    registryProgram: REGISTRY_PROGRAM_ID,
    label,
    model,
    type: "Primary",
    rateLamports: rateLamports.toString(),
    minReputation,
    owner: owner.publicKey.toBase58(),
    agentPda: agentPda.toBase58(),
    funding: {
      funder: funder.publicKey.toBase58(),
      lamports: fundingLamports,
      signature: fundingSig,
      solscan: solscanTxUrl(fundingSig),
      explorer: explorerTxUrl(fundingSig),
    },
    registration: {
      signature: registerSig,
      solscan: solscanTxUrl(registerSig),
      explorer: explorerTxUrl(registerSig),
    },
    readback: {
      exists: Boolean(account),
      ownerProgram: account?.owner.toBase58() ?? null,
      dataBytes: account?.data.length ?? 0,
      lamports: account?.lamports ?? 0,
    },
    boundary: "Devnet-only CLI demo registration. Ephemeral owner secret is generated in memory and not written to disk. No mainnet registration claim.",
  };

  const summaryPath = path.join(outDir, "summary.json");
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log("");
  console.log(`Public summary written: ${summaryPath}`);
  console.log("✅ CLI registration complete");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
