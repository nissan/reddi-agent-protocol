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

## Agent-Stack Fixture Corpora

```typescript
import {
  agentStackFixtureCorpora,
  createAgentStackFixtureCorpus,
  createStaticAgentStackIngestionResult,
} from '@reddi/agent-protocol/agent-stack-fixtures';

const corpus = createAgentStackFixtureCorpus(agentStackFixtureCorpora.anthropicFinancialServices);
const result = createStaticAgentStackIngestionResult(corpus);
const solanaKit = createStaticAgentStackIngestionResult(agentStackFixtureCorpora.solanaAiKit);

console.log(corpus.source.checkedCommit); // 4bbabc7cd1a474c1667fa05a2bfe58e411dcf9c1
console.log(corpus.files.some((file) => file.parseStatus === 'malformed')); // true
console.log(result.status); // partial_success while malformed connector diagnostics block draft readiness
console.log(solanaKit.draftPayloadReadiness.status); // blocked until hooks, deploy commands, and MCPs are reviewed
console.log(solanaKit.riskDiagnostics.map((diagnostic) => diagnostic.category)); // static risk taxonomy for operator review
console.log(solanaKit.capabilityInventory.entries.map((entry) => entry.runtimeSurface)); // parsed static inventory handoff
console.log(solanaKit.draftPayloads.listing.publicationDisabled); // true until payment, endpoint, review, and readiness gates pass
console.log(solanaKit.operatorReviewPayload.publication.disabled); // true until operator approval and readiness gates pass
```

Agent-stack fixture corpora are public, static inputs for onboarding-analyser parser and diagnostics work. The built-in Anthropic financial-services fixture records source URL, checked commit, license/source notes, authenticity notes, crawl timestamp, local research artifact path, high-level marketplace/plugin/managed-agent/MCP surfaces, and validation warnings. The built-in Solana AI Kit fixture records the same source provenance for a Solana-heavy agent-stack toolkit with plugin metadata, agent definitions, commands, MCP declarations, hooks, rules, skills, installer/update/test scripts, and external submodule declarations.

Fixture ingestion rejects credential-shaped metadata, unsafe source URLs, invalid commit refs, invalid timestamps, oversized corpora, and malformed corpus shapes. Public prompt, skill, command, and recipe text is always labelled as untrusted fixture content.

Static ingestion results are deterministic handoff envelopes for later parser, connector-diagnostics, draft-profile, and operator-review work. They combine fixture source metadata, normalized inventory entries, a parsed capability inventory bundle, MCP connector diagnostics, non-MCP static risk diagnostics, rejected entries, validation warnings, and draft-payload readiness without fetching the network or executing imported code.

The capability inventory bundle is the static #371/#403 handoff. It maps fixture surfaces into source paths, runtime surfaces, commands, skills, tool grants, auth/data dependencies, safety hints, human-review hints, write-capable flags, side-effect risk, content-trust boundaries, parser diagnostics, and fixture provenance. It does not parse or execute imported prompt/skill/command text; those remain untrusted metadata for later operator review.

Risk diagnostics normalize executable hooks, installer/update/test scripts, deploy-capable commands, wallet/RPC-capable command metadata, local binary requirements, env-required connector metadata, MCP launcher execution, permission policies, and external submodule declarations into the same static ingestion result. They are review payloads only; connector parsing still belongs to the MCP connector diagnostics lane.

Draft payloads produce a RAP agent profile draft, AI Catalog fragment, and registry/listing draft from static fixture metadata. They carry missing-payment, missing-endpoint, malformed-connector, rejected-entry, unsafe-metadata, and static-risk states forward while keeping publication disabled, payment activation disabled, provider trust unverified, and imported content untrusted until later operator and readiness gates pass.

Operator review payloads expose deterministic backend hooks for imported agent-stack review queues. They group parsed repo/plugin surfaces, validation warnings, rejected entries, raw snapshot references, missing payment and endpoint setup, malformed connector states, static risk blockers, and buyer-preview lanes for capability relevance, source authenticity, trust evidence, payment readiness, safety risk, and reputation. They are payloads only: approval, publication, payment activation, provider trust, and reputation remain disabled or unverified until explicit operator approval and #373/#377 readiness gates pass.

The fixture corpus never installs Claude plugins, executes repo scripts, invokes managed agents, contacts MCP servers, fetches paid/provider data, requires credentials, starts local services, calls wallets/RPC endpoints, or publishes imported surfaces as payable RAP listings. Parser, connector-diagnostics, draft-profile, and operator-review behavior are static metadata transformations only.

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

Hosted RAP catalog/search surfaces follow the same source-neutral boundary. See [Hosted RAP Discovery Surfaces](../../docs/HOSTED-RAP-DISCOVERY-SURFACES.md) for the hosted-by-RAP, self-hosted, and externally listed source classes plus the future-safe federation/referral posture.

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

## Off-Chain Reputation Preview

```typescript
import {
  deriveOffchainReputationPreview,
} from '@reddi/agent-protocol/offchain-reputation-preview';

const result = deriveOffchainReputationPreview({
  id: 'preview:listing:planning-001',
  binding: receiptEvidenceBinding,
  subject: { id: 'listing:planning-001', type: 'listing' },
  createdAt: new Date().toISOString(),
});

console.log(result.preview.status); // preview_ready / insufficient_evidence / blocked
console.log(result.preview.display.buyerFacingClaimAllowed); // false
```

Off-chain reputation preview consumes `reddi.receipt-evidence-binding.v1` records and projects an explanatory reputation preview without mutating reputation state. It requires safe binding guardrails, allowed policy/payment preflight metadata, evidence refs, attestation evidence, and matching reputation-event drafts before returning a score preview. Missing attestation or reputation draft data stays `insufficient_evidence`; denied policy/payment, malformed evidence, unsafe live guardrails, failed attestations, or mismatched event ids are blocked.

This preview is not Quasar-backed and does not build instruction flows while #390 compatibility is pending. It never performs wallet signing, RPC calls, hosted registry writes, marketplace publication, live payment execution, provider calls, or reputation mutation, and it never allows buyer-facing trust/reputation claims from preview data alone.

## Hosted Attestation Claim

```typescript
import {
  deriveHostedAttestationClaim,
} from '@reddi/agent-protocol/hosted-attestation-claim';

const result = deriveHostedAttestationClaim({
  id: 'hosted-claim:listing:research-agent',
  binding,
  preview,
  hostedAttestationProof: {
    sourceProofRef: 'source-proof:research-agent',
    attestationProofRef: 'hosted-attestation-proof:research-agent',
    hostedBy: 'reddi',
  },
  operatorApproval: {
    approved: true,
    evidenceRef: 'operator-approval:research-agent',
  },
  publicationGate: {
    issue: 395,
    state: 'claim_contract_ready',
    evidenceRef: 'publication-gate:research-agent',
  },
  createdAt: new Date().toISOString(),
});

console.log(result.claim.status); // hosted_attestation_ready / publication_gate_pending / insufficient_evidence / blocked
console.log(result.claim.display.buyerFacingClaimAllowed); // false
```

Hosted attestation claims consume `reddi.receipt-evidence-binding.v1` records plus `reddi.offchain-reputation-preview.v1` previews. A hosted-backed claim requires matching evidence, passed attestation, preview-ready reputation draft, explicit hosted source/attestation proof refs, operator approval evidence, and #395 publication-gate metadata. Missing hosted proof, operator approval, or publication-gate metadata remains `publication_gate_pending`; malformed, failed, disputed, refunded, mismatched, unsafe, or blocked evidence fails closed.

This is a claim contract for downstream publication gates, not marketplace publication itself. It does not mutate reputation, build Quasar instructions, sign wallets, call RPC, write hosted registries, execute live payments, call providers, or permit buyer-facing trust/reputation claims. Quasar-backed instruction fixtures remain separate work after the Surfpool/devnet promotion checklist.

## Quasar Registry Compatibility

```typescript
import {
  deriveQuasarRegistryCompatibility,
} from '@reddi/agent-protocol/quasar-registry-compatibility';

const report = deriveQuasarRegistryCompatibility({
  listingId: 'listing:research-agent',
  displayName: 'Research Agent',
  role: { callable: true },
  model: 'qwen3:8b',
  registrationIntent: 'metadata_only',
  offchain: {
    description: 'Rich listing copy remains off-chain.',
    ardUrl: 'https://agents.example/.well-known/ai-catalog.json',
    auddTerms: { asset: 'AUDD', network: 'solana-devnet' },
  },
});

console.log(report.registrationStatus); // metadata_only / registerable / blocked
console.log(report.guardrails.instructionBuilt); // false
```

Quasar registry compatibility separates compact on-chain `AgentAccount` fields from hosted RAP and ARD listing metadata. The compact projection is limited to owner, agent type, model, native lamport rate, minimum reputation, active state, and decoded read-only reputation/attestation aggregates. Rich descriptions, endpoints, ARD/catalog refs, AUDD/x402/payment-plan terms, EvidenceArchive refs, trust badges, capabilities, tags, health checks, review states, and operator approval evidence remain off-chain.

The mapper is a compatibility report only. It does not build Quasar instructions, sign wallets, call RPC, deploy programs, activate live payments, or publish hosted listings. Imported/static listings without an explicit owner and native SOL lamport rate stay `metadata_only` rather than becoming register instructions.

Future PRs that move from compatibility reports into instruction builders, transaction assembly, Surfpool validation, or devnet wallet use must follow the Quasar Surfpool/devnet promotion checklist in [`../../docs/QUASAR-SURFPOOL-DEVNET-PROMOTION-CHECKLIST.md`](../../docs/QUASAR-SURFPOOL-DEVNET-PROMOTION-CHECKLIST.md). Package/read-model work like this mapper does not require Surfpool or devnet.

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
