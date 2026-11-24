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
- No collected on-chain protocol treasury fee on mainnet. The planned fee is 5% (500 bps) of the actual cost of a metered call, with a 2.5% (250 bps) launch rate for payouts before 2027-04-01 00:00 UTC (the rate in force at payout), capped at 0.1 SOL on SOL payments only; it replaces the earlier 0.05% / 5 bps plan and runs only on devnet until a mainnet release.

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

`archive/anchor-escrow/` is historical/reference evidence. It is not deployed as a current target and is not an escrow product, custody offering, or settlement-finality claim. The source holds lamports/SOL in the original escrow and, on a separate classic SPL Token rail, raw token units in a per-escrow vault; the two rails share no account layout, and only the SOL rail exists on any recorded deployment.

- SOL PDA seeds: `[b"escrow", payer, nonce]`; the payer-scoped nonce prevents duplicate active escrows.
- `EscrowStatus` has exactly three states: `Locked` (funds locked awaiting resolution), `Released` (paid to the payee), `Cancelled` (returned to the payer).
- SOL instructions: `lock_escrow`, `lock_metered_escrow`, `release_escrow`, `settle_escrow`, `cancel_escrow`.
- Instruction count. The V1 program (`programs/pinocchio-escrow`) has one build, and its default build answers 42 instructions: five SOL escrow, five token escrow, three registry (`register_agent`, `update_agent`, `deregister_agent`), six rating (`open_rating`, `accept_rating`, `commit_rating`, `reveal_rating`, `expire_rating`, `close_rating`) four attestation (`attest_quality`, `confirm_attestation`, `dispute_attestation`, `close_attestation`) and six delivery check (`open_delivery`, `record_delivery`, `accept_delivery`, `dispute_delivery`, `resolve_delivery`, `resolve_token_delivery`) and thirteen pooled budget (`open_budget`, `open_token_budget`, `reserve`, `set_payout_account`, `post_final`, `waive`, `dispute`, `close_budget`, `close_token_budget`, `payout_budget`, `payout_token_budget`, `resolve_budget`, `resolve_token_budget`). `equivalence/tests/instruction_surface.rs` holds that list. The archived Anchor program's default build answers the first 13 only (`archive/anchor-escrow/tests/instruction_surface.rs`); its rating and attestation instructions of the same names are a different, older interface. The MagicBlock PER pair `delegate_escrow` / `release_escrow_per` is not part of V1: the V1 build answers neither (follow-up after launch, #839).
- Rated escrows (V1 program only). A buyer can opt an escrow in to rating with `open_rating` in the slot of the lock. The escrow then carries a rated bit, and every exit of it (release, claim, settle, refund, decline) takes its rating account, writable, right after the usual accounts; without it the exit is refused (`RatingAccountRequired`, 6033). The money moves exactly as for an escrow that is not rated, except that no exit may land in the slot the rating was opened in (`RatingJustOpened`, 6050). A paid exit opens the rating only when the seller agreed (it called `accept_rating`, or it is the authority of the claim or settle); otherwise, and on a refund or decline, the rating account is closed and its rent returns to the payer. The rating account costs the buyer about 0.00202 SOL of refundable rent. [`RATINGS-AND-ATTESTATIONS.md`](RATINGS-AND-ATTESTATIONS.md) has the rest.
- Settlement rules, both rails, counted in slots from the lock:
  - The payer can release to the payee at any time.
  - The payee can decline at any time, which refunds the payer.
  - Each lock names two windows, in slots (a nominal 400 ms each), and they are recorded on the escrow: `claim_window_slots` and `cancel_window_slots`. Seconds are allowed. A lock is refused (`InvalidWindows`) unless the claim window is at least one slot, no later than the cancel window, and the cancel window is at most `MAX_ESCROW_WINDOW_SLOTS` (6,480,000 slots, about 30 days). Clients that name none use about 10 minutes to claim and about 30 minutes to refund (`DEFAULT_CLAIM_WINDOW_SLOTS`, `DEFAULT_CANCEL_WINDOW_SLOTS`).
  - From the escrow's claim window the payee can claim the whole amount if the payer has not released and nothing has been refunded.
  - From the escrow's cancel window the payer can refund itself if the escrow is still open. From then on whichever of payer refund and payee claim lands first wins.
  - A metered escrow can also be settled by the payee at any time, at the actual cost; the payer cannot settle.
  - Nobody else can settle an escrow. There is no arbiter. Wall-clock times drift with real slot times.
  - Consequence: the claim opens no later than the refund, so an inactive payer pays the payee once the claim window opens, delivered or not, and the payer gets a refund only if the payee neither claims nor settles before the cancel window. The program does not judge delivery; a lock is the buyer's commitment up to the locked amount, not a payment. On a fixed-price escrow the buyer has no refund route before the seller can claim, so a buyer who wants time to judge the work names a claim window long enough for that. A seller serving against a lock must check, before doing the work, how much of the cancel window is left at that moment (`created_slot + cancel_window_slots - current slot`), not the window named at lock: once it has elapsed the payer can refund, so the seller's settle or claim has to land before then. The in-repo sellers require 1,500 slots (about 10 minutes) left and serve nothing when the escrow or the slot cannot be read.
- Per-escrow caps in source: 0.5 SOL (`MAX_SOL_ESCROW_LAMPORTS`) and 100 token units of a 6-decimal mint (`MAX_TOKEN_ESCROW_BASE_UNITS`). The cap bounds the amount named at lock, not later unsolicited deposits.
- `EscrowLocked` and `EscrowSettled` events record each lock and its outcome (`Released`, `DeclinedByPayee`, `RefundedAfterWindow`, `ClaimedByPayee`).
- On the SOL rail, settlement closes the record; `Released` and `Cancelled` are not retained as durable on-chain history.
- Token rail: `TokenEscrowAccount` at `[b"token-escrow", payer, nonce]` with a program-owned vault at `[b"token-vault", escrow]`; instructions `lock_token_escrow`, `release_token_escrow`, `cancel_token_escrow`. Two token programs are accepted, each only for the mints the source allowlists for it, all with 6 decimals: classic SPL Token for the mainnet USDC and AUDD mint addresses (plus the devnet USDC address when built with the `devnet` feature), and Token-2022 for the mainnet PYUSD and USDG mint addresses. The native SOL mint, any other mint, and an allowlisted mint presented with the other token program are refused. These entries are source only: no deployed program accepts AUDD, PYUSD or USDG. Issuer controls the program cannot remove: AUDD, PYUSD and USDG issuers can freeze a vault, and the PYUSD and USDG issuer can also move a vault's tokens (permanent delegate), switch on a transfer fee, or activate a transfer hook. For the Token-2022 mints a lock is refused while a transfer fee is charged, and settlement pays out whatever the vault then holds and still closes the escrow record if the issuer has taken tokens or switched on a fee; a frozen vault or an activated transfer hook stops settlement until the issuer reverses it (`archive/anchor-escrow/tests/test_token2022_escrow.rs`, run against a byte copy of the mainnet PYUSD mint account with test authorities). The payer's release pays only the recipient token account recorded at lock; the payee's own claim or settle may name any token account of the mint that the payee owns. A token lock is refused when the source or recipient account is frozen, and a SOL lock when the payout would leave the payee below its rent-exempt minimum (`PayeeNotRentExempt`; a metered lock needs a payee that already holds it). A payee's decline refunds the source token account recorded at lock; the payer's own refund may go to any token account of the same mint that it owns, and both close the record and vault to the payer; coverage is LiteSVM (`archive/anchor-escrow/tests/test_token_escrow.rs`) using a disposable local mint installed at the allowlisted address, never real USDC or AUDD. The loopback local-validator exercise (`archive/anchor-escrow/tests/local_token_escrow.cjs`) and the opt-in Surfpool `1.7.0` lane (`docs/SURFPOOL-1.7-SPL-ESCROW-LANE.md`) are written for the current allowlist, account lists and windows (#746); both are local-runtime evidence only and neither is a required check.

## Token escrow limitations

These are limitations of the local/source-only classic SPL Token reference rail, to be assessed before any separately approved non-local use; they do not authorize deployment or live funds.

- **Issuer freeze control:** mints with a freeze authority are accepted. That authority can freeze the vault, causing both release and refund to fail until it is thawed. The cancel window does not bypass a freeze, and RAP cannot guarantee recovery against issuer control. Assess the actual mint's authorities rather than assuming a currency label is safe.
- **Account binding:** the payer's release uses the recipient token account recorded at lock; another account with the same owner and mint cannot substitute. The payee itself, claiming or settling, may name another token account of the mint that it owns, so a closed or frozen recipient account does not block it. A payee's decline goes only to the recorded source account. The payer's own refund, after the cancel window, may name another classic token account of the escrow mint that it owns, so a closed source account does not strand it.
- **Default goes to the payee:** the program does not know whether work was delivered. A payer who does nothing loses the funds to the payee's claim after the claim window. A payer who refunds in time gets the funds back even if work was delivered. No automatic or third-party arbitration path exists on this rail.
- **Closure is terminal:** successful release or refund closes both the vault and token escrow record to the payer. `Released` and `Cancelled` are never persisted for token escrows; record closure is the terminal account signal. Retain transaction evidence to distinguish release from refund; absence alone does not prove which occurred.
- **Nonce reuse:** after closure, the same `(payer, nonce)` can create another escrow at the same PDA, as on the SOL rail. This is uniqueness among active escrows, not permanent replay protection or a globally unique job ID. Clients must retain separate job identifiers and settlement history, including transaction references, across account lifetimes.

## Reference Solana surfaces

The repository still contains Solana reference code and demos. The legacy Anchor program is historical/reference evidence. The recorded Quasar devnet deployment is blocked by `config/quasar/deployments.json` and refused outside the local Surfpool lane before instruction building, signer access, or RPC. Future custody or settlement work must land behind separate approval, audit, deployment, and public-claim gates.
