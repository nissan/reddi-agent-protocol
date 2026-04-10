"use client";

import { useEffect, useState } from "react";
import { Connection } from "@solana/web3.js";
import {
  ESCROW_PROGRAM_ID,
  DEVNET_RPC,
  ACCOUNT_DISC,
  decodeAgentAccount,
  type OnchainAgent,
} from "@/lib/program";

export interface OnchainAgentWithPda extends OnchainAgent {
  pda: string;
}

export function useOnchainAgents(): {
  agents: OnchainAgentWithPda[];
  loading: boolean;
  error: string | null;
} {
  const [agents, setAgents] = useState<OnchainAgentWithPda[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetch() {
      setLoading(true);
      setError(null);
      try {
        const conn = new Connection(DEVNET_RPC, "confirmed");
        const disc = ACCOUNT_DISC.AgentAccount;

        const accounts = await conn.getProgramAccounts(ESCROW_PROGRAM_ID, {
          commitment: "confirmed",
          filters: [
            {
              // AgentAccount discriminator is the first 8 bytes
              memcmp: { offset: 0, bytes: Buffer.from(disc).toString("base64") },
            },
            // Minimum size: discriminator(8) + fixed fields — filter out dust
            { dataSize: 150 },
          ],
        });

        if (cancelled) return;

        const decoded = accounts
          .map(({ pubkey, account }) => {
            const agent = decodeAgentAccount(Buffer.from(account.data));
            if (!agent) return null;
            return { ...agent, pda: pubkey.toBase58() };
          })
          .filter((a): a is OnchainAgentWithPda => a !== null);

        setAgents(decoded);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to fetch on-chain agents");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetch();
    return () => { cancelled = true; };
  }, []);

  return { agents, loading, error };
}
