#!/usr/bin/env ts-node
/**
 * fund-agents.ts — Airdrop or transfer SOL to all three agent wallets.
 *
 * Uses `solana airdrop` if available; falls back to a warning instructing
 * manual funding via the blitz-dev wallet if rate-limited.
 *
 * Run: npm run fund
 */
import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { AGENT_A, AGENT_B, AGENT_C } from "./wallets";
import { DEVNET_RPC, DEVNET_RPC_WS } from "./config";
import { shellQuote } from "./quasar-target-gate";

async function fund() {
  const connection = new Connection(DEVNET_RPC, DEVNET_RPC_WS ? { commitment: "confirmed", wsEndpoint: DEVNET_RPC_WS } : "confirmed");
  const agents = [
    { name: "Agent A (Orchestrator)", pk: AGENT_A },
    { name: "Agent B (Specialist)", pk: AGENT_B },
    { name: "Agent C (Judge)", pk: AGENT_C },
  ];

  for (const { name, pk } of agents) {
    const balance = await connection.getBalance(pk);
    const sol = balance / LAMPORTS_PER_SOL;
    console.log(`${name}: ${pk.toBase58()} — ${sol.toFixed(4)} SOL`);

    if (sol < 0.01) {
      console.log(`  ⚠️  Low balance. Requesting airdrop...`);
      try {
        const sig = await connection.requestAirdrop(pk, LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig, "confirmed");
        const newBal = await connection.getBalance(pk);
        console.log(`  ✅ Airdropped 1 SOL — new balance: ${(newBal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
      } catch {
        console.log(`  ❌ Airdrop failed (rate-limited?). Manual funding required:`);
        console.log(`     solana transfer ${pk.toBase58()} 0.1 --url ${shellQuote(DEVNET_RPC)} --keypair <local-funder-keypair> --allow-unfunded-recipient`);
      }
    } else {
      console.log(`  ✅ Sufficiently funded`);
    }
  }
}

fund().catch((error) => {
  console.error(error);
  process.exit(1);
});
