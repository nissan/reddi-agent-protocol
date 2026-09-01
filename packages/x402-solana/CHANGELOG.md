# Changelog — @reddi/x402-solana

All notable changes to this package are documented here. Dates are AEST.

## Unreleased

### Added

- Read-only SPL `TransferChecked` observation verifier for parsed deterministic transaction fixtures. It checks successful transaction metadata, confirmation metadata, transaction-signature match, exact mint/program/payee owner/destination/amount, optional memo binding, exactly one match, and replay protection without RPC, wallets, signers, secrets, or live submission.
- AUDD bridge in `SolanaReceiptVerifier` that uses the stricter x402 v2 SVM `exact` verifier only when an AUDD mint is explicitly configured (never inferred from the receipt), while retaining legacy SOL/USDC compatibility.

### Changed

- `SplTransferCheckedObservation.blockTime` is optional: a confirmed transaction whose node reports no block time for the slot is still observable, and only a present-but-invalid `blockTime` is rejected. `slot` remains mandatory.
- An AUDD challenge verified without a configured `auddMint` now fails as `unsupported_receipt` (operator misconfiguration) rather than `invalid_receipt`, and AUDD observer failures surface their specific reason in the failure message.
- `SolanaReceiptVerifier` marks AUDD observations it derives from `getParsedTransaction` output as `evidence.source: 'parsed-rpc-transaction'` instead of leaving the fixture default.
- The SPL observer's replay key includes the normalized network and matched instruction index, so two distinct transfers settled in one transaction each get their own replay slot while a genuine replay of the same transfer is still rejected. `SolanaReceiptVerifier` now applies that signature/instruction replay guard to AUDD receipts before accepting them.

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
