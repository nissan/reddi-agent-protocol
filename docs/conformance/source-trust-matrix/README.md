# Source/Trust Conformance Matrix — auth.md and ARD/AI Catalog Provider Metadata

Issues: [#450](https://github.com/nissan/reddi-agent-protocol/issues/450) (this matrix), under epics [#336](https://github.com/nissan/reddi-agent-protocol/issues/336) / [#363](https://github.com/nissan/reddi-agent-protocol/issues/363). Consumers: [#343](https://github.com/nissan/reddi-agent-protocol/issues/343) provider trust registry, [#344](https://github.com/nissan/reddi-agent-protocol/issues/344) source-aware diagnostics.

Module: `packages/agent-protocol/src/source-trust-conformance-matrix.ts` (`reddi.source-trust-conformance-matrix.v1`, exported as `@reddi/agent-protocol/source-trust-conformance-matrix`).

This matrix proves, with deterministic in-memory fixtures only, that **`auth.md` documents and ARD/AI Catalog provider metadata enter RAP as untrusted source metadata and stay untrusted until explicit RAP-side trust/evidence gates classify them**. No live fetch, no network, no wallet/RPC, no registry write, no trust or reputation mutation happens anywhere in this lane.

## Boundary: discovery relevance is not trust

This matrix does not restate the stage model — that lives in
[`docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md`](../../DISCOVER-DECIDE-PROVE-BOUNDARIES.md) (#452).
What this matrix enforces is the load-bearing consequence of that doc for source metadata:

- Discovery relevance is a **search/ranking signal only**. It is distinguished from — and never
  substitutes for — trust, policy, payment, evidence, or reputation decisions.
- Every matrix row carries `discoveryBoundary.scoreMeaning: 'relevance_only_not_trust'` and
  `relevanceInfluencedTrust: false`, and the `high_relevance_blocked_candidate` case proves a
  maximally relevant candidate with a blocking finding is still `blocked`.
- Trust upgrades happen only through RAP-side verification gates; external metadata that
  self-asserts a verified status is routed to `needs_human_review`, never auto-trusted.

## States (the #343 lane vocabulary)

| State | Meaning |
|---|---|
| `listed_untrusted` | Mandatory ingress state: metadata was ingested/listed; no gates have run. Both source kinds always enter here. |
| `claimed` | Gates ran; external trust claims exist but RAP has not verified them. |
| `unverified` | Gates ran; no trust evidence is attached at all (missing-trust-evidence case). |
| `trusted` | An explicit RAP-side verification gate passed with no residual warnings. |
| `failed_verification` | A RAP-side verification gate ran and failed. |
| `blocked` | A fail-closed finding fired (malformed metadata, credential leakage, anonymous write scope, unsupported credential type, unsupported identity assertion). Never registry-eligible. |
| `needs_human_review` | Conflicting signals (e.g. self-asserted verification, or a passing gate with residual warnings) — routed to an operator, never auto-upgraded. |

## Required cases (all fixture-covered, both source kinds)

`malformed_metadata`, `credential_leakage`, `anonymous_write_scope`, `unsupported_credential_type`,
`unsupported_identity_assertion`, `missing_trust_evidence`, `high_relevance_blocked_candidate` —
see `sourceTrustConformanceFixtureCases`. `buildSourceTrustConformanceMatrix()` computes coverage
over states, required cases, and source kinds; `coverage.complete` is asserted true in tests, so a
regression that drops any state/case fails the suite.

## Outputs for #343 and #344

- **#343 registry projection** (`registryProjection`): maps every matrix state onto the existing
  `ProviderTrustVerificationStatus` vocabulary from `provider-trust.ts` (`reddi.provider-trust.v1`),
  carries finding reason codes, marks blocked rows `registryEligible: false`, and includes the
  normalized `ProviderTrustRecord` for valid ARD/AI Catalog rows.
- **#344 diagnostics projection** (`diagnosticsProjection`): messages using the
  `source-diagnostics.ts` lane vocabulary (`capability_match`, `discovery_source`,
  `trust_evidence`, …) and the repo-wide `info`/`warning`/`blocked` severity vocabulary, including
  an explicit `relevance_only_not_trust` capability-match message on every row.

## Explainability requirement (#344, landed)

The #344 source-aware ranking explainability read model consumes this matrix and extends the same
boundary to resolve/ranking output and supervisor diagnostics:

- Every ranked discovery candidate carries a typed `reddi.ranking-explainability.v1` block
  (`packages/agent-protocol/src/ranking-explainability.ts`, exported as
  `@reddi/agent-protocol/ranking-explainability`) with source identity, capability match
  (`relevance_only_not_trust`), trust state, payment policy fit, health/freshness, and per-gate
  rejection reasons. All eight gates — trust, policy, quote, evidence, payment, budget,
  **settlement, attestation** — are structurally present for every source kind; a not-evaluated
  gate never counts as passed, and a 0.99-relevance candidate with any failed gate stays rejected.
- ARD candidate diagnostics (`lib/manager/ard-candidate-diagnostics.ts`,
  `reddi.ard-candidate-diagnostics.v1`) compose this matrix's `diagnosticsProjection`/state with
  the #577 actionability matrix and the #606 attestation/reputation bridge `listingProjection`,
  keeping relevance separate from publisher identity, trust evidence, policy decision,
  budget/payment fit, receipt/evidence history, and reputation state.
- Supervisor diagnostics (`lib/manager/supervisor-run-diagnostics.ts`,
  `reddi.supervisor-run-diagnostics.v1`) explain run linkage, child invocation state, failure
  reasons, and settlement/audit state over the economic-demo fixtures, and surface
  settlement-without-attestation or blocked-with-settlement as reason-coded constraint violations.
- Conformance checks: `cd packages/agent-protocol && npm test -- --test-name-pattern "ranking
  explainability"` and `npx jest lib/__tests__/manager-ard-candidate-diagnostics.test.ts
  lib/__tests__/manager-supervisor-run-diagnostics.test.ts --runInBand`; BDD scenarios `@B3.1`–`@B3.5`
  in `docs/bdd/features/bucket-b-discovery.feature`.

## Vocabulary notes

- Finding codes reuse `provider-trust.ts` reason codes wherever one exists
  (`malformed_trust_metadata`, `credential_leakage_rejected`, `no_trust_metadata`,
  `external_claim_not_verified_by_rap`, `rap_verified`, `rap_verification_failed`); only the
  auth-surface gates #450 names are new codes.
- auth.md registration/credential vocabulary aligns with the auth.md discovery lane
  (`agent-provider` / `email-verification` / `anonymous`; `access_token` / `api_key`).
  Identity-assertion names are DRAFT/illustrative — auth.md is an external format; the contract is
  the fail-closed behavior (unknown assertion ⇒ `blocked`), not the exact allowlist.
- Note on naming: the `source-conformance-matrix` CI lane
  (`scripts/run-source-conformance-matrix.sh`) is a different thing — a per-source-adapter smoke
  matrix (openclaw / hermes / pi / circle-x402 / pay-sh). This document describes the source/**trust**
  conformance matrix, which runs inside the `packages/agent-protocol` test suite.

## Running the conformance check

```bash
cd packages/agent-protocol
npm test -- --test-name-pattern "source/trust conformance matrix"
```
