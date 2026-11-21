# Changelog — @reddi/x402-solana

All notable changes to this package are documented here. Dates are AEST.

## Unreleased

### Added

- `rating` module (`@reddi/x402-solana/rating`, also re-exported from the root): client side of the ratings and judge attestations the V1 program source ties to a job paid through escrow (#841). Builders for `open_rating`, `accept_rating`, `commit_rating`, `reveal_rating`, `expire_rating`, `close_rating`, `attest_quality`, `confirm_attestation`, `dispute_attestation` and `close_attestation`; `ratingPda`, `attestationPda`, `agentPda`, `solEscrowPda`; `decodeRatingAccount` and `decodeAttestationAccount`; `ratingCommitment`; the escrow flag bits (`escrowFlags`, `escrowAccountFlags`, `isRatedEscrow`); `withRatingAccount`, which adds the rating account to an exit of a rated escrow and returns the exit of any other escrow untouched; SOL escrow lock and exit builders; `buildRatedTokenEscrowLock` / `buildRatedSolEscrowLock` (lock and opt in, one transaction); `readRatingAccount` and `payerReleaseOpensRating` for a buyer deciding when to release; `readEscrowRatingStatus` and `buildSellerAcceptRating` for sellers. Every builder and decoder is tested byte for byte against `programs/pinocchio-escrow/interface/vectors.json`. `RATING_PROGRAM_ERRORS` and `ratingProgramErrorName` name the program's rating and attestation error codes (6010 to 6019, 6033 to 6049), held to `error.rs` by a test. The seller agrees to be rated by `accept_rating` or by being the authority of a claim or settle; a seller's claim transaction must not carry the payer's signature. It signs and sends nothing, and no deployed program answers these instructions yet.
- `provider` module (`@reddi/x402-solana/provider`, also re-exported from the root): the seller side of a per-token call (#826). `providerMeteredTerms`, `meteredOffer` (estimate, a suggested maximum of twice the estimate, the fee if the estimate holds, the minimum lock), `readMeteredPaymentHeader`, `meteredPaymentHeaderValue`, `checkProviderCluster` (the mainnet genesis hash cannot be replaced), `verifyMeteredLock`, `usageFrom`, `meteredSettlement` and `meteredDecline`. Moved from `packages/openrouter-specialists`, which now imports it; instruction encodings are unchanged. It reads no key and sends no transaction. New subpath exports: `./provider`, `./metered`, `./token-escrow`, `./escrow-readiness`.
- Read-only SPL `TransferChecked` observation verifier for parsed deterministic transaction fixtures. It checks successful transaction metadata, confirmation metadata, transaction-signature match, exact mint/program/payee owner/destination/amount, optional memo binding, exactly one match, and replay protection without RPC, wallets, signers, secrets, or live submission.
- AUDD bridge in `SolanaReceiptVerifier` that uses the stricter x402 v2 SVM `exact` verifier only when an AUDD mint is explicitly configured (never inferred from the receipt), while retaining legacy SOL/USDC compatibility.
- `token-escrow` and `escrow-http` modules, re-exported from the package root (no new subpath exports): classic SPL token-escrow instruction builders/decoder and the RAP-specific `rap-spl-escrow-v1` HTTP 402 → finalized lock → paid retry → `locked` receipt flow (`EscrowSeller`, `buyWithEscrow`, `verifyEscrowLock`). Mint, classic token program and decimals are explicit parameters. A runnable loopback-only seller/buyer example lives in `examples/` (not shipped in the tarball); see `examples/README.md`. No public npm publication, devnet signing, or settlement claim is established.
- `DatabaseReplayStore`: a durable replay store that calls an atomic database function (default `replay_check_and_store`, taking `p_key` and returning a boolean) through a caller-supplied `rpc`, so a key is accepted once across restarts and instances (#723). The package gains no database dependency. A database error or an unexpected answer throws and the payment is not accepted. The database function itself is proposed separately and is not applied anywhere by this package.
- `solAmountToLamports`, `SOLANA_GENESIS_HASHES` and `DEFAULT_MAX_TRANSACTION_AGE_SECONDS` exports.

### Changed

- `decodeTokenEscrowAccount` reads `metered` as bit `0x01` of the flag byte and exposes `rated` (bit `0x02`). It used to compare the byte with 1, which read a rated metered escrow (3) as not metered.
- `verifyEscrowLock` and `EscrowSeller` (fixed-price seller) read the rated bit and refuse a rated escrow before serving (`rated escrow declined`) unless `acceptRatedEscrows` is set; an accepted one yields a receipt with `rated: true`, and `buildEscrowSellerExit` builds the seller's claim or decline with the rating account. Without it the program refuses every exit of a rated escrow (6033), so a seller that served one could not claim or decline it. Receipts and exits of an escrow that is not rated are unchanged.
- `verifyMeteredLock` refuses an escrow the buyer opted in to rating (`rated_escrow_declined`) before serving, unless the new `acceptRatedEscrows` option is true. A verified lock carries `rated`; for a rated lock `meteredSettlement` and `meteredDecline` pass the rating account, and `confirmMeteredSettlement` takes an optional `rating` the transaction must name. Nothing changes for an escrow that is not rated.
- Payout hardening for the seller side (#847). `verifyMeteredLock` now also reads the accounts a settle would pay into (`checkMeteredPayout`): the provider's token account or its recovery account (`MeteredTerms.payoutAccount`), the treasury's, and the source account the lock recorded for the unused part. Each must exist under the mint's token program, be initialised, not frozen, hold the mint, have the right owner and not require a memo; otherwise the lock is refused (`refund_account_unusable`, `provider_not_ready`) before it is recorded, so it stays usable. A verified lock carries `payout`, and `meteredSettlement` pays into it: one instruction, nothing created. For a Token-2022 mint with a transfer fee extension the mint is passed writable (`harvestWithheldFees`).
- `prepareTokenPayout` creates nothing by default. `createTreasuryAccount` and `createRefundAccount` are explicit options, and `refundTo` names another account of the payer. Callers that relied on the two idempotent creates must opt in.
- `checkTreasuryReadiness` decodes the whole token account and requires it initialised, not frozen and not memo-requiring (`checkTokenAccount`, also exported).
- `confirmMeteredSettlement` reads what a confirmed settle moved from a `SettlementRecord` (programs called, accounts named, token balances before and after): the provider's credit and the fee as the amount billed, the buyer's unused part, and any surplus returned on top. It refuses a failed or unrelated transaction and amounts that do not add up.

- `SolanaReceiptVerifier` limits transaction age and checks the network (#738). For a `solana-mainnet-beta` challenge it refuses a transaction whose block time is missing, more than 900 seconds old (`maxTransactionAgeSeconds` can change the limit, not remove it) or in the future, and it requires the connection to report the public mainnet genesis hash through `getGenesisHash`. On other networks both checks run only when `maxTransactionAgeSeconds` or `expectedGenesisHash` is set, so local validators and existing devnet callers behave as before. No mainnet payment has been verified with this code; these are checks, not a mainnet readiness claim.
- SOL amounts are converted to lamports with exact decimal arithmetic. Floating point multiplication could land one lamport high (0.00051 SOL became 510001 lamports) and reject an exact payment. A SOL amount with more than nine decimal places is now refused.
- `SolanaReceiptVerifier` binds a verified receipt to its transaction (#738). A real receipt now requires a replay store; the transaction signature is recorded after the payment is verified, so one transaction satisfies one challenge even when the presenter chooses a fresh nonce. USDC verification requires a configured `usdcMint` and never falls back to a receipt-supplied mint, and accepts only `transferChecked` (a plain `transfer` names no mint and reports raw base units). Callers that verified real SOL/USDC receipts without a replay store or without `usdcMint` are now refused with `unsupported_receipt`. The supplied in-memory store still does not survive a restart; a durable store is tracked in #723.
- `SplTransferCheckedObservation.blockTime` is optional: a confirmed transaction whose node reports no block time for the slot is still observable, and only a present-but-invalid `blockTime` is rejected. `slot` remains mandatory.
- An AUDD challenge verified without a configured `auddMint` now fails as `unsupported_receipt` (operator misconfiguration) rather than `invalid_receipt`, and AUDD observer failures surface their specific reason in the failure message.
- `SolanaReceiptVerifier` marks AUDD observations it derives from `getParsedTransaction` output as `evidence.source: 'parsed-rpc-transaction'` instead of leaving the fixture default.
- The SPL observer's replay key includes the normalized network and matched instruction index, so two distinct transfers settled in one transaction each get their own replay slot while a genuine replay of the same transfer is still rejected. `SolanaReceiptVerifier` now applies that signature/instruction replay guard to AUDD receipts before accepting them.
- SPL `TransferChecked` observation now requires the expected payment signature to be the transaction's first/canonical signature, not merely any secondary signer signature.

## 0.1.0 — 2026-07-06

First release-candidate cut of the HTTP 402 payment primitives for Solana-oriented RAP (Reddi Agent Protocol) workflows. This package is a repo-local v0.1 OSS candidate: it is not yet published on npm and must not be treated as production payment, custody, escrow-finality, or mainnet infrastructure.

### Added

Module areas (one subpath export per module, plus the root export — see `exports` in `package.json`):

- **`./types`** — x402 request/challenge/receipt type definitions.
- **`./payment`** — x402 header parsing and validation (`parseX402Header`, `createX402Header`, challenge building, payment-address format validation).
- **`./nonce`** — nonce-based replay protection (`checkAndStoreNonce`).
- **`./middleware`** — Express middleware (`createX402Middleware`) that parses the `x402-request` header, checks nonces, verifies demo or explicitly approved receipts per configured policy, and sets the `x402-payment` response header.
- **`./budget-policy`** — pure local buyer budget preflight (`evaluateBudgetPolicy`): per-request, per-session, per-source, per-specialist, per-asset/network, and call-count limits, evaluated before any signer, hosted facilitator, or downstream call is used.
- **`./client`** — fail-closed devnet USDC helpers. Any real devnet payment path is explicit (gated behind a literal approval phrase), capped, allowlisted, and outside the default OSS smoke.
- **`./jupiter`** — swap-client interface abstraction (mock-friendly; tests do not require Solana devnet access).

The legacy `sendPayment` demo helper remains for local tests only — it is not a production payment path.

### Quickstart

The package is repo-local until the OSS release smoke and package-publication gates are complete:

```bash
npm --prefix packages/x402-solana test -- --runInBand
npm --prefix packages/x402-solana run build

# Full local release gate (from packages/x402-solana)
npm run release:dry-run
```

### Boundaries

**No spend, no custody, no live settlement.** Clean-checkout OSS success must not require wallet material, RPC calls, Pay.sh activation, hosted Reddi infrastructure, paid providers, marketplace publication, trust/reputation mutation, mainnet, custody, or settlement-finality claims. These boundaries match the README and are enforced mechanically by the claim-boundary scan in `npm run check:oss-release-smoke`.
