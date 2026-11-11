# Local synthetic puzzle-analysis service

This Reddi Agent Protocol example runs a buyer and HTTP seller against the classic SPL escrow program. It uses an original synthetic 3×3 puzzle and a freshly generated **LOCAL TEST MINT**, never AUDD. It does not load wallet files or sign on devnet. Package imports resolve to the repository's built `dist`, not a claimed public npm release.

From the repository root, with the pinned Solana baseline available:

```bash
npm ci --prefix packages/x402-solana
npm run build --prefix packages/x402-solana
cargo build-sbf --manifest-path programs/escrow/Cargo.toml --sbf-out-dir target/deploy
RAP_TEST_VALIDATOR=/absolute/path/to/solana-test-validator \
RAP_LOCAL_EXAMPLE_DIR=/absolute/fresh/disposable/directory \
node packages/x402-solana/examples/local-puzzle.cjs
```

The validator must be Agave 4.2.2. `RAP_ESCROW_SO` optionally selects an absolute build-artifact path instead of `target/deploy/escrow.so`. The harness checks unused ports, starts its own loopback validator with the escrow program loaded at genesis, and stops only that child. It captures the public classic Token program account and linked programdata, reloads their bytes into a fresh local ledger, and warps to slot 1000 before the HTTP flow. This snapshot-and-warp method is local compatibility evidence, not a normal-slot or devnet execution claim. The payer and payee keypairs are disposable and exist only in memory; they are never written to disk. The validator's genesis mint funds the local payer. No faucet or external RPC is used. The output directory must not exist; keep it outside the repository. It contains validator logs and public `result.json` evidence, and the child validator writes its own disposable identity, vote and faucet keypairs under the `ledger/` and `snapshot-ledger/` subdirectories; never read, copy or commit those files.

The harness always uses the classic SPL Token program and the local test mint it provisions with 6 decimals. The package functions take the mint address, token program and decimals as explicit parameters, never from a hardcoded AUDD identity or currency symbol. The `startSeller(connection, config)` / `runBuyer(connection, payer, config, endpoint)` service APIs accept a supplied mint address, token program, decimals, source and recipient for separately provisioned local accounts. The package accepts `solana-devnet` challenges with explicit genesis, mint and program configuration, but this executable buyer remains loopback/local only. A future authorized devnet caller supplies its own signing adapter and confirmed deployment/mint configuration; actual AUDD devnet identity and deployment readiness remain unknown.

The buyer requests analysis, receives HTTP 402 with `x402-request`, pins every financial/configuration field and a 400000 raw-unit cap, submits the SPL lock, then retries with `x402-payment` containing the nonce and finalized lock signature. The seller checks its stored challenge, request bytes, cluster genesis, successful finalized exact instruction, program-owned locked escrow and funded classic-token vault. It consumes the challenge and returns `x402-receipt` with **status `locked`** plus the analysis. The buyer independently checks the result, then signs release to the recipient recorded at lock. The harness verifies balances, closure, and replay rejection.

This is the RAP-specific `rap-spl-escrow-v1` extension, not a claim of compatibility with the standard x402 SVM `exact` scheme. A locked receipt proves observed funding at the stated slot. It does not prove settlement, puzzle correctness, quality, or delivery. The release signature is separate; successful release closes the escrow record and vault to the payer. The package exposes refund construction to the original source; the program enforces its existing 50400-slot window. The example does not shorten or bypass it.

The synthetic exact-count result is independently checked over all three-cell combinations. It is not a Soloku catalogue entry, release certification, or Soloku `soloku-proof-1` T0–T2 deduction certificate. Soloku's existing correctness proof and this payment receipt remain distinct.

If a paid retry fails or the seller disappears, retain the lock signature/challenge before retrying or releasing. `EscrowPurchaseError` carries both when a paid retry fails. The buyer helper submits at most one lock; it never automatically pays again or releases on receipt alone. The single-process seller consumes a challenge once; it has no durable delivery cache or recovery across restarts. A response lost after redemption needs application recovery, not a second payment. Production use would need durable atomic challenge/receipt storage, authenticated buyer sessions and explicit fulfillment/recovery policy. No production, devnet execution, mainnet, or public package publication is established here.

Use-case fit assessed read-only on 2026-11-10:

- **Chosen: Soloku.** Its current puzzle-core/exact-counter and independently replayed deduction-proof boundary makes paid synthetic puzzle analysis concrete; this example implements and checks the service without copying project code or catalogue data.
- **Rejected: BattleBlocks.** Its current first-release default is single-player with on-device AI and wallet features off; an external paid agent service is a weaker fit and would not belong in that default.
- **Rejected: Oz Startup Brain candidate (Shared Brain).** Its README describes read-only retrieval and governed canonical knowledge; synthetic research retrieval is feasible, but puzzle analysis provides a smaller independently verifiable service. No corpus, private fixtures or excerpts were inspected or copied, and no canonical write authority is used.
