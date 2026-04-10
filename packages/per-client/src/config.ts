/**
 * MagicBlock PER network configuration.
 *
 * TEE validator endpoint: transactions sent here are executed privately
 * inside Intel TDX and remain hidden from the public mempool while in-flight.
 * The TEE then undelegates accounts and finalises on Solana mainnet.
 */

/** Devnet TEE validator RPC endpoint */
export const PER_DEVNET_RPC = "https://devnet-tee.magicblock.app";

/** Devnet TEE validator pubkey (for identity verification) */
export const PER_DEVNET_VALIDATOR_PUBKEY =
  "FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA";

/** MagicBlock Permission Program address */
export const PERMISSION_PROGRAM_ID =
  "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1";

/** MagicBlock Delegation Program address */
export const DELEGATION_PROGRAM_ID =
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh";
