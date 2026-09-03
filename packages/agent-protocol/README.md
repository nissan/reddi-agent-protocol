# @reddi/agent-protocol

Open protocol primitives for paid agent work.

This package is the local-first Reddi Agent Protocol surface above payment rails such as `@reddi/x402-solana`. It defines receipt envelopes, policy decisions, deterministic fixtures, and validation helpers that run without hosted Reddi infrastructure, wallet keys, devnet/mainnet spend, or paid provider calls.

**Publication status:** repo-local v0.1 candidate. It is not published on npm yet; real publication is tracked by issue #603 and requires explicit operator approval.

## Install / local validation

Until #603 publishes the package, installability claims are limited to the repository checkout and dry-run tarball gates:

```bash
cd packages/agent-protocol
npm ci
npm run release:dry-run
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

## AUDD non-custodial foundation

`@reddi/agent-protocol/audd-rail-config` publishes the non-secret AUDD rail identity contract: deterministic fixture, generated local test mint, explicitly unverified/blocked devnet, and gated mainnet. The verified public mainnet identity is recorded as AUDD mint `AUDDttiEpCydTm7joUMbYddm72jAWXZnCpPZtDoxqBSw`, SPL Token program `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`, six decimals, with dated source provenance. Mainnet remains disabled by default.

`@reddi/agent-protocol/payment-records` adds rail-neutral canonical IDs for job, agreement, payment intent, payment observation, and refund records using stable canonical JSON SHA-256 hashing. Fixture, local-test-mint, and devnet-unverified labels are rejected if marked grant-volume eligible. Local-test-mint is configuration/test-only and has no public CAIP-2 export path.

AUDD payment plans remain `reddi.audd-payment-plan.v1` for legacy callers, with optional x402 v2 SVM `exact` fields (`caip2Network`, token program, decimals, memo, payment-flow, evidence/refund labels). Use `createAuddX402SvmExactPaymentPlan`, `createAuddPaymentIntentDraft`, and `createAuddX402SvmExactPaymentRequired` for the new bridge. Models create draft intents only; non-fixture spend still requires buyer policy and operator approval, and mainnet AUDD additionally requires a separate exact gate.

## Seller Wrapper Config Examples

```typescript
import {
  generateSellerWrapperConfigExamples,
  runSellerWrapperConfigNoSpendCheck,
} from '@reddi/agent-protocol/seller-wrapper-config';

const config = generateSellerWrapperConfigExamples();
console.log(config.endpoints[0].wrapper.quoteRoute); // /seller-wrapper/listing-writer-http/quote
console.log(config.endpoints[0].rails.map((rail) => rail.asset)); // SOL, USDC, AUDD
console.log(config.buyerAuthorityPolicy.fixtureStates.map((case_) => case_.key));

const check = await runSellerWrapperConfigNoSpendCheck();
console.log(check.validation.valid); // true
console.log(check.auddFlow.preflight.allowed); // true for the local no-spend AUDD flow
```

Seller-wrapper config examples turn the local rail-state fixture into MCP and HTTP/OpenAPI wrapper metadata: quote route, policy preflight route, mocked invocation route, receipt hook, evidence hook, and SOL/USDC/AUDD rail states. AUDD is represented as first-class payment-plan/proof metadata with mint, payee, settlement account, expiry, failure policy, refund policy, and evidence requirements.

Seller-wrapper config also carries buyer-authority policy contract metadata for onboarding and downstream templates. It references the buyer policy schema, #550 fixture matrix states, spend caps, allowed rails/currencies, seller allowlist, expiry, receipt/evidence requirements, refund/failure policy, operator approval, support-state constraints, and the discovery -> quote -> buyer-policy-preflight -> operator-approval -> invocation -> receipt/evidence lifecycle. The config points #543 framework-template conformance and #375 seller-wrapper flows at the same reason-coded matrix instead of creating parallel policy semantics.

The helper is no-spend and non-secret. It rejects credential-shaped metadata, live-payment approval, wallet/RPC/signing/transfer instructions, custody claims, and settlement-finality claims. It does not publish packages, invoke providers, call wallets/RPC endpoints, submit Pay.sh payments, or activate live rails.

## Buyer Authority Policy Examples

```typescript
import {
  buyerAuthorityPolicyExamples,
  evaluateBuyerAuthorityPolicy,
  listBuyerAuthorityPolicyFixtureMatrix,
} from '@reddi/agent-protocol/buyer-authority-policy';

const example = buyerAuthorityPolicyExamples.allow;
const result = evaluateBuyerAuthorityPolicy(example.policy, example.request);
console.log(result.allowed); // true in local no-live fixture mode

const denied = evaluateBuyerAuthorityPolicy(
  buyerAuthorityPolicyExamples.missingEvidenceRequirement.policy,
  buyerAuthorityPolicyExamples.missingEvidenceRequirement.request,
);
console.log(denied.reasonCodes); // evidence_requirement_missing

const matrix = listBuyerAuthorityPolicyFixtureMatrix();
console.log(matrix.map((case_) => case_.key));
```

Buyer authority policy examples make an agent's spending authority explicit before it discovers, quotes, preflights, invokes, or simulates payment for another agent. The static contract covers spend caps, allowed rails and currencies, seller allowlists, expiry, receipt/evidence requirements, refund/failure policy, operator approval thresholds, and support-state constraints.

The built-in fixture matrix covers allow, deny, expired, approval-required, unsupported rail, unsupported currency, seller-not-allowlisted, missing-receipt, missing-evidence, refund/failure-policy mismatch, and spend-cap-exceeded states. Downstream #543 framework-template conformance and #375 seller-wrapper flows should consume these reason-coded cases instead of inventing parallel buyer-authority semantics. AUDD/SOL/USDC remain proof, preflight, and support metadata only unless a separate audited custody or settlement workstream is approved.

The helper is no-spend and non-secret. It rejects credential-shaped metadata, live-payment approval, wallet/RPC/provider-call material, signing/transfer instructions, custody claims, and settlement-finality claims. It does not contact Airwallex, invoke providers, call wallets/RPC endpoints, transfer SPL tokens, activate Pay.sh, or settle funds.

## Framework Template Contract

```typescript
import {
  frameworkTemplateFixtures,
  listFrameworkTemplateFixtures,
  validateFrameworkTemplateContract,
} from '@reddi/agent-protocol/framework-template-contract';

const fixtures = listFrameworkTemplateFixtures();
console.log(fixtures.map((fixture) => fixture.kind)); // discovery, quote, preflight, ...

const result = validateFrameworkTemplateContract(frameworkTemplateFixtures.preflight.contract);
console.log(result.valid); // true in local static fixture mode
```

Framework-template contract fixtures define the shared surface that LangGraph, Strands, and ADK templates should consume before they add framework-specific scaffolding. The contract covers buyer-enabled, seller-enabled, and dual-mode profiles; agent identity; framework id; capability tags; invocation modes; seller profile; buyer authority policy matrix; execution result; receipt/evidence references; failure/refund state; and support-state metadata.

The built-in fixtures cover discovery, quote, buyer-policy preflight, operator approval, invocation, receipt/evidence binding, denial, and failure outcomes. They consume the #549 buyer-authority schema, #550 fixture matrix, and #551 seller-wrapper buyer-authority contract. Template implementations for #544/#545/#546 should import this contract instead of inventing framework-specific payment, policy, receipt, failure/refund, or support-state semantics.

The helper is static and no-live. It rejects credential-shaped metadata, truncated buyer-authority matrices, unsafe support states, live-payment approval, wallet/RPC/provider-call material, signing/transfer instructions, custody claims, missing receipt/evidence refs for allowed invocations, and settlement-finality claims.

## Framework Template Conformance

```typescript
import {
  runFrameworkTemplateNoLiveConformanceCheck,
} from '@reddi/agent-protocol/framework-template-conformance';

const check = runFrameworkTemplateNoLiveConformanceCheck();
console.log(check.valid); // true for the built-in local/static cases
```

The conformance checker is the #553 no-live gate for framework templates. It runs the shared #552 lifecycle fixtures plus explicit buyer-enabled, seller-enabled, and dual-mode profile cases before #544 LangGraph, #545 Strands, #546 ADK, or #547 comparison docs claim compatibility.

The checker validates required lifecycle fixtures, profile modes, agent identity, invocation modes, buyer-authority policy metadata, seller profile metadata, receipt/evidence refs for allowed invocations, failure/refund state, support-state metadata, and the same no-secret/no-wallet/no-RPC/no-provider/no-custody/no-transfer/no-settlement-finality boundary enforced by the contract validator.

This checker is local/static only. It does not install LangGraph, Strands, or ADK packages, scaffold projects, publish packages, call cloud or provider APIs, register hosted agents, access wallets/RPC endpoints, execute live or devnet payments, custody assets, transfer SPL tokens, or claim settlement finality.

## LangGraph RAP Template

```typescript
import {
  createLangGraphRapTemplateFixture,
  validateLangGraphRapTemplate,
} from '@reddi/agent-protocol/langgraph-rap-template';

const template = createLangGraphRapTemplateFixture();
const result = validateLangGraphRapTemplate(template);
console.log(result.valid); // true for the allowed local no-live fixture
```

The LangGraph template fixture maps RAP lifecycle state onto graph-shaped nodes without installing LangGraph or calling LangSmith, providers, wallets, RPC endpoints, or payment rails. It includes discovery, quote, buyer-policy preflight, operator approval, paid-agent invocation, receipt/evidence binding, and seller-wrapper endpoint helper nodes.

The fixture consumes the shared #552 framework-template contract and #553 no-live conformance checker. It stores framework-neutral RAP refs in graph state instead of inventing LangGraph-specific payment, policy, receipt, failure/refund, support-state, custody, or settlement semantics.

Built-in cases cover allowed no-live invocation, policy denial, missing approval, malformed quote/payment plan, credential-shaped output, and unsafe live/custody/provider claims. The validator fails closed for missing graph nodes, missing middleware, missing seller-wrapper helper routes, missing receipt/evidence refs, malformed shared contracts, credentials, wallet/RPC/provider material, custody claims, transfer instructions, and settlement-finality claims.

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

## Repo Explorer Evidence Manifests

```typescript
import {
  validateRepoExplorerEvidenceManifest,
  attachRepoExplorerEvidenceToSnapshot,
  projectRepoExplorerEvidence,
  repoExplorerEvidenceManifestFixtures,
} from '@reddi/agent-protocol/repo-explorer-evidence-manifest';

const report = validateRepoExplorerEvidenceManifest(repoExplorerEvidenceManifestFixtures.happyPath);
console.log(report.verdict); // valid
console.log(report.manifest?.sourceTrust); // external_untrusted (hard-coded)

const attachment = attachRepoExplorerEvidenceToSnapshot(report);
console.log(attachment.ok && attachment.attachment.source.snapshotRef); // repo-explorer-evidence:example-agent-stack@a3f18c9d02e1

const projections = projectRepoExplorerEvidence(report);
console.log(projections.draftReadiness.status); // needs_review — never 'ready' for external_untrusted evidence
console.log(projections.operatorReview.publication.disabled); // true

const blocked = validateRepoExplorerEvidenceManifest(repoExplorerEvidenceManifestFixtures.pathTraversal);
console.log(blocked.verdict, blocked.manifest); // blocked null — unsafe paths fail closed
```

Repo explorer evidence manifests (`reddi.repo-explorer-evidence-manifest.v1`) carry FastContext-style read-only exploration evidence for static fixture ingestion: repo/source URL, resolved commit SHA, task-specific exploration query, read-only explorer contract, file paths with line ranges and short relevance reasons, generated/noisy exclusions, and open questions. The manifest DESCRIBES exploration a caller already performed elsewhere; the module never fetches, clones, ingests, or executes anything, and the source trust boundary is hard-coded `external_untrusted`.

Explorer output is localization evidence, not approval to install, run, or adopt the explored repository. A `valid` verdict permits static review/analysis and by-reference provenance attachment only — installation, execution, full-repo ingestion, dependency install, publication, hosted writes, provider calls, wallet/RPC, and trust mutation stay denied on every report regardless of verdict.

Validation is fail-closed with structured reason codes: malformed paths (backslashes, control characters, empty/`.` segments), unsafe paths (absolute, `..` traversal, `file://`/URI schemes, drive prefixes, home expansion, percent-encoded traversal), invalid line ranges (zero, negative, reversed, non-integer), empty evidence, missing relevance reasons, self-contradictory excluded-path citations, non-https or credentialed source URLs, unresolved commits, self-asserted trust levels, and non-read-only explorer contracts all block; citations into generated/noisy content (node_modules, dist, lockfiles, minified bundles) are accepted but flagged for review.

Accepted manifests attach to the onboarding `static-agent-stack-snapshot` intake surface by reference: the snapshot attachment's `source` block is a structural match for the intake `snapshotRef` contract, and per-citation evidence refs satisfy the provenanced-field rule that `verified` provenance requires non-empty evidence refs — static fixture ingestion preserves explorer evidence as provenance without a full-repo ingest. Projection helpers map accepted evidence toward the shipped static-ingestion vocabularies: capability-inventory provenance (#403), connector-diagnostic records (#404), risk-taxonomy categories (#421), draft-payload readiness (#405, never `ready`), and operator-review payloads (#406, publication disabled).

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

## Pay.sh Sandbox Evidence

```typescript
import {
  derivePayShSandboxEvidenceFixture,
  payShSandboxEvidenceSummaries,
} from '@reddi/agent-protocol/pay-sh-sandbox-evidence';

const result = derivePayShSandboxEvidenceFixture(payShSandboxEvidenceSummaries.singleCharge);

if (result.ok) {
  console.log(result.fixture.status); // proven_single_charge
  console.log(result.fixture.bindingRefs.source.kind); // source-adapter
}
```

Pay.sh sandbox evidence fixtures normalize the historical RAP x402 artifact set into receipt/evidence binding references for quote, recipient, nonce, session, authorization, receipt, source service, and operator approval. The proven single-charge fixture records the sandbox 402 challenge and paid retry receipt. Capped-session and split-payment extension fixtures stay `probe_only` with the `pay_sh_0_16_returns_402_after_payment` blocker.

The helper is fixture-only. It does not run Pay.sh setup or CLI commands, call wallets/RPC endpoints, invoke providers, submit catalogs, write hosted registries, publish marketplace listings, upgrade trust, mutate reputation, or activate live payments. Malformed receipts and live-path markers fail closed.

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

## Source/Trust Conformance Matrix

```typescript
import {
  buildSourceTrustConformanceMatrix,
  classifySourceTrustCandidate,
} from '@reddi/agent-protocol/source-trust-conformance-matrix';

const matrix = buildSourceTrustConformanceMatrix();
console.log(matrix.coverage.complete); // true — all states, all required cases, both source kinds

const row = classifySourceTrustCandidate({
  candidateId: 'auth-md:example.com',
  source: { kind: 'auth-md', metadata: parsedAuthMdMetadata },
});
console.log(row.entryState); // listed_untrusted — always
console.log(row.registryProjection.verificationStatus); // provider-trust vocabulary
```

The source/trust conformance matrix proves that `auth.md` documents and ARD/AI Catalog provider metadata enter RAP as untrusted source metadata until explicit RAP-side trust/evidence gates classify them across `trusted` / `listed_untrusted` / `claimed` / `unverified` / `failed_verification` / `blocked` / `needs_human_review`. Malformed metadata, credential leakage, anonymous write scopes, unsupported credential types, and unsupported identity assertions fail closed — even for maximally relevant candidates. Rows project onto the provider-trust registry vocabulary and the source-diagnostics lanes. See `docs/conformance/source-trust-matrix/README.md` and `docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md`.

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

## Attestation/Reputation Bridge

```typescript
import {
  deriveAttestationReputationBridge,
} from '@reddi/agent-protocol/attestation-reputation-bridge';

const result = deriveAttestationReputationBridge({
  id: 'reputation-bridge:listing:research-agent',
  binding,            // reddi.receipt-evidence-binding.v1 (omit for external listings)
  compatibility,      // reddi.quasar-registry-compatibility.v1 (#390)
  hosted: {           // optional #442 hosted attestation gate metadata
    proof: hostedAttestationProof,
    operatorApproval,
    publicationGate,
  },
  createdAt: new Date().toISOString(),
});

console.log(result.bridge.status);
// hosted_attestation_backed / quasar_intent_fixtures / offchain_preview
// / insufficient_evidence / unverified_external / blocked
console.log(result.bridge.lanes.quasar.instructionFlow);          // not_built
console.log(result.bridge.display.buyerFacingClaimAllowed);       // false
```

The attestation/reputation bridge (`reddi.attestation-reputation-bridge.v1`, #394) composes the off-chain reputation preview, the Quasar reputation-intent fixture gate, and the hosted attestation claim into one read-model per listing/job record set, so a UI/API surface can explain in a single call whether reputation is an off-chain preview, backed by hosted attestation evidence, or has fixture-level Quasar intent records — and if none of those, why. External listings without a receipt/evidence binding are marked `unverified_external` instead of receiving any reputation surface, and `listingProjection` exposes per-lane states in the marketplace evidence vocabulary.

Honesty contract: the Quasar lane never reports "Quasar-backed" reputation. Its strongest state is `quasar_intent_fixtures` with `instructionFlow: 'not_built'` and `quasarBackedReputation: false`, because #443 intent records are data, not instructions. All composed derivations keep their own fail-closed gates, so failed policy, missing evidence, failed attestation, or unverified payment proof never produce a reputation surface, and nothing in the bridge signs, calls RPC, writes hosted registries, executes payments, or mutates reputation.

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

AUDD/Solana payment plans are metadata and policy-preflight helpers for RAP buyer/seller middleware. They represent AUDD quote amount, Solana network, mint, payee/settlement account, expiry, failure/refund policy, and evidence requirements without submitting transactions or requiring hosted RAP infrastructure. Buyer preflight fails closed unless the caller supplies explicit allowed networks, mints, payees, settlement accounts, evidence policy, operator approval, and either a max amount or budget evaluator. See [AUDD non-custodial foundation](#audd-non-custodial-foundation) for the canonical x402 export and read-only observation boundary; actual wallet actions, SPL custody, Quasar escrow, and settlement proof verification remain outside this package.

## Browser Wallet Approval Preflight

```typescript
import {
  validateBrowserWalletApprovalRecord,
  validateBrowserWalletTier1LocalHarnessContract,
  validateBrowserWalletIdentityCopyClaims,
  DORMANT_TIER1_LOCAL_BROWSER_HARNESS_CONTRACT,
} from '@reddi/agent-protocol/browser-wallet-approval';

const result = validateBrowserWalletApprovalRecord(approvalJson);
console.log(result.ok); // false for missing/expired/contradictory records
```

Browser wallet approval helpers provide offline contracts and pure validators for browser-wallet safety preflight:

- `validateBrowserWalletApprovalRecord` verifies single-use Devnet approval records against `reddi.browser-wallet.single-use-approval.v1`. It enforces strict single-use scope, provider/version/source pinning, disposable profile requirements, public-key-only custody, canonical network/program IDs, ordered timestamps (`approvedAt` before `expiresAt`, provider `retrievedAt` no later than `approvedAt`), and fail-closed AUDD/USDC asset constraints.
- `validateBrowserWalletTier1LocalHarnessContract` validates the dormant Tier 1 local browser harness contract (`DORMANT_TIER1_LOCAL_BROWSER_HARNESS_CONTRACT`), enforcing `enabledByDefault: false`, local-only loopback, and a six-decimal `AUDD_TEST`/`LOCAL_AUDD_TEST` SPL test mint with `grantEligibility=non_eligible`.
- `validateBrowserWalletIdentityCopyClaims` validates browser-wallet evidence and copy rows against `reddi.browser-wallet.identity-copy-guard.v1`, evaluating claims per clause so badges cannot suppress overclaims and rejecting official AUDD, grant-eligible, observed-settlement, and controlled-live claims across safety rows.

These helpers are pure, offline validators. They never install extensions, access wallets or keypairs, request faucet tokens, start validators, or sign, simulate, or submit transactions. See [Browser Wallet Safety Preflight](../../docs/BROWSER-WALLET-SAFETY-PREFLIGHT.md) for full operational runbooks and rollback policies.

## ARD No-Spend Quickstart

From a fresh checkout, the local proof path should complete in under five minutes:

```bash
git clone https://github.com/nissan/reddi-agent-protocol.git
cd reddi-agent-protocol/packages/agent-protocol
npm ci
npm run example:ard:no-spend
```

The ARD no-spend example is a deterministic Discover -> Decide -> Prove workflow. It starts from `examples/ard-no-spend-ai-catalog.json`, validates the AI Catalog fixture, creates a discovery candidate, runs source-aware diagnostics, evaluates local policy/trust/payment gates, executes a bounded dry-run specialist function, and emits receipt, EvidenceArchive, attestation draft, reputation update, AUDD dry-run payment-plan/preflight, and source diagnostics output.

The JSON output labels the run as fixture-only and no-spend:

- `payment.mode` is `dry-run`, with `paymentProofRef` set to a local `dry-run:*` ref.
- `receiptEvidenceBinding` links the receipt, EvidenceArchive record, payment proof ref, request hash, response hash, and evidence ref using `bindingMode: "local_fixture_refs_only"`.
- `railNeutralProofChain` includes the #489 rail-neutral proof-chain fixture bridge: the Pay.sh sandbox single-charge fixture is `binding_ready` by refs/hashes only, while Tempo unsupported network, unsupported asset/network, malformed receipt, policy denied, and live-path overclaim cases fail closed.
- `downstreamPublicProofContracts` names the app-level public proof data contract (`reddi.economic-demo.public-proof-page-data.v1`) and paid workflow proof UI fixture pack (`reddi.economic-demo.paid-workflow-proof-ui-fixture-pack.v1`) so downstream pages can consume the same proof states without inventing another schema.
- `downstreamPublicProofContracts.stateLabels` includes `fixture_zero_spend`, `planned_dry_run`, `simulated`, `devnet_proof_metadata`, `live_gated`, and `production_live_disabled`.
- `boundaries` keeps hosted service, paid provider, wallet access, RPC call, SPL transfer, Quasar custody, settlement-finality proof, trust upgrade, reputation mutation, and live payment flags false.

The example also prints expected failure states for policy denial, malformed challenge, missing evidence, missing operator/payment setup, unsupported AUDD/Solana network, and unsafe/credential-shaped evidence metadata. It does not start a server, fetch an ARD registry, call hosted Reddi infrastructure, use secrets, invoke a paid provider, access a wallet, submit RPC/SPL transfers, mutate trust or reputation state, publish to a marketplace, claim AUDD escrow custody, prove settlement finality, or perform a live payment.

Run the deterministic conformance check for this quickstart:

```bash
npm test -- --test-name-pattern "ARD no-spend demo"
```

## Public Conformance Suite

A single deterministic command composes the per-module conformance suites (receipt shape, policy-decision shape, source metadata, 402 challenge handling, evidence binding, secret-leakage rejection, the quickstart workflow, interop conformance modules) and the packed-artifact secret/content guard:

```bash
npm run conformance
```

From the repo root the same suite runs as `npm run check:conformance:public`, and CI runs it on every pull request touching this package. See [RAP v0.1 Developer Quickstart and Conformance](https://github.com/nissan/reddi-agent-protocol/blob/main/docs/RAP-V0.1-DEVELOPER-QUICKSTART-AND-CONFORMANCE.md) for the area-by-area breakdown and the fixture coverage matrix.

## Local Validation

```bash
npm run build
npm test
```

No secrets or network calls are required.
