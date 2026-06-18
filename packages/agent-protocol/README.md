# @reddi/agent-protocol

Open protocol primitives for paid agent work.

This package is the local-first Reddi Agent Protocol surface above payment rails such as `@reddi/x402-solana`. It defines receipt envelopes, policy decisions, deterministic fixtures, and validation helpers that run without hosted Reddi infrastructure, wallet keys, devnet/mainnet spend, or paid provider calls.

## Install

```bash
npm install @reddi/agent-protocol
```

## Receipt Validation

```typescript
import { createReddiReceipt, reddiReceiptFixtures } from '@reddi/agent-protocol';

const receipt = createReddiReceipt(reddiReceiptFixtures.happyPath);
console.log(receipt.schemaVersion); // reddi.receipt.v1
```

Receipt validation fails closed for malformed envelopes, missing payment proof references, unsupported v1 network/asset pairs, and credential-bearing metadata.

## Policy Decisions

```typescript
import { policyDecisionFromBudgetPolicyDecision } from '@reddi/agent-protocol';

const policyDecision = policyDecisionFromBudgetPolicyDecision({
  allowed: false,
  reasonCodes: ['request_amount_exceeds_limit'],
  quotedAmount: { amount: '150000', asset: 'USDC', network: 'solana-devnet' },
  remainingBudget: { perRequest: '0' },
  auditNotes: ['Denied: request quote exceeds per-request limit.'],
});
```

Use payment-rail packages to settle and verify payment-specific proofs. RAP receipts record the policy, payment-proof reference, evidence reference, and trust metadata around the paid agent workflow.

## Local Validation

```bash
npm run build
npm test
```

No secrets or network calls are required.
