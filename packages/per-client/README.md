# @reddi/per-client

MagicBlock PER (Private Ephemeral Rollup) delegation evidence client for the Reddi Agent Protocol.

This package is repo-local evidence tooling for bounded RAP Assurance experiments. It is not a mainnet deployment, production custody guarantee, privacy guarantee, or broad private-payee settlement claim.

## Why TypeScript?

PER delegation remains handled here at the TypeScript/client layer for the Anchor 1.1.2 stable upgrade. Do not move MagicBlock SDK ownership into the Rust program without a separate compatibility qualification. The on-chain Anchor program tracks delegation state via `delegate_escrow` and `release_escrow_per` instructions.

## Usage

```ts
import { delegateEscrow, releaseEscrowViaPer, releaseEscrowFallback } from "@reddi/per-client";

// 1. Delegate escrow to PER
const session = await delegateEscrow(escrowPda, payerKeypair, connection);

// 2. Release via TEE in an approved experiment (selected-cluster PER path; not a production privacy claim)
const sig = await releaseEscrowViaPer(programId, escrowPda, payee, payerKeypair, session, connection);

// 3. Poll for TEE confirmation (see note below)
const perConn = new Connection(PER_DEVNET_RPC, "confirmed");
await perConn.confirmTransaction(sig, "confirmed");

// OR: L1 fallback (if TEE unavailable)
const sig = await releaseEscrowFallback(programId, escrowPda, payee, payerKeypair, connection);
```

## Key Addresses

| Address | Purpose |
|---|---|
| `ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1` | MagicBlock Permission Program |
| `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh` | MagicBlock Delegation Program |
| `https://devnet-tee.magicblock.app` | Devnet TEE validator RPC |
| `FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA` | Devnet TEE validator pubkey |

## Notes

### skipPreflight: true (TEE path)

`releaseEscrowViaPer` sends transactions to `devnet-tee.magicblock.app` with `skipPreflight: true`.

**Reason:** The TEE validator runs in an isolated Intel TDX enclave with its own account state
that diverges from the public Solana RPC. The public RPC's preflight simulation cannot see
delegated accounts that exist only inside the TEE's execution context and would incorrectly
reject valid transactions. `skipPreflight: true` bypasses this false rejection.

### Confirmation polling (TEE path)

The signature returned by `releaseEscrowViaPer` must be confirmed against the **TEE RPC**,
not the public Solana RPC. The public RPC has no visibility into the TEE's mempool while
the transaction is in-flight.

```ts
// WRONG — public RPC can't see TEE transactions in-flight
await publicConnection.confirmTransaction(sig);

// CORRECT — poll the TEE endpoint
const perConn = new Connection(PER_DEVNET_RPC, "confirmed");
await perConn.confirmTransaction(sig, "confirmed");
```

Once the TEE finalises and undelegates the escrow account, the transaction becomes visible
on the selected Solana cluster and can be confirmed via that cluster's public RPC. This does
not upgrade the package to mainnet/live-funds readiness.

### Discriminators

All Anchor instruction discriminators come from `idl.ts`, computed as
`SHA256("global:<ix_name>")[0..8]`. Never hardcode raw discriminator bytes.
