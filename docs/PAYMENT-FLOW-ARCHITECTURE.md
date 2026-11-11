# Payment and RAP Assurance Architecture

Status: current public-claim boundary. This document replaces older “we handle settlement + escrow” framing with the narrower RAP Assurance message.

> Payments prove transfer; RAP Assurance proves paid work.

## Current framing

Reddi Agent Protocol should not be presented as a payment facilitator, custody provider, escrow provider, broad marketplace, or generic runtime. Payment rails and adapters can prove payment intent or transfer. RAP Assurance records the paid-work context around those rails: terms, buyer policy, payment-proof references, evidence references, attestation outcomes, replay metadata, and bounded reputation inputs.

## Integration-first flow

```text
Agent A (buyer/consumer)
    |
    | 1) Discover specialist metadata from local fixtures, MCP/AI catalog,
    |    registry/search adapters, or a future hosted catalog.
    v
Quote / 402 challenge / payment plan
    |
    | 2) Evaluate buyer budget, authority, rail support, evidence requirements,
    |    allowlists, expiry, and operator-approval gates.
    v
Payment rail or fixture
    |
    | 3) Rail-specific verifier proves payment intent/transfer, or the route
    |    stays dry-run/no-spend. RAP stores only the proof reference.
    v
Specialist work + evidence
    |
    | 4) Request/response hashes, evidence refs, disclosure ledgers, and replay
    |    labels bind the work to the agreed terms.
    v
RAP Assurance receipt
    |
    | 5) Attestation/replay/conformance decide which reputation or dispute inputs
    |    are justified. Payment alone is never work-quality proof.
```

## Current supported claims

- Local/offline receipt, policy, evidence-binding, replay, and conformance helpers.
- x402 challenge parsing, budget preflight, nonce/replay checks, and explicit proof-reference handling.
- Read-only SVM SPL `TransferChecked` observation for parsed transaction evidence; no wallet, signer, RPC fetch, or live submission is added by that verifier.
- AUDD as payment-plan/proof metadata unless a separate audited live rail is approved.
- Recorded or local/devnet evidence only where a page, script, or artifact explicitly labels the boundary.

## Explicit non-claims

- No production settlement-finality claim.
- No mainnet readiness claim.
- No custody or escrow-provider claim.
- No default live payment, wallet, RPC, or paid-provider call.
- No hosted marketplace/facilitator readiness claim.
- No collected on-chain protocol treasury fee; 0.05% / 5 bps remains fixture/planned economics only.

## x402 challenge/response semantics (implemented in `packages/x402-solana`)

These are protocol mechanics the repository actually implements, not a settlement claim.

- Request header: `x402-request`, a JSON payload parsed by `parseX402Header`.
- Required fields: `amount` (positive), `currency`, `paymentAddress`/`payTo` (strict base58 32-byte Solana public key), `nonce`.
- Optional fields: `network`, `endpoint`, `memo`, `payerCurrency`, `payerAddress`, `autoSwap`.
- `buildX402Challenge` rejects unsupported networks, non-positive amounts, and missing nonce/currency/endpoint.
- Replay protection: `checkAndStoreNonce` rejects a repeated nonce with HTTP 409 before any payment path runs.
- Response header: `x402-payment`, carrying the receipt the caller can retain as a payment-proof reference.

The invariants are challenge binding, anti-replay nonce, amount/asset binding, and payer authorization proof. Parsing and gating these is not itself proof that funds moved, that work was performed, or that any live rail is enabled.

A separate RAP-specific `rap-spl-escrow-v1` challenge flow (HTTP 402 → finalized classic SPL escrow lock → paid retry → `locked` receipt) also lives in the same package; it is not the interoperable x402 SVM `exact` scheme and uses its own header payloads. `packages/x402-solana/README.md` owns its description and boundaries.

## Escrow PDA lifecycle (legacy Anchor reference program only)

`programs/escrow/` is historical/reference evidence. It is not deployed as a current target and is not an escrow product, custody offering, or settlement-finality claim. The source holds lamports/SOL in the original escrow and, on a separate classic SPL Token rail, raw token units in a per-escrow vault; the two rails share no account layout, and only the SOL rail exists on any recorded deployment.

- SOL PDA seeds: `[b"escrow", payer, nonce]`; the payer-scoped nonce prevents duplicate active escrows.
- `EscrowStatus` has exactly three states: `Locked` (funds locked awaiting resolution), `Released` (paid to the payee), `Cancelled` (returned to the payer).
- SOL instructions: `lock_escrow`, `release_escrow`, `cancel_escrow`, plus the MagicBlock PER state-tracking pair `delegate_escrow` / `release_escrow_per`.
- On the SOL rail, settlement closes the record; `Released` and `Cancelled` are not retained as durable on-chain history.
- Classic SPL Token rail: `TokenEscrowAccount` at `[b"token-escrow", payer, nonce]` with a program-owned vault at `[b"token-vault", escrow]`; instructions `lock_token_escrow`, `release_token_escrow`, `cancel_token_escrow`. Only the classic SPL Token program is accepted (the native SOL mint, Token-2022, and transfer hooks are refused). Release pays only the exact recipient token account recorded at lock, cancel refunds only the exact original source account after the same cancel window as SOL, and both close the record and vault to the payer. Amounts are raw token units with no assumed currency or decimals; coverage is LiteSVM (`programs/escrow/tests/test_token_escrow.rs`) plus a loopback local-validator exercise (`programs/escrow/tests/local_token_escrow.cjs`) against a labelled local test mint, never an AUDD or USDC identity; an opt-in Surfpool `1.7.0` lane reruns that exercise beside an embedded-runtime parity proof (`docs/SURFPOOL-1.7-SPL-ESCROW-LANE.md`).

## Token escrow limitations

These are limitations of the local/source-only classic SPL Token reference rail, to be assessed before any separately approved non-local use; they do not authorize deployment or live funds.

- **Issuer freeze control:** mints with a freeze authority are accepted. That authority can freeze the vault, causing both release and refund to fail until it is thawed. The cancel window does not bypass a freeze, and RAP cannot guarantee recovery against issuer control. Assess the actual mint's authorities rather than assuming a currency label is safe.
- **Exact account binding:** release uses the recipient token account recorded at lock; refund uses the original source token account. Another account with the same owner and mint cannot substitute. A closed recipient account blocks release while it remains unavailable; the payer must wait for the refund window to refund to the original source, which must also remain valid and transferable.
- **Payer-only settlement:** only the payer can sign release or refund. The payee cannot force release, and no automatic release or third-party arbitration path exists on this rail.
- **Closure is terminal:** successful release or refund closes both the vault and token escrow record to the payer. `Released` and `Cancelled` are never persisted for token escrows; record closure is the terminal account signal. Retain transaction evidence to distinguish release from refund; absence alone does not prove which occurred.
- **Nonce reuse:** after closure, the same `(payer, nonce)` can create another escrow at the same PDA, as on the SOL rail. This is uniqueness among active escrows, not permanent replay protection or a globally unique job ID. Clients must retain separate job identifiers and settlement history, including transaction references, across account lifetimes.

## Reference Solana surfaces

The repository still contains Solana reference code and demos. The legacy Anchor program is historical/reference evidence. The recorded Quasar devnet deployment is blocked by `config/quasar/deployments.json` and refused outside the local Surfpool lane before instruction building, signer access, or RPC. Future custody or settlement work must land behind separate approval, audit, deployment, and public-claim gates.
