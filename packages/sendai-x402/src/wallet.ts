import { Keypair } from "@solana/web3.js";

/**
 * Load a Solana keypair from the SOLANA_KEYPAIR environment variable.
 * Each SAK agent instance reads this independently so there is no shared
 * state between agents running in separate processes.
 *
 * @throws Error if SOLANA_KEYPAIR is not set or is malformed
 */
export function loadKeypairFromEnv(): Keypair {
  const raw = process.env.SOLANA_KEYPAIR;
  if (!raw) throw new Error("SOLANA_KEYPAIR env var not set");
  let bytes: number[];
  try {
    bytes = JSON.parse(raw);
  } catch {
    throw new Error("SOLANA_KEYPAIR must be a JSON array of bytes");
  }
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}
