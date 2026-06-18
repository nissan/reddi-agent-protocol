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

## Buyer Client And Seller Middleware

```typescript
import {
  createPaymentChallenge,
  evaluateBuyerPaymentChallenge,
  handlePaidSpecialistRequest,
} from '@reddi/agent-protocol/buyer-seller';

const challenge = createPaymentChallenge({
  mode: 'dry-run',
  quote: {
    amount: '50000',
    asset: 'USDC',
    network: 'solana-devnet',
    source: 'source:planning',
    specialist: 'specialist:coder',
  },
  payTo: 'solana:seller-demo',
  nonce: 'unit-001',
  endpoint: 'http://localhost:4021/specialist',
});

const buyerDecision = evaluateBuyerPaymentChallenge(challenge, {
  allowedRails: [{ asset: 'USDC', network: 'solana-devnet' }],
  paymentProofRef: 'dry-run:unit-001',
});

const response = await handlePaidSpecialistRequest({
  challenge,
  request: { body: { task: 'plan' }, paymentProofRef: buyerDecision.paymentProofRef },
  policyDecision: buyerDecision.policyDecision,
  specialist: async (body) => ({ ok: true, body }),
});
```

The buyer/seller helpers are local OSS SDK primitives. They do not run a server, submit payment, access a wallet, fetch a hosted registry, or invoke external providers by themselves. Seller middleware can return a structured `402` challenge in dry-run, fixture, or separately approved live mode. Buyer preflight parses the challenge, checks allowed rails, can call the completed local budget evaluator from `@reddi/x402-solana`, and returns machine-readable denial reasons before any payment or invocation. Approved dry-run requests execute only the bounded specialist function supplied by the caller and return a Reddi receipt plus EvidenceArchive record.

Run the local no-spend example:

```bash
npm run example:buyer-seller:dry-run
```

## AUDD/Solana Payment Plans

```typescript
import {
  createAuddPaymentChallenge,
  createAuddSolanaPaymentPlan,
  evaluateAuddPaymentPlanPreflight,
} from '@reddi/agent-protocol/audd-payment-plan';

const paymentPlan = createAuddSolanaPaymentPlan({
  network: 'solana-devnet',
  mint: 'AUDDdev111111111111111111111111111111111111',
  payee: 'solana:seller-demo',
  settlementAccount: 'solana:seller-demo',
  amount: '2500000',
  quoteExpiresAt: '2026-06-18T15:00:00.000Z',
  failurePolicy: {
    mode: 'no_charge_on_failure',
    description: 'Dry-run jobs do not charge when the specialist fails.',
  },
  refundPolicy: {
    mode: 'manual_review',
    description: 'Live refunds require operator review before settlement.',
  },
  evidenceRequired: true,
  paymentMode: 'dry-run',
});

const auddChallenge = createAuddPaymentChallenge({
  mode: 'dry-run',
  paymentPlan,
  quote: {
    source: 'source:ard-catalog',
    specialist: 'specialist:listing-writer',
  },
  nonce: 'audd-001',
  endpoint: 'http://localhost:4021/specialist',
});

const decision = evaluateAuddPaymentPlanPreflight(auddChallenge, {
  allowedNetworks: ['solana-devnet'],
  allowedMints: ['AUDDdev111111111111111111111111111111111111'],
  allowedPayees: ['solana:seller-demo'],
  allowedSettlementAccounts: ['solana:seller-demo'],
  maxAmount: '3000000',
  requireEvidence: true,
  approvalState: 'approved',
  paymentProofRef: 'dry-run:audd-001',
  now: '2026-06-18T14:00:00.000Z',
});
```

AUDD/Solana payment plans are metadata and policy-preflight helpers for RAP buyer/seller middleware. They represent AUDD quote amount, Solana network, mint, payee/settlement account, expiry, failure/refund policy, and evidence requirements without submitting transactions or requiring hosted RAP infrastructure. Buyer preflight fails closed unless the caller supplies explicit allowed networks, mints, payees, settlement accounts, evidence policy, operator approval, and either a max amount or budget evaluator. Live payment remains fail-closed unless buyer/operator approval is explicit; actual wallet actions, SPL custody, Quasar escrow, and settlement proof verification belong in payment-rail integrations and the Quasar boundary work.

## ARD No-Spend Quickstart

```bash
npm run example:ard:no-spend
```

The ARD no-spend example is a deterministic Discover -> Decide -> Prove workflow. It starts from `examples/ard-no-spend-ai-catalog.json`, validates the AI Catalog fixture, creates a discovery candidate, runs source-aware diagnostics, evaluates local policy/trust/payment gates, executes a bounded dry-run specialist function, and emits receipt, evidence, attestation, and reputation output.

The example also prints expected failure states for policy denial, malformed challenge, missing evidence, and unsupported AUDD/Solana network. It does not start a server, fetch an ARD registry, call hosted Reddi infrastructure, use secrets, invoke a paid provider, access a wallet, submit RPC/SPL transfers, or claim AUDD escrow custody.

## Local Validation

```bash
npm run build
npm test
```

No secrets or network calls are required.
