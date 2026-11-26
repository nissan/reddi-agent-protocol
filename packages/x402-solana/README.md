# @redditech/x402-solana

x402 payments on Solana for Reddi Agent Protocol: per-token pricing, metered escrow, payment checks and receipts, for both the buyer and the provider side.

> Payments prove transfer; RAP Assurance proves paid work.

This package is currently a repo-local v0.1 OSS candidate. It is not yet published on npm, and it should not be treated as production payment, custody, escrow-finality, settlement-finality, or mainnet infrastructure.

## Overview

**x402** is an HTTP status code indicating that payment is required. This package implements local parsing, policy, middleware, demo receipt, and gated devnet-helper primitives for Solana/x402 workflows. RAP consumers should treat verified payment proof as transfer evidence, then bind it to work evidence through RAP receipts.

### Core Features

- **Nonce-based replay protection** — prevents duplicate payment attempts
- **x402 standard compliance** — parses/validates x402-request headers
- **Local buyer budget preflight** — evaluates spend/call limits before payment authorization
- **Modular design** — nonce store, payment logic, and middleware are separately testable
- **Mock-friendly** — tests don't require Solana devnet access
- **Fail-closed devnet helpers** — any real devnet payment path is explicit, capped, allowlisted, and outside default OSS smoke
- **Read-only SPL observation** — verifies parsed `TransferChecked` transaction fixtures without RPC, wallets, signers, secrets, or live submission

## Installation

The package is repo-local until the OSS release smoke and package-publication gates are complete:

```bash
npm --prefix packages/x402-solana test -- --runInBand
npm --prefix packages/x402-solana run build
```

## Provider side: metered calls

`@redditech/x402-solana/provider` is the seller side of a per-token call. A buyer locks the most it will pay in a metered token escrow; the provider checks the lock on chain, serves the call, and settles the actual cost.

```typescript
import { providerMeteredTerms, meteredOffer, readMeteredPaymentHeader, checkProviderCluster, verifyMeteredLock, usageFrom, meteredSettlement } from '@redditech/x402-solana/provider';

const terms = providerMeteredTerms({ currency: 'USDC', inputPerMillion: '0.15', outputPerMillion: '0.60', programId, mint, payee: wallet });

// No payment yet: tell the buyer the price, the estimate and the maximum to lock (twice the estimate by default).
const offer = meteredOffer(terms, messages, body.max_tokens, 'solana-devnet');

// Payment presented: confirm the cluster once, then check the lock.
await checkProviderCluster(() => connection.getGenesisHash(), 'solana-devnet');
const lock = await verifyMeteredLock({ header, terms, minimum, readAccount, readSlot, replayStore });

// After the model answers: build the settle for the tokens used. You sign and send it.
const { settlement, instructions } = meteredSettlement(terms, lock, usageFrom(upstreamAnswer, inputEstimate));
```

`verifyMeteredLock` also checks that the payout can land (the provider's, the treasury's and the buyer's token accounts), and `confirmMeteredSettlement` reads what a confirmed settle moved, for the receipt. It reads no key and sends no transaction. `packages/provider-kit` wraps it in a runnable server. Token currencies only (USDC, AUDD, PYUSD, USDG).

## Pooled budgets

`@redditech/x402-solana/budget` builds and reads the pooled budget instructions and accounts. `@redditech/x402-solana/budget-provider` is what a provider and an agent need around them. One budget is locked once, in one token, and several providers each reserve a slice of it. A provider takes part only when the budget's token is its own price currency (`budget_currency_not_accepted` otherwise); there is no swap.

```typescript
import { checkPooledBudgetForProvider, checkReserveTransaction, verifyPooledBudgetRequest, spenderSignedReserve, budgetRequestHeaders } from '@redditech/x402-solana/budget-provider';

// Agent: reserve the slice a provider offered in its 402, then sign each call.
const reserve = await spenderSignedReserve({ offer, budget, createdSlot, spender, amount: BigInt(offer.reservation), recentBlockhash, signWithSpender });
const headers = await budgetRequestHeaders({ genesisHash, action: 'call', budget, createdSlot, provider: new PublicKey(offer.payee), sequence: 1, body }, signWithSpender);
// Send the call with `headers` and, on the first call or a raise, `x402-budget-reserve: reserve`.

// Provider: check the budget, then the reserve transaction, before co-signing and sending it.
const fits = checkPooledBudgetForProvider({ budget: decoded, createdSlot, payee, mint, acceptedJudges, slice, currentSlot, minOpenSlotsLeft });
const checked = checkReserveTransaction({ transactionBase64: reserve, programId, budget, createdSlot, spender: decoded.spender, payee, payoutAccount, minAmount, maxAmount });
// Every call: the spender's signature over this call.
const auth = verifyPooledBudgetRequest({ genesisHash, action: 'call', budget, createdSlot, provider: payee, sequence, body, spender: decoded.spender, signatureHeader });
```

The provider pays the fee and the reservation's rent, so `checkReserveTransaction` accepts only a transaction with the provider as fee payer, compute budget instructions and one reserve for this budget and provider, an amount within the offer, and a valid spender signature. It reads no key and sends nothing. `packages/provider-kit` wraps all of it, with metering, receipts and the post and payout sweep.

### Look after a budget from its address alone

`@redditech/x402-solana/budget-recover` and the `x402-solana` command are for the payer: read a budget and its slices from the chain, close it, settle every slice that can be settled, and ask a relay's signer to stop signing for a budget whose agent key leaked. They need the budget's address, an RPC endpoint and the payer's wallet, and no app.

```bash
npx @redditech/x402-solana budget status <budget> --rpc <url>
npx @redditech/x402-solana budget close  <budget> --rpc <url> --keypair payer.json
npx @redditech/x402-solana budget payout <budget> --rpc <url> --keypair any-funded.json
npx @redditech/x402-solana budget freeze <budget> --signer <https origin> --network solana-mainnet-beta --keypair payer.json
```

The keypair file is read locally to sign and is never sent. Without `--keypair`, `close` and `payout` print the unsigned transaction to sign in a wallet. The payer may close at any time, anyone may once the open period has ended, and anyone may send a payout: the program sends money only to the provider's recorded account, the treasury and the payer.

## Ratings and attestations

`@redditech/x402-solana/rating` builds the rating and judge attestation instructions of the V1 program source (`programs/pinocchio-escrow`), derives their addresses and decodes their accounts. The program README and `interface/vectors.json` are the interface; this module is tested against that file byte for byte. No deployed program answers these instructions yet.

```ts
import { buildRatedTokenEscrowLock, buildSellerAcceptRating, readEscrowRatingStatus, readRatingAccount, withRatingAccount, ratingCommitment } from '@redditech/x402-solana/rating';
import { buildSettleTokenEscrowInstruction, decodeTokenEscrowAccount } from '@redditech/x402-solana/token-escrow';

// Buyer: lock and opt in to rating in one transaction (opting in later is refused).
const { instructions, escrow, rating } = buildRatedTokenEscrowLock(terms, { judge });

// Seller: before serving, read at `confirmed` whether the job is rated.
const status = await readEscrowRatingStatus(connection, escrow, programId);

// Read the escrow's lock slot when serving it, and keep it with the job. A rated job's
// rating opens in that slot, so its opened slot is the same number.
const { createdSlot } = decodeTokenEscrowAccount((await connection.getAccountInfo(escrow, 'confirmed'))!.data);

// Every exit names its escrow by the lock slot; an exit of a rated escrow also carries the rating account.
const settle = withRatingAccount(buildSettleTokenEscrowInstruction(terms, false, payee, { actual }), status.ok && status.rated, createdSlot);

// Seller of a fixed-price job the payer will release: read the job and agree to it. Throws
// SellerAcceptRatingError when the escrow or the rating is not what the seller expects.
const accept = await buildSellerAcceptRating(connection, { programId, escrow, seller, expected: { judge, amount } });

// Each party commits, then reveals the same score and salt. Keep both until the reveal.
// `openedSlot` comes from the rating account (`readRatingAccount(...).openedSlot`).
const commitment = ratingCommitment(rating, openedSlot, signer, score, salt);
```

Jobs can share an address: once an escrow has ended, the same payer can lock another job for the same payee under the same nonce. The escrow's lock slot tells them apart, so every exit, rated or not, names it: `withRatingAccount(exit, rated, createdSlot)`, the SOL exit builders and `buildTokenEscrowExitInstruction` append it (u64 little-endian) after the exit's data and throw without it, and the program refuses an exit naming another slot (`EscrowInstanceMismatch`, 6053) or landing in the lock slot (`EscrowJustLocked`, 6052). `buildSettleTokenEscrowInstruction` alone builds a bare exit the program refuses. A rating opens in its escrow's lock slot, so its `openedSlot` is the same number: `ratingCommitment`, `buildAcceptRatingInstruction`, `buildCommitRatingInstruction`, `buildAttestQualityInstruction`, `buildConfirmAttestationInstruction` and `buildDisputeAttestationInstruction` take it as a required bigint, and the program refuses a missing or other one (`RatingJobMismatch`, 6051). A decision on an attestation names the slot the attestation stores (`decodeAttestationAccount(...).openedSlot`; the account is 127 bytes). Read the slot when the job is agreed or verified and keep it: an exit built from a slot re-read later would name whichever job holds the address by then. No exit of a rated escrow is accepted in the slot its rating was opened in (`RatingJustOpened`, 6050): lock and opt in go in one transaction, any exit in a later one.

Consent: the seller agrees to be rated by `accept_rating`, or by being the authority of a claim or settle, and must then commit and reveal within the program's windows. Seller claim transactions must not carry the payer's signature: if the payer signs one, even only as fee payer, the program treats the payer as the authority, so it is a release by the payer and not the seller's agreement. Both seller paths here decline a rated escrow before serving unless `acceptRatedEscrows` is set: `verifyMeteredLock` (metered) and `verifyEscrowLock` / `EscrowSeller` (fixed price). When set, they read the rating account with the lock (a verified lock's `openedSlot`, a receipt's `openedSlot` as a decimal string), and their exits carry the rating account and that slot (`meteredSettlement`, `meteredDecline`, `buildEscrowSellerExit`).

Buyers of a fixed-price rated job: a release by the payer opens the rating only after the seller has called `accept_rating`. Before that, a release pays the seller as usual and closes the job unrated; the payee co-signing the release changes nothing. A rated exit that pays the seller nothing also closes the rating unrated. `RATING_PROGRAM_ERRORS` / `ratingProgramErrorName(code)` name the program's rating, attestation and escrow-instance errors (6010 to 6019, 6033 to 6053). Read the rating account (`readRatingAccount`) and release when `payerReleaseOpensRating(rating)` is true, or leave the seller to claim.

## Usage

### Express Middleware

```typescript
import express from 'express';
import { createX402Middleware } from '@redditech/x402-solana';

const app = express();

// Add x402 middleware
app.use(createX402Middleware());

app.get('/api/data', (req, res) => {
  res.json({ data: 'sensitive information' });
});

app.listen(3000);
```

### Creating x402 Requests

```typescript
import { createX402Header } from '@redditech/x402-solana';

// Create header for payment request
const header = createX402Header(
  1000,  // lamports
  'BaDZtpgWpDx6H1y8Dga2cfyxs3RXj5y2fkBo7HoT2pdv', // payment address
  'uuid-v4-nonce-here' // unique nonce
);

// Send request with header
const response = await fetch('/api/data', {
  headers: { 'x402-request': header }
});
```

## API

### `createX402Middleware()`

Returns an Express middleware that:
1. Checks for `x402-request` header
2. Parses and validates payment details
3. Checks nonce for replay attacks
4. Verifies demo or explicitly approved payment receipts according to configured policy
5. Sets `x402-payment` response header with receipt metadata when verification succeeds

**Errors:**
- `400` — Invalid request (bad JSON, missing fields)
- `409` — Duplicate nonce (replay attempt)
- `503` — RPC timeout

### `parseX402Header(header: string): X402Request`

Parses and validates an x402-request header.

```typescript
const request = parseX402Header('{"amount":1000,"currency":"SOL",...}');
// { amount: 1000, currency: 'SOL', paymentAddress: '...', nonce: '...' }
```

### `checkAndStoreNonce(nonce: string): boolean`

Checks if nonce is new (true) or duplicate (false), and stores it.

```typescript
if (checkAndStoreNonce(nonce)) {
  // First time seeing this nonce
} else {
  // Duplicate detected
}
```

### `verifySplTransferCheckedObservation({ parsedTransaction, expected, commitment })`

Read-only verifier for SVM SPL Token / Token-2022 `TransferChecked` observations. It consumes an already parsed transaction object and checks transaction success, confirmation metadata, transaction-signature match, exact mint, exact token program, destination token-account ownership by `payTo`, exact base-unit amount, optional authority, optional decimals, exactly one matching transfer, replay store, and required memo binding. It does not fetch RPC, submit transactions, load wallets, sign, or hold funds.

`SolanaReceiptVerifier` also requires, by default, proof that the request presenting a direct receipt comes from the wallet that paid, because a confirmed transfer is public and anyone could otherwise present it first. A provider passes the check for each request; the buyer adds the headers after its transfer confirms:

```ts
// Provider: `rawBody` is the request body exactly as received.
const result = await verifier.verifyReceipt(receipt, challenge, replayStore, directPaymentProofCheck({ headers, body: rawBody }));

// Buyer: sign with the paying wallet, or with a session key it delegated once
// (directPaymentDelegationHeaderValue) and pass that as `delegation`.
const proof = await directPaymentProofHeaders({ network, txSignature, payTo, body, sign: (m) => wallet.signMessage(m) });
```

A verifier that serves nothing, such as a job ledger recording calls after they are served, sets `payerProof: 'not-required'`.

Session and single metered-call signatures (`session-auth`) name the network by its genesis hash, in the delegation (`genesisHash`, sent as `network`) and in each request's signature (`reddi-session/2`), so a signature made for devnet is refused on mainnet and the other way round; providers pass the genesis hash of the cluster they checked they are on (`SOLANA_GENESIS_HASHES[network]`). A session call that asks to close the session is signed as `call-close` (`sessionCallAction(close)`). Signatures in the earlier `reddi-session/1` form, without a network, are refused.

Delegations (session and direct payment) may run for up to seven days, but a buyer client should use `delegationExpiresAt()`, a day, and keep the session key in memory only, never in localStorage or on disk: whoever holds the key can sign for the payer until the delegation expires.

Hardware wallets such as Ledger sign Solana off-chain messages with a header prefix, which these checks do not accept yet. A payer that uses one cannot sign the delegation or the request; pay from a software wallet for now.

`SolanaReceiptVerifier` requires a replay store for real receipts and records the transaction signature, so one transaction satisfies one challenge; USDC needs a configured `usdcMint` and a `transferChecked` instruction. A token payment counts for what stays with the payee: the payee's (and the treasury's) token account must gain at least its share between the balances before and after the transaction, belong to them before and after, and not be debited or have its authority changed by any instruction of the same transaction, inner instructions included. A Token-2022 mint that charges a transfer fee delivers less than the amount sent, so its payments fail this check; the accepted mints are expected to keep the fee at zero. The receipt nonce is 1 to 128 characters of letters, digits and `. _ : ~ -`, and is recorded under `x402:nonce:<network>:<payTo>:`, so it cannot collide with another payment's transaction or escrow key. It bridges AUDD receipts to this stricter x402 v2 SVM `exact` verifier only when the verifier is configured with an explicit `auddMint`; it will not trust a receipt-supplied mint as the AUDD identity. AUDD amounts are base units, not UI decimal strings.

For a `solana-mainnet-beta` challenge the verifier also refuses a transaction older than 900 seconds (`maxTransactionAgeSeconds`) or without a block time, and requires the connection to report the public mainnet genesis hash. On other networks those two checks run only when `maxTransactionAgeSeconds` or `expectedGenesisHash` is set.

`MemoryNonceReplayStore` forgets everything on restart. `DatabaseReplayStore` keeps replay keys in a database through an atomic function you provide:

```ts
// server side only; `client` is a database client with a service credential
const replayStore = new DatabaseReplayStore({ rpc: (fn, args) => client.rpc(fn, args) });
```

It throws when the database is unreachable, so a payment is never accepted without being recorded. A real payment is recorded under two keys at once through `replay_check_and_store_all` (`p_keys`, a text array; all or none), so the database needs both functions from `supabase/migrations/`. A custom store can do the same by implementing `checkAndStoreAll`.

### `sendPayment(request: X402Request): Promise<PaymentReceipt>`

Legacy demo helper for local tests. Do not use it as a production payment path.

```typescript
const receipt = await sendPayment(request);
// { txSignature: '...', slot: 12345, lamports: 1000, nonce: '...' }
```

### `evaluateBudgetPolicy({ policy, quote, usage }): BudgetPolicyDecision`

Runs a pure local buyer preflight check before any signer, hosted facilitator, or downstream x402/OpenRouter call is used. Amounts are represented in the payment asset's smallest unit.

```typescript
import { assetNetworkKey, evaluateBudgetPolicy } from '@redditech/x402-solana';

const decision = evaluateBudgetPolicy({
  policy: {
    schemaVersion: 'reddi.budget-policy.v1',
    limits: {
      perRequest: { maxAmount: '100000' },
      perSession: { maxAmount: '500000' },
      perSource: { 'source:planning': { maxAmount: '250000' } },
      perSpecialist: { 'specialist:coder': { maxAmount: '300000' } },
      perAssetNetwork: [
        { asset: 'USDC', network: 'solana-devnet', maxAmount: '400000' },
      ],
      callCount: { maxCalls: 5 },
    },
  },
  quote: {
    amount: '50000',
    asset: 'USDC',
    network: 'solana-devnet',
    source: 'source:planning',
    specialist: 'specialist:coder',
  },
  usage: {
    sessionSpent: '100000',
    sourceSpent: { 'source:planning': '25000' },
    specialistSpent: { 'specialist:coder': '50000' },
    assetNetworkSpent: { [assetNetworkKey('USDC', 'solana-devnet')]: '100000' },
    callCount: 2,
  },
});

if (!decision.allowed) {
  throw new Error(`budget_preflight_denied:${decision.reasonCodes.join(',')}`);
}
```

Buyer-client integration for #342: parse the x402 quote/challenge, call `evaluateBudgetPolicy` with the operator's local policy and current local usage ledger, persist the returned audit notes with the receipt attempt, and only then continue to payment preparation. Hosted/live delegation paths should stay fail-closed until they combine this local decision with explicit operator approval.

## Testing

```bash
npm test
```

Runs Jest test suite covering:
- Header parsing and validation
- Nonce replay protection
- Amount validation
- Payment address format validation
- Error handling

## Architecture

```
x402-request (client)
    ↓
middleware.ts (intercept)
    ↓
payment.ts (parse + validate)
    ↓
nonce.ts (replay check)
    ↓
payment verifier or explicitly approved devnet helper
    ↓
x402-payment (response receipt)
```

## Phases

- **Phase 0**: Historical devnet/escrow research exists, but is not a current release claim
- **Phase 1**: x402 primitives (header parsing, nonce, validation, demo receipts, local budget preflight)
- **Phase 2**: Gated devnet USDC helpers behind explicit approval records and spend caps
- **Phase 2a**: Non-live AUDD/SPL `TransferChecked` observation from deterministic parsed fixtures; no RPC or signer path is added
- **Phase 3**: Framework adapters only after #519 decides retention/deprecation scope
- **Phase 4**: Future private/Quasar settlement work only behind separate program-boundary approval

## Boundaries

Clean-checkout OSS success must not require wallet material, RPC calls, Pay.sh activation, hosted Reddi, paid providers, marketplace publication, trust/reputation mutation, mainnet, custody, or settlement-finality claims.

## License

MIT

## Classic SPL escrow challenge flow

The repo-local `token-escrow` and `escrow-http` modules, re-exported from the package root, add a RAP-specific HTTP 402 → finalized SPL lock → paid retry → seller verification → locked receipt flow. See [the runnable synthetic puzzle seller/buyer](examples/README.md). Mint address, classic token program and decimals are explicit configuration; the disposable validator harness uses a labelled local test mint, not AUDD. The locked receipt is distinct from settlement and from service correctness. These additions do not establish public npm publication or authorize devnet signing.
