# @redditech/agent-protocol

Reddi Agent Protocol SDK for paid agent work: find and rank providers, read ADL agent definitions, apply payment policy and check signed receipts.

> Payments prove transfer; RAP Assurance proves paid work.

This package is the local-first Reddi Agent Protocol surface above payment rails such as `@redditech/x402-solana`. It defines the provider-signed receipt (`reddi.receipt.v2`), payment records, evidence and attestation records, discovery and trust metadata, deterministic fixtures, and validation helpers that run without hosted Reddi infrastructure, wallet keys, devnet/mainnet spend, or paid provider calls. It is not a payment facilitator, marketplace operator, custody provider, or production runtime.

**Publication status:** repo-local v0.1 candidate. It is not published on npm yet; real publication is tracked by issue #603 and requires explicit operator approval.

## Install / local validation

Until #603 publishes the package, installability claims are limited to the repository checkout and dry-run tarball gates:

```bash
cd packages/agent-protocol
npm ci
npm run release:dry-run
```

## Receipt v2

```ts
import { hashReddiReceiptV2Body, verifyReddiReceiptV2 } from '@redditech/agent-protocol/receipt-v2';

const result = verifyReddiReceiptV2(signedReceipt, {
  providerId: providerWalletYouPaid,
  requestHash: hashReddiReceiptV2Body(requestBodyYouSent),
  responseHash: hashReddiReceiptV2Body(responseBodyYouReceived),
  payment: { network: 'solana-devnet', txSignature: paymentYouMade },
});
```

`reddi.receipt.v2` is the receipt for every paid call in V1. The provider issues and signs it with its wallet key (ed25519 over a fixed-order canonical form). It carries:

- `providerId`, `declaredModel`, `requestHash`, `responseHash`, `issuedAt`, and optionally `jobId`;
- `payment`: `network`, `txSignature`, `currency` (SOL, USDC, PYUSD, USDG or AUDD), `mint` (every currency except SOL), `amount` (the listed price in the smallest unit), `fee` (`amount` and the `treasury` that received it), `settlement` (`direct` or `escrow`) and, when the provider checked it, `payer`.

Verification is offline. Pass what you know yourself as the expectation: without it, a pass only says that some key signed some statement. The payment fields are the provider's statement; check the named transaction on chain before relying on them. A valid signature shows what the provider declared. It does not show which model ran.

`reddi.receipt.v2` is the only receipt this package accepts. `reddi.receipt.v1` and the modules built on it were removed before V1 (#776), and `validateReddiReceiptV2` rejects any other version. These are source-level helpers; no deployed provider issues v2 receipts yet.

## Policy Decisions

```typescript
import { policyDecisionFromBudgetPolicyDecision } from '@redditech/agent-protocol';

const policyDecision = policyDecisionFromBudgetPolicyDecision({
  allowed: false,
  reasonCodes: ['request_amount_exceeds_limit'],
  quotedAmount: { amount: '150000', asset: 'USDC', network: 'solana-devnet' },
  remainingBudget: { perRequest: '0' },
  auditNotes: ['Denied: request quote exceeds per-request limit.'],
});
```

Use payment-rail packages to settle and verify payment-specific proofs. A RAP receipt records what the provider declared about one paid call; it does not upgrade payment proof into work-quality, settlement-finality, or production-readiness claims.

## AUDD non-custodial foundation

`@redditech/agent-protocol/audd-rail-config` publishes the non-secret AUDD rail identity contract: deterministic fixture, generated local test mint, explicitly unverified/blocked devnet, and gated mainnet. The verified public mainnet identity is recorded as AUDD mint `AUDDttiEpCydTm7joUMbYddm72jAWXZnCpPZtDoxqBSw`, SPL Token program `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`, six decimals, with dated source provenance. Mainnet remains disabled by default.

`@redditech/agent-protocol/payment-records` adds rail-neutral canonical IDs for job, agreement, payment intent, payment observation, and refund records using stable canonical JSON SHA-256 hashing. Fixture, local-test-mint, and devnet-unverified labels are rejected if marked grant-volume eligible. Local-test-mint is configuration/test-only and has no public CAIP-2 export path.

The AUDD payment-plan and x402 bridge helpers were removed with receipt v1 (#776). AUDD here is rail identity and record metadata only.

## AI Catalog Ingestion

```typescript
import { createAiCatalogSnapshot, aiCatalogFixtures } from '@redditech/agent-protocol/ai-catalog';

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
} from '@redditech/agent-protocol/agent-stack-fixtures';

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
} from '@redditech/agent-protocol/repo-explorer-evidence-manifest';

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
import { createAiCatalogProviderTrustRecord, providerTrustFixtures } from '@redditech/agent-protocol/provider-trust';

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
} from '@redditech/agent-protocol/discovery-source';
import { providerTrustFixtures } from '@redditech/agent-protocol/provider-trust';

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
} from '@redditech/agent-protocol/evidence-archive';

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
import { createSourceAwareCandidateDiagnostics } from '@redditech/agent-protocol/source-diagnostics';

const diagnostics = createSourceAwareCandidateDiagnostics(candidate, {
  policyDecision: decision,
  reputation: { receiptCount: 2, attestationCount: 1 },
});

console.log(diagnostics.capabilityMatch.scoreMeaning); // relevance_only_not_trust
console.log(diagnostics.policyDecision.reasonCodes); // machine-readable allow/deny reasons
```

Source-aware diagnostics expose separate lanes, one per returned field: `capabilityMatch`, `discoverySource`, `publisherIdentity`, `trustEvidence` (the evidence a trust claim would rest on, not a trust verdict), `policyDecision`, `paymentFit`, and `reputationEvidence`. ARD and registry relevance scores are always labelled as relevance only; they are never collapsed into trust, policy, payment, or reputation approval.

## Source/Trust Conformance Matrix

```typescript
import {
  buildSourceTrustConformanceMatrix,
  classifySourceTrustCandidate,
} from '@redditech/agent-protocol/source-trust-conformance-matrix';

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
} from '@redditech/agent-protocol/attestation-reputation';

const state = createInitialReputationState({ id: 'specialist:coder', type: 'specialist' });
const update = applyAttestationToReputation(attestationRecord, state);

if (update.ok) {
  console.log(update.event.schemaVersion); // reddi.reputation-event.v1
  console.log(update.state.routingImpact); // eligible / watch / deprioritized / etc.
}
```

Attestation v1 records include schema version, evidence reference, evidence hash, rubric dimensions, confidence, verdict, work status, and trust boundary. The required rubric dimensions are `evidence_integrity`, `policy_compliance`, and `delivery_quality`.

Reputation updates are deterministic and local-first. Invalid or incomplete rubrics fail closed and return the previous reputation state unchanged. Failed, disputed, and refunded work produce explicit status and routing-impact reason codes. Self-attested and external-attested records are evidence inputs, not verified claims; `reddi_attested` and `verified` boundaries must come from RAP-side verification or operator-controlled attestations.

## Quasar Registry Compatibility

```typescript
import {
  deriveQuasarRegistryCompatibility,
} from '@redditech/agent-protocol/quasar-registry-compatibility';

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

## Browser Wallet Approval Preflight

```typescript
import {
  validateBrowserWalletApprovalRecord,
  validateBrowserWalletTier1LocalHarnessContract,
  validateBrowserWalletIdentityCopyClaims,
  DORMANT_TIER1_LOCAL_BROWSER_HARNESS_CONTRACT,
} from '@redditech/agent-protocol/browser-wallet-approval';

const result = validateBrowserWalletApprovalRecord(approvalJson, {
  now: new Date(),
  trustedDevnetProgramIds: resolvedDevnetProgramIds,
  trustedDevnetRpcEndpoints: { rpcHttp: resolvedDevnetRpcHttp, rpcWs: resolvedDevnetRpcWs },
});
console.log(result.ok); // false for missing/expired/contradictory or unbound records
```

Browser wallet approval helpers provide offline contracts and pure validators for browser-wallet safety preflight:

- `validateBrowserWalletApprovalRecord` verifies static Devnet approval records against `reddi.browser-wallet.single-use-approval.v1`. It requires trusted Devnet program IDs and trusted Devnet RPC endpoints (`rpcHttp`, `rpcWs`) from the caller and rejects records whose claimed resolved IDs or credential/query-bearing endpoints differ from them exactly. It enforces single-use metadata, provider/version/source pinning, disposable profile requirements, public-key-only custody, canonical network/program IDs, canonical UTC and ordered timestamps (`approvedAt` no later than evaluation time and before `expiresAt`, provider `retrievedAt` no later than `approvedAt`), and fail-closed AUDD/USDC asset constraints. A supplied string `now` must itself be canonical UTC ISO-8601; malformed or alternate encodings are rejected instead of falling back to the wall clock (omitting `now` still evaluates against the current time). Validation does not durably consume a record, and this package defines neither a maximum lifetime nor a consumption owner. The dormant future-AUDD option also requires independently supplied trusted identity data; fields inside the approval cannot attest themselves.
- `validateBrowserWalletTier1LocalHarnessContract` validates the dormant Tier 1 local browser harness contract (`DORMANT_TIER1_LOCAL_BROWSER_HARNESS_CONTRACT`), enforcing `enabledByDefault: false`, local-only loopback, a closed observation-field set, closed prohibited-action identifiers, and a six-decimal `AUDD_TEST`/`LOCAL_AUDD_TEST` SPL test mint with `grantEligibility=non_eligible`.
- `validateBrowserWalletIdentityCopyClaims` validates browser-wallet evidence and copy rows against `reddi.browser-wallet.identity-copy-guard.v1`, evaluating each official-AUDD, direct AUDD-endorsement, or grant-eligibility occurrence so an unrelated negation or badge cannot suppress an overclaim and double negation is refused. Compact and separator-delimited official branding and direct active/passive endorsement wording are rejected; directly negated identity/endorsement disclaimers remain allowed. This is a deterministic lexical guard, not complete natural-language endorsement detection. Safety rows must not claim official AUDD, AUDD endorsement, grant eligibility, observed settlement, or controlled-live status, and settlement/finality or controlled-live wording is refused even when negated. Reserved-brand derivatives and ambiguous Unicode fail closed. Every row must carry its full rail identity (`networkAlias`, `caip2`, `mint`, `tokenProgram`, `decimals`, `observationSource`); concrete mints must be valid Solana public keys, fields are required rather than optional, and each is bound to the row's rail environment. Parsed deterministic-fixture x402 output uses the qualified `fixture-observed` state, never unqualified `observed`.

These helpers are pure, offline validators. They never install extensions, access wallets or keypairs, request faucet tokens, start validators, or sign, simulate, or submit transactions. See [Browser Wallet Safety Preflight](../../docs/BROWSER-WALLET-SAFETY-PREFLIGHT.md) for full operational runbooks and rollback policies.

## ARD No-Spend Quickstart

From a fresh checkout, the local proof path should complete in under five minutes:

```bash
git clone https://github.com/nissan/reddi-agent-protocol.git
cd reddi-agent-protocol/packages/agent-protocol
npm ci
npm run example:ard:no-spend
```

The ARD no-spend example is a deterministic Discover -> Decide -> Prove workflow. It starts from `examples/ard-no-spend-ai-catalog.json`, validates the AI Catalog fixture, creates a discovery candidate, runs source-aware diagnostics and the buyer's discovery policy preflight, calls a local fixture specialist, has the fixture provider sign a `reddi.receipt.v2`, verifies that receipt offline against what the buyer knows, and records evidence, an attestation and a reputation projection.

The JSON output labels the run as fixture-only and no-spend:

- `receipt` shows the verified `reddi.receipt.v2`: provider, declared model, request and response hashes and the payment the provider states. `payment.fixtureTransaction` is `true`: the transaction signature is a made-up fixture value and no payment was made.
- `receipt.reading` says what a pass means: the provider declared this model and this payment. It is not proof of which model ran.
- `evidence` links the EvidenceArchive record to the receipt's job id and names the signed receipt by hash.
- `boundaries` records that the run does not use a hosted service, paid provider, wallet, RPC call or SPL transfer, and does not claim Quasar custody, settlement finality, model execution, a trust upgrade, a reputation mutation or a live payment: every flag is false.

The example also prints failure states, each of which must refuse: discovery policy denial, unsupported network, a response that is not the one signed, a different provider than the one chosen, a receipt edited after signing, a different payment, a removed receipt version, missing evidence, and credential-shaped evidence metadata. The provider key in the example is derived from a public label in the file and is a fixture, not a wallet. The example does not start a server, fetch an ARD registry, call hosted Reddi infrastructure, use secrets, invoke a paid provider, access a wallet, submit RPC/SPL transfers, mutate trust or reputation state, publish to a marketplace, claim AUDD escrow custody, prove settlement finality, or perform a live payment.

Run the deterministic conformance check for this quickstart:

```bash
npm test -- --test-name-pattern "ARD no-spend demo"
```

## Public Conformance Suite

A single deterministic command composes the per-module conformance suites (receipt v2 shape and signature, payment records, source metadata, challenge shapes, evidence and attestation, secret-leakage rejection, the quickstart workflow, interop conformance modules) and the packed-artifact secret/content guard:

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
