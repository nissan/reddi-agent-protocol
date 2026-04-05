# @reddi/x402-solana

HTTP 402 Payment Middleware for Solana. Enables trustless micropayment flows between agents using the x402 standard and Solana's on-chain escrow.

## Overview

**x402** is an HTTP status code indicating that payment is required. This package implements the middleware to handle x402 payment flows on Solana, supporting agent-to-agent micropayments without central intermediaries.

### Core Features

- **Nonce-based replay protection** — prevents duplicate payment attempts
- **x402 standard compliance** — parses/validates x402-request headers
- **Modular design** — nonce store, payment logic, and middleware are separately testable
- **Mock-friendly** — tests don't require Solana devnet access

## Installation

```bash
npm install @reddi/x402-solana @solana/web3.js
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
4. Initiates payment transfer
5. Sets `x402-payment` response header with receipt

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

### `sendPayment(request: X402Request): Promise<PaymentReceipt>`

Sends the payment and returns a receipt.

```typescript
const receipt = await sendPayment(request);
// { txSignature: '...', slot: 12345, lamports: 1000, nonce: '...' }
```

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
sendPayment (transfer SOL)
    ↓
x402-payment (response receipt)
```

## Phases

- **Phase 0** (✅ done): Anchor 1.0.0 escrow program on devnet
- **Phase 1** (this): x402 middleware library (header parsing, nonce, validation)
- **Phase 2**: Full payment flow (actual Solana transfer via Phase 0 escrow)
- **Phase 3**: ElizaOS plugin + SendAI integration
- **Phase 4**: MagicBlock Private Ephemeral Rollup for private settlement

## License

MIT
