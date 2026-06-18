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

## EvidenceArchive

```typescript
import {
  createEvidenceArchiveRecord,
  createLocalEvidenceArchive,
} from '@reddi/agent-protocol/evidence-archive';

const record = createEvidenceArchiveRecord({
  id: 'evidence:demo:001',
  receiptId: 'receipt:demo:001',
  sourceId: 'source:demo',
  requestHash: 'sha256:7b2d0ef8455d0f0f41a37ea5e6a47f52c0d73d97f426097f159a98f8c8fb6b15',
  responseHash: 'sha256:8c9d1f1e3d0f02b5afcbb31dfbb3ab3de70ce1b84ff3ca856d272b2f4f7f4501',
  evidenceRef: 'file://fixtures/evidence/demo-001.json',
  createdAt: new Date().toISOString(),
  evidencePayload: { result: 'private payload stays outside the receipt' },
});

const archive = createLocalEvidenceArchive();
archive.put(record);
```

EvidenceArchive v1 stores request, response, receipt, source, attestation, and evidence hash references without embedding private payloads in public receipts. The local archive is deterministic for tests and demos. Walrus, Seal, IPFS, and custom archive pointers are represented as future sidecar references, not required product-core dependencies.

## Source-Aware Diagnostics

```typescript
import { createSourceAwareCandidateDiagnostics } from '@reddi/agent-protocol/source-diagnostics';

const diagnostics = createSourceAwareCandidateDiagnostics(candidate, {
  policyDecision: decision,
  reputation: { receiptCount: 2, attestationCount: 1 },
});

console.log(diagnostics.capabilityMatch.scoreMeaning); // relevance_only_not_trust
console.log(diagnostics.policyDecision.reasonCodes); // machine-readable allow/deny reasons
```

Source-aware diagnostics expose separate lanes for capability match, discovery source, publisher identity, trust evidence, policy decision, payment fit, and reputation evidence. ARD and registry relevance scores are always labelled as relevance only; they are never collapsed into trust, policy, payment, or reputation approval.

## Attestation And Reputation

```typescript
import {
  applyAttestationToReputation,
  createInitialReputationState,
} from '@reddi/agent-protocol/attestation-reputation';

const state = createInitialReputationState({ id: 'specialist:coder', type: 'specialist' });
const update = applyAttestationToReputation(attestationRecord, state);

if (update.ok) {
  console.log(update.event.schemaVersion); // reddi.reputation-event.v1
  console.log(update.state.routingImpact); // eligible / watch / deprioritized / etc.
}
```

Attestation v1 records include schema version, evidence reference, evidence hash, rubric dimensions, confidence, verdict, work status, and trust boundary. The required rubric dimensions are `evidence_integrity`, `policy_compliance`, and `delivery_quality`.

Reputation updates are deterministic and local-first. Invalid or incomplete rubrics fail closed and return the previous reputation state unchanged. Failed, disputed, and refunded work produce explicit status and routing-impact reason codes. Self-attested and external-attested records are evidence inputs, not verified claims; `reddi_attested` and `verified` boundaries must come from RAP-side verification or operator-controlled attestations.

## Local Validation

```bash
npm run build
npm test
```

No secrets or network calls are required.
