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

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function toBase58(bytes: Buffer): string {
  let x = BigInt("0x" + bytes.toString("hex") || "0");
  let out = "";
  while (x > 0n) { out = BASE58[Number(x % 58n)] + out; x /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = "1" + out; }
  return out;
}

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
              // memcmp.bytes must be base58-encoded per Solana JSON-RPC spec
              memcmp: { offset: 0, bytes: toBase58(disc) },
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
    // Refresh every 30s so newly registered agents appear without page reload
    const timer = setInterval(fetch, 30_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  return { agents, loading, error };
}
