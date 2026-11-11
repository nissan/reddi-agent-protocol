# Surfpool 1.7.0 SPL escrow proof lane (opt-in)

An opt-in, offline, version-qualified local proof lane that runs the classic SPL token escrow on an
embedded Surfpool `1.7.0` runtime beside the existing local-validator proof, against the same escrow
ELF, and requires both to agree. It is not run by default scripts or CI, and it does not change the
shared Surfpool `v1.5.0` baseline in `config/toolchain/solana-baseline-assets.json` or the root
`@solana/surfpool` `1.5.0` pin.

```bash
npm run setup:surfpool:spl-escrow-1.7
RAP_AGAVE_BIN_DIR=/abs/agave-4.2.2/bin RAP_SURFPOOL_LANE_OUT_DIR=/abs/fresh/dir npm run test:surfpool:spl-escrow-1.7
```

`RAP_AGAVE_BIN_DIR` defaults to the baseline-owned Agave tree installed by
`scripts/solana-baseline-toolchain.sh install`; it must hold `cargo-build-sbf 4.1.0` and
`solana-test-validator 4.2.2`. `RAP_SURFPOOL_LANE_OUT_DIR` must not exist yet; it defaults to a fresh
directory under `.tmp/`. The run writes `result.json` plus the validator proof's log and ledger there.

## Pins

The lane installs into `scripts/surfpool-1.7-lane/` from its own exact lockfile, isolated from the root
install: `@solana/surfpool 1.7.0` (native `@solana/surfpool-linux-x64-gnu 1.7.0`), `@solana/kit 8.6.0`,
and the root lockfile's `@solana/web3.js 1.98.4` / `@solana/spl-token 0.4.14`. The script refuses to
run if an installed version differs from the pin or the lockfile, if the root lockfile's web3/spl-token
differ from the lane pin, or if Node is not the repository's `24.20.0`. The Kit RPC/signer plugins are
not used, so they are not installed.

## What one run does

1. Refuses to start if escrow sources (`programs/escrow`, `Cargo.toml`, `Cargo.lock`,
   `rust-toolchain.toml`, `Anchor.toml`) differ from `HEAD`, then records the commit and tree hashes.
2. Builds `target/deploy/escrow.so` with the pinned `cargo-build-sbf` and records its SHA-256.
3. Runs `programs/escrow/tests/local_token_escrow.cjs` unchanged (its own loopback validator, snapshot
   reload and slot warp) and confirms its RPC port refuses connections afterwards.
4. Starts an embedded Surfnet through `startLocalSurfnet` in `scripts/lib/surfpool-sdk-lifecycle.mjs`,
   which forces `offline: true`, `airdropSol: 0`, transaction-mode blocks, loopback dynamic ports and no
   `remoteRpcUrl`. It never runs `surfpool start` and never reads a wallet or `*-keypair.json`.
5. Deploys the built ELF at the fixed program id `794nTFNy…dcZD` and checks the deployed programdata
   bytes equal the ELF.
6. Funds in-memory keypairs with lamports, then creates a fresh local mint and token accounts with real
   SPL instructions. No token cheatcode is used, so token balances come only from real transfers.
7. Exercises zero-amount rejection, exact lock, wrong signer and wrong recipient rejection, release,
   record and vault closure, replay rejection, early and near-boundary refund rejection,
   `timeTravelToSlot` past the 50,400-slot cancel window, wrong signer and wrong destination refund
   rejection, refund, closure, replay and cross-path replay rejection, and surplus-donation sweep on
   both release and refund.
8. Stops the Surfnet and confirms both RPC and WebSocket ports refuse connections.
9. Requires parity: same ELF hash in both lanes, same program, token program, decimals and cancel
   window, identical source/recipient balances at the point the validator proof ends, and a Surfpool
   check for every outcome the validator proof records.

Every successful transaction is checked for lamport conservation twice: from the runtime's own
`preBalances`/`postBalances` (only the fee leaves), and across all tracked accounts read before and
after. Mint supply must equal the tokens held by the source, recipient and every vault at every
checkpoint. Every rejected transaction must leave every tracked account byte-identical. Closure must
return exactly the record and vault rent to the payer.

## Observed commitment and time-travel behaviour

On Surfpool `1.7.0` with transaction-mode blocks, `timeTravelToSlot` moves the `processed` slot to the
target immediately while `confirmed` and `finalized` stay where they were until the next transaction
lands. The lane therefore asserts the target against `processed`, records all three commitments before
the jump, immediately after it and after the first post-jump transaction, and asserts that the refund
transaction landed at or after the cancel-window slot. The refund attempted 10 slots before the window
must fail with `CancelWindowNotElapsed`, and the `processed` slot read after that rejection must still be
below the window. Locked account data, owner, lamports and rent epoch must be identical before and after
the jump. Transaction confirmation waits for a local `finalized` status. That is local-runtime evidence
only, never public-cluster settlement.

Rejections are asserted by Anchor error code where the program reaches a distinct one: `ZeroAmount`,
`InvalidTokenAccount` for a wrong recipient or destination, `CancelWindowNotElapsed`, and
`ConstraintSeeds` for a wrong signer, because the escrow address is derived from the recorded payer.

## Cleanup

The validator proof runs in its own process group. After it exits, the lane waits for that group,
including the validator it started, to be gone and confirms its RPC port refuses connections. The
Surfnet is stopped through the lifecycle helper and both its ports must refuse connections. Any
cleanup step that cannot be confirmed fails the run. On `SIGINT`, `SIGTERM` or the 20-minute overall
timeout, the lane interrupts the validator proof's process group (escalating to `SIGKILL` after 15
seconds), stops the Surfnet, writes a `FAIL` `result.json` and exits 130 or 124.

## Provenance in `result.json`

- Source: commit, escrow tree, `Cargo.lock` blob and validator-proof blob.
- Toolchain: Node, every lane package version and lockfile integrity, the Surfpool native module file
  and SHA-256, `cargo-build-sbf` and `solana-test-validator` versions.
- ELF: path, SHA-256 and size.
- Surfpool runtime: `getVersion` (`surfnet-version`, `solana-core`, `feature-set`), startup info,
  effective config (offline, no remote RPC, SDK default feature set, no feature overrides), executable
  owner and hashes for the escrow program and the built-in Tokenkeg, rent amounts.
- Every transaction (label, signature, slot, fee, observed status), every rejection with its Anchor
  error code, every time-travel step, conservation counts and the cleanup outcome for both lanes.

## Boundaries

Fidelity is a LiteSVM-based local runtime: no consensus, gossip or cluster-finality equivalence, and the
built-in Tokenkeg is the runtime's own rather than a public snapshot. A pass is not deployment,
mainnet, audit or submission readiness, and the mint is a labelled local test mint, never AUDD or USDC.
This lane does not exercise the x402 HTTP 402 challenge, paid retry, replay or application-correctness
assertions, and leaves every existing x402 test and proof unchanged. Adopting Surfpool `1.7.0` as the shared
baseline is a separate change that would update `config/toolchain/solana-baseline-assets.json`, the root
SDK pin and `scripts/check-solana-baseline-pins.mjs` together.
