# @reddi/x402-solana

HTTP 402 proof-reference primitives for Solana-oriented RAP Assurance workflows.

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

## Usage

### Express Middleware

```typescript
import express from 'express';
import { createX402Middleware } from '@reddi/x402-solana';

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
import { createX402Header } from '@reddi/x402-solana';

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

`SolanaReceiptVerifier` retains legacy SOL/USDC behavior and bridges AUDD receipts to this stricter x402 v2 SVM `exact` verifier only when the verifier is configured with an explicit `auddMint`; it will not trust a receipt-supplied mint as the AUDD identity. AUDD amounts are base units, not UI decimal strings.

### `sendPayment(request: X402Request): Promise<PaymentReceipt>`

Legacy demo helper for local tests. Do not use it as a production payment path.

```typescript
const receipt = await sendPayment(request);
// { txSignature: '...', slot: 12345, lamports: 1000, nonce: '...' }
```

### `evaluateBudgetPolicy({ policy, quote, usage }): BudgetPolicyDecision`

Runs a pure local buyer preflight check before any signer, hosted facilitator, or downstream x402/OpenRouter call is used. Amounts are represented in the payment asset's smallest unit.

```typescript
import { assetNetworkKey, evaluateBudgetPolicy } from '@reddi/x402-solana';

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
