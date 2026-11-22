/**
 * Devnet cluster check for server-side sandbox signers.
 *
 * The sandbox escrow program id is the same on devnet and mainnet, so the RPC URL alone
 * decides which cluster a server-held key signs for (audit S2-claude-01). Signers call
 * `isDevnetConnection` before signing and refuse anything that is not devnet.
 */
export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

type GenesisReader = { getGenesisHash(): Promise<string> };

const confirmed = new WeakSet<object>();

/** True only when the connection's genesis hash is devnet's. A confirmed connection is cached. */
export async function isDevnetConnection(connection: GenesisReader): Promise<boolean> {
  if (confirmed.has(connection)) return true;
  try {
    if ((await connection.getGenesisHash()) !== DEVNET_GENESIS_HASH) return false;
  } catch {
    return false;
  }
  confirmed.add(connection);
  return true;
}
