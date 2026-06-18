# @reddi/agent-protocol

Open protocol primitives for paid agent work.

This package is the local-first Reddi Agent Protocol surface above payment rails such as `@reddi/x402-solana`. It defines receipt envelopes, policy decisions, deterministic fixtures, and validation helpers that run without hosted Reddi infrastructure, wallet keys, devnet/mainnet spend, or paid provider calls.

## Install

```bash
npm install @reddi/agent-protocol
```

## Receipt Validation

```typescript
import { createReddiReceipt, reddiReceiptFixtureCases, reddiReceiptFixtures } from '@reddi/agent-protocol';

const receipt = createReddiReceipt(reddiReceiptFixtures.happyPath);
console.log(receipt.schemaVersion); // reddi.receipt.v1
console.log(Object.keys(reddiReceiptFixtureCases)); // happy/denial/failure fixture cases
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

## AI Catalog Ingestion

```typescript
import { createAiCatalogSnapshot, aiCatalogFixtures } from '@reddi/agent-protocol/ai-catalog';

const snapshot = createAiCatalogSnapshot(aiCatalogFixtures.happyPath, {
  rawSnapshotRef: 'sha256:catalog-response',
});

console.log(snapshot.publisher.id); // reddi.tech
console.log(snapshot.resources[0].mediaType); // application/mcp-server-card+json
```

AI Catalog ingestion stores discovery results as untrusted external metadata. Validation fails closed for malformed catalogs, unsupported resource types, invalid `urn:ai:*` identifiers, unsafe URLs, credential-bearing metadata, oversized catalogs, and nested-catalog boundary violations.

Catalog ingestion never performs network fetches, paid invocations, wallet actions, or auto-execution. Buyer policy preflight, quote/payment approval, receipts, evidence, attestations, and reputation remain separate RAP steps after discovery.

## Provider Trust Records

```typescript
import { createAiCatalogProviderTrustRecord, providerTrustFixtures } from '@reddi/agent-protocol/provider-trust';

const trust = createAiCatalogProviderTrustRecord(
  providerTrustFixtures.verifiedCatalog,
  'urn:ai:reddi.tech:specialists:code-review',
  { verification: { status: 'verified', verifier: 'rap:local-check' } },
);

console.log(trust.verification.status); // verified
```

Provider trust records normalize ARD trust manifests, provenance links, attestations, detached-signature metadata, publisher identity, and verification references into a RAP-side trust shape.

External ARD trust metadata is treated as a claim until RAP-side verification marks it `verified` or `failed_verification`. Missing metadata remains `unverified`, malformed trust metadata fails closed, and credential-bearing auth/payment/trust metadata is rejected.

## Discovery Source Candidates

```typescript
import {
  createAiCatalogDiscoveryCandidates,
  evaluateDiscoveryCandidatePolicyPreflight,
} from '@reddi/agent-protocol/discovery-source';
import { providerTrustFixtures } from '@reddi/agent-protocol/provider-trust';

const candidates = createAiCatalogDiscoveryCandidates(providerTrustFixtures.verifiedCatalog, {
  relevanceScores: {
    'urn:ai:reddi.tech:specialists:code-review': 0.91,
  },
});

if (candidates.ok) {
  const decision = evaluateDiscoveryCandidatePolicyPreflight(
    {
      ...candidates.candidates[0],
      quote: { amount: '5000', asset: 'AUDD', network: 'solana-devnet' },
    },
    {
      allowedSourceKinds: ['direct-ai-catalog'],
      allowedAssets: ['AUDD'],
      allowedNetworks: ['solana-devnet'],
      maxQuote: { amount: '10000', asset: 'AUDD', network: 'solana-devnet' },
    },
  );

  console.log(decision.allowed); // true only after explicit RAP policy preflight
}
```

Discovery candidates are source-neutral buyer-client inputs for local specialists, direct AI Catalogs, ARD registry/search fixtures, source adapters, and future hosted RAP registries. Candidate relevance is informational only; it is never used as a trust, safety, payment, or budget decision. Quotes, policy preflight, payment approval, invocation, receipts, evidence, attestations, and reputation remain separate RAP steps.

## Local Validation

```bash
npm run build
npm test
```

No secrets or network calls are required.
