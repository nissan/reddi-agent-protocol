# Surfpool 1.7.0 SPL escrow proof lane (opt-in)

An opt-in, offline, version-qualified local proof lane that runs the classic SPL token escrow on an
embedded Surfpool `1.7.0` runtime beside the existing local-validator proof, against the same escrow
ELF, and requires both to agree. It is not run by default scripts or CI, and it does not change the
shared Surfpool `v1.5.0` baseline in `config/toolchain/solana-baseline-assets.json` or the root
`@solana/surfpool` `1.5.0` pin.

```bash
npm run setup:surfpool:spl-escrow-1.7
RAP_SURFPOOL_LANE_OUT_DIR=/abs/fresh/dir npm run test:surfpool:spl-escrow-1.7
```

The lane is written for the trimmed nine-instruction program (#736, #746): allowlisted 6-decimal mints
only, a 100-unit cap per escrow, an `authority` signer on release and refund, payee decline at any time,
payer refund from 648,000 slots and payee claim from 1,512,000 slots.

Because neither the Apple Silicon development machine nor a default cloud workspace is Linux x64 with
the pinned toolchain, the lane can also be run on demand in GitHub Actions: the
`Surfpool 1.7 SPL escrow lane (on demand)` workflow (`.github/workflows/surfpool-spl-escrow-1.7-lane.yml`)
installs the pinned Agave release from the checksummed installer named in
`config/toolchain/solana-baseline-assets.json`, runs the lane and uploads `result.json`. It is not a
required check; it also runs when a pull request changes the lane itself.

The lane runs on Linux x64 only. It builds the ELF and runs the validator proof with the
baseline-owned Agave tree installed by `scripts/solana-baseline-toolchain.sh install`
(`~/.local/share/solana/reddi-agent-protocol-baseline/install/active_release/bin`), which must hold
`cargo-build-sbf 4.1.0` and `solana-test-validator 4.2.2`; no other Agave location is accepted.
`RAP_SURFPOOL_LANE_OUT_DIR` must not exist yet; it defaults to a fresh directory under `.tmp/`. The run
writes `result.json` plus the validator proof's log and ledger there.

## Pins

The lane installs into `scripts/surfpool-1.7-lane/` from its own exact lockfile, isolated from the root
install: `@solana/surfpool 1.7.0` (native `@solana/surfpool-linux-x64-gnu 1.7.0`, so Linux x64 only),
`@solana/kit 8.6.0`, and the root lockfile's `@solana/web3.js 1.98.4` / `@solana/spl-token 0.4.14`. The
script refuses to run if the platform is not Linux x64, if an installed lane version differs from the pin
or the lockfile, if the root lockfile's web3/spl-token differ from the lane pin, or if Node is not the
repository's `24.20.0`. The unchanged validator proof loads web3/spl-token through Node's normal lookup,
which is the root `node_modules` when it is installed and the lane's install (through `NODE_PATH`) only
otherwise; the script resolves that install the same way, refuses to run if its version differs from the
pin, and records the path and version it will load. The Kit RPC/signer plugins are not used, so they are
not installed.

## What one run does

1. Refuses to start if escrow sources (`programs/escrow`, `Cargo.toml`, `Cargo.lock`,
   `rust-toolchain.toml`, `Anchor.toml`) differ from `HEAD`, then records the commit and tree hashes.
2. Builds `target/deploy/escrow.so` with the pinned `cargo-build-sbf`, fails if the build left any of
   those source paths (including `Cargo.lock`) differing from `HEAD`, and records the ELF SHA-256.
3. Runs `programs/escrow/tests/local_token_escrow.cjs` unchanged (its own loopback validator, snapshot
   reload and slot warp) and confirms its RPC port refuses connections afterwards.
4. Starts an embedded Surfnet through `startLocalSurfnet` in `scripts/lib/surfpool-sdk-lifecycle.mjs`,
   which forces `offline: true`, `airdropSol: 0`, transaction-mode blocks, loopback dynamic ports and no
   `remoteRpcUrl`. It never runs `surfpool start` and never reads a wallet or `*-keypair.json`.
5. Deploys the built ELF at the fixed program id `794nTFNy…dcZD` and checks the deployed programdata
   bytes equal the ELF.
6. Funds in-memory keypairs with lamports. The program accepts only allowlisted mints, so the lane
   writes a zero-supply stand-in mint, whose authority is the in-memory payer, at the allowlisted
   mainnet USDC address with the `setAccount` cheatcode (the validator proof does the same with a
   genesis account file). Only the address is reused; this is not USDC. Token accounts are created
   and every balance is minted and moved with real SPL instructions; no token-balance cheatcode is used.
7. Exercises, in the validator proof's order: zero-amount, above-cap and non-allowlisted-mint lock
   rejection; exact lock; stranger, early-payee-claim and wrong-recipient release rejection; payer
   release; payee decline with stranger, early-payer-refund and wrong-destination rejection; then, for
   two more escrows, a refund attempt 10 slots before the 648,000-slot cancel window, `timeTravelToSlot`
   past it, stranger and still-too-early payee-claim rejection, payer refund, a claim attempt 10 slots
   before the 1,512,000-slot claim window, `timeTravelToSlot` past it, stranger and wrong-destination
   rejection and payee claim. Every settlement is followed by record and vault closure, replay and
   cross-path replay rejection. It ends with a surplus-donation sweep on a payer release and on a
   payee decline.
8. Stops the Surfnet and confirms both RPC and WebSocket ports refuse connections.
9. Requires parity: same ELF hash in both lanes, same program, mint address, token program, decimals,
   cancel window and claim window, identical source/recipient balances at the point the validator
   proof ends, and a Surfpool check for every outcome the validator proof records.

Every successful transaction is checked for lamport conservation twice: from the runtime's own
`preBalances`/`postBalances` (only the fee leaves), and across all tracked accounts read before and
after. Mint supply must equal the tokens held by the source, recipient and every vault at every
checkpoint. Every rejected transaction must leave every tracked account byte-identical. Closure must
return exactly the record and vault rent to the payer.

## Observed commitment and time-travel behaviour

On Surfpool `1.7.0` with transaction-mode blocks, `timeTravelToSlot` moves the `processed` slot to the
target immediately while `confirmed` and `finalized` stay where they were until the next transaction
lands. The lane therefore asserts the target against `processed`, records all three commitments before
each jump and immediately after it, and asserts that the refund transaction landed at or after the
cancel-window slot and before the claim-window slot, and that the claim landed at or after the
claim-window slot. The refund attempted 10 slots before the cancel window must fail with
`CancelWindowNotElapsed`, the claim attempted 10 slots before the claim window must fail with
`ClaimWindowNotElapsed`, and the `processed` slot read after each rejection must still be below its
window. Locked account data, owner, lamports and rent epoch must be identical before and after each
jump. Transaction confirmation waits for a local `finalized` status. That is local-runtime evidence
only, never public-cluster settlement.

Rejections are asserted by Anchor error code where the program reaches a distinct one: `ZeroAmount`,
`AmountAboveCap`, `MintNotAllowed`, `InvalidTokenAccount` for a wrong recipient or destination,
`CancelWindowNotElapsed`, `ClaimWindowNotElapsed`, and `UnauthorisedSigner` for a signer that is neither
the payer nor the payee. Replays are only required to fail and change nothing, because the closed
escrow record no longer exists.

## Cleanup

The validator proof runs in its own process group. After it exits, the lane waits for that group,
including the validator it started, to be gone and confirms its RPC port refuses connections. The
Surfnet is stopped through the lifecycle helper and both its ports must refuse connections. Any
cleanup step that cannot be confirmed fails the run. On `SIGINT`, `SIGTERM` or the 20-minute overall
timeout, the lane interrupts the validator proof's process group (escalating to `SIGKILL` after 15
seconds), stops the Surfnet, writes a `FAIL` `result.json` whose `stopReason` names the signal or
`timeout` (`null` on an uninterrupted run), and exits 130 or 124. The one exception is an interrupt
during the synchronous `cargo-build-sbf` step: the build fails first, so that run records the build
error and exits 1.

## Provenance in `result.json`

- Source: commit, escrow tree, `Cargo.lock` blob and validator-proof blob.
- Toolchain: Node, every lane package version and lockfile integrity, the Surfpool native module file
  and SHA-256, `cargo-build-sbf` and `solana-test-validator` versions.
- ELF: path, SHA-256 and size.
- Validator lane: the unchanged proof's own `result.json` plus `dependencies`, the install path and
  version of `@solana/web3.js` / `@solana/spl-token` it loaded.
- Surfpool runtime: `getVersion` (`surfnet-version`, `solana-core`, `feature-set`), startup info,
  effective config (offline, no remote RPC, SDK default feature set, no feature overrides), executable
  owner and hashes for the escrow program and the built-in Tokenkeg, rent amounts.
- Every transaction (label, signature, slot, fee, observed status), every rejection with its Anchor
  error code, every time-travel step, conservation counts and the cleanup outcome for both lanes.

## Boundaries

Fidelity is a LiteSVM-based local runtime: no consensus, gossip or cluster-finality equivalence, and the
built-in Tokenkeg is the runtime's own rather than a public snapshot. A pass is not deployment,
mainnet, audit or submission readiness, and the mint is a labelled local stand-in at the allowlisted
address, never real AUDD or USDC.
This lane does not exercise the x402 HTTP 402 challenge, paid retry, replay or application-correctness
assertions, and leaves every existing x402 test and proof unchanged. Adopting Surfpool `1.7.0` as the shared
baseline is a separate change that would update `config/toolchain/solana-baseline-assets.json`, the root
SDK pin and `scripts/check-solana-baseline-pins.mjs` together.
