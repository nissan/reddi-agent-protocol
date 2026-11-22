# @redditech/per-client

Evidence client for MagicBlock PER (Private Ephemeral Rollup) experiments with the Reddi Agent Protocol.

This package is repo-local evidence tooling for bounded RAP Assurance experiments. It is not a mainnet deployment, production custody guarantee, privacy guarantee, or broad private-payee settlement claim.

## What it does

| Function | What it sends | Works with the V1 program build |
|---|---|---|
| `delegateEscrow` | One transaction to MagicBlock's Permission Program and Delegation Program. It does not call the escrow program. | It never touches the escrow program, so nothing on the escrow account records the session. |
| `releaseEscrowViaPer` | The escrow program's `release_escrow_per`, to the TEE RPC endpoint. | No. The V1 build does not answer `release_escrow_per`; the transaction fails. |
| `releaseEscrowFallback` | The escrow program's ordinary `release_escrow`, to the public RPC. | Yes. This is the only release path here that the V1 build accepts. |

The escrow program's PER tracking instructions (`delegate_escrow`, `release_escrow_per`) are not in the V1 program build. They sit behind the program's `per` feature, which is off by default, unfinished, and never used for a mainnet build. Integrating with MagicBlock's service is post-V1 work, tracked in issue #839. Until then, treat `delegateEscrow` and `releaseEscrowViaPer` as experiment code for a `per`-feature build on a local or devnet lane.

`release_escrow` takes five accounts, in this order: escrow (writable), payer (signer, writable), payee (writable), protocol treasury `5CsBuTBFKu12JSs4CUbmv5MR218RYtNmAoQmLf5x3Hxe` (writable), System program. The escrow's lock slot (`created_slot`, u64 little-endian) follows the selector: it names the escrow being ended, so a release signed for one escrow cannot end a later one at the same address. `buildReleaseEscrowInstruction` takes it as `createdSlot`, `escrowCreatedSlot` reads it from the escrow record, and `releaseEscrowFallback` reads it and sends the release. An escrow that was opted in to rating also needs its rating account after those five; this package does not add it (see the rating module of `@redditech/x402-solana`).

## Why TypeScript?

PER delegation stays at the TypeScript/client layer. Do not move MagicBlock SDK ownership into the Rust program without a separate compatibility qualification.

## Usage

With the V1 program build:

```ts
import { releaseEscrowFallback } from "@redditech/per-client";

const sig = await releaseEscrowFallback(programId, escrowPda, payee, payerKeypair, connection);
```

Against a program built with the `per` feature, in an approved experiment only (selected-cluster PER path; not a production privacy claim):

```ts
import { delegateEscrow, releaseEscrowViaPer, PER_DEVNET_RPC } from "@redditech/per-client";

// 1. Ask MagicBlock's Permission and Delegation programs for a session
const session = await delegateEscrow(escrowPda, payerKeypair, connection);

// 2. Send release_escrow_per to the TEE endpoint
const sig = await releaseEscrowViaPer(programId, escrowPda, payee, payerKeypair, session, connection);

// 3. Poll for TEE confirmation (see note below)
const perConn = new Connection(PER_DEVNET_RPC, "confirmed");
await perConn.confirmTransaction(sig, "confirmed");
```

## Key Addresses

| Address | Purpose |
|---|---|
| `ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1` | MagicBlock Permission Program |
| `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh` | MagicBlock Delegation Program |
| `https://devnet-tee.magicblock.app` | Devnet TEE validator RPC |
| `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo` | Devnet TEE validator pubkey this package exports (`PER_DEVNET_VALIDATOR_PUBKEY`); not checked against MagicBlock here |

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

Escrow program selectors come from `idl.ts`, computed as
`SHA256("global:<ix_name>")[0..8]`. A name in that list does not mean a given
build answers it. The two MagicBlock program discriminators in `client.ts` are
those programs' own bytes.
