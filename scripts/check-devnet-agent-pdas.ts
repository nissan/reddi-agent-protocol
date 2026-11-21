#!/usr/bin/env ts-node
/**
 * Read-only devnet PDA inspection for demo-agent registrations.
 *
 * This script does not sign or send transactions. It loads the demo-agent wallet
 * public keys from packages/demo-agents/.env.devnet and checks expected agent
 * PDAs under the legacy Anchor program plus the Quasar registry program.
 */
import { Connection, PublicKey } from "@solana/web3.js";

import { AGENT_A, AGENT_B, AGENT_C } from "../packages/demo-agents/src/wallets";
import { AGENT_SEED } from "../packages/demo-agents/src/config";

const RPC = process.env.DEMO_DEVNET_RPC ?? process.env.NEXT_PUBLIC_RPC_ENDPOINT ?? "https://api.devnet.solana.com";
const PROGRAMS = [
  ["legacy-anchor", new PublicKey("DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu")],
  ["quasar-registry", new PublicKey("Xk7jczJZ1HHJZuE1ZUWDqFmowxYhnom7mWzrNSGf9FU")],
] as const;
const AGENTS = [
  ["A", AGENT_A],
  ["B", AGENT_B],
  ["C", AGENT_C],
] as const;

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const result = {
    rpc: RPC,
    checkedAt: new Date().toISOString(),
    programs: [] as Array<{
      label: string;
      programId: string;
      agents: Array<{
        label: string;
        owner: string;
        pda: string;
        exists: boolean;
        lamports: number;
        dataLength: number;
      }>;
    }>,
  };

  for (const [programLabel, programId] of PROGRAMS) {
    const program = { label: programLabel, programId: programId.toBase58(), agents: [] as typeof result.programs[number]["agents"] };
    for (const [agentLabel, owner] of AGENTS) {
      const [pda] = PublicKey.findProgramAddressSync([AGENT_SEED, owner.toBytes()], programId);
      const account = await connection.getAccountInfo(pda, "confirmed");
      program.agents.push({
        label: agentLabel,
        owner: owner.toBase58(),
        pda: pda.toBase58(),
        exists: Boolean(account),
        lamports: account?.lamports ?? 0,
        dataLength: account?.data.length ?? 0,
      });
    }
    result.programs.push(program);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
