Feature: Bucket B Discovery and Capability Index
  As a consumer orchestrator
  I want to discover specialists by capabilities and quality signals
  So that routing can select safe and performant candidates

  Background:
    Given the registry bridge has specialist listings

  @B2.1 @route-unit @registry
  Scenario: Filter specialists by capability tags
    When a client requests GET /api/registry with tag "onboarding"
    Then only listings containing tag "onboarding" are returned
    And the behavior is covered by "lib/__tests__/registry-route.test.ts"

  @B2.2 @route-unit @registry
  Scenario: Filter specialists by attestation and health
    When a client requests GET /api/registry with attested=true and health=pass
    Then only attested and passing listings are returned
    And the behavior is covered by "lib/__tests__/registry-route.test.ts"

  @B2.3 @route-unit @registry
  Scenario: Sort specialists by ranking with deterministic tie-breakers
    When a client requests GET /api/registry with sortBy=ranking
    Then listings are ordered by ranking_score descending
    And ties are broken by most recent health.lastCheckedAt
    And remaining ties are broken by lowest perCallUsd
    And the behavior is covered by "lib/__tests__/registry-route.test.ts"

  @B2.default-order @route-unit @registry
  Scenario: Default bridge ordering stays stable without explicit sortBy
    When a client requests GET /api/registry without sortBy
    Then ordering follows attested first, then health, then feedback
    And the behavior is covered by "lib/__tests__/registry-bridge-sort.test.ts"

  @B3.1 @read-model @explainability
  Scenario: Ranked candidates carry a typed source-aware explainability block
    When resolve/ranking output is enriched for a discovery candidate list
    Then every candidate carries a "reddi.ranking-explainability.v1" block
    And the block includes source identity, capability match, trust state, payment policy fit, health/freshness, and rejection reasons
    And the capability match is labeled "relevance_only_not_trust"
    And the behavior is covered by "packages/agent-protocol/tests/ranking-explainability.test.ts"

  @B3.2 @read-model @explainability @fail-closed
  Scenario: High-relevance candidates still fail closed on trust, policy, quote, payment, or budget gates
    Given a discovery candidate with relevance score 0.99
    When any RAP trust, policy, quote, evidence, payment, or budget gate fails
    Then the candidate is marked rejected with per-gate rejection reasons
    And relevance never reorders, hides, or rescues the candidate
    And the behavior is covered by "packages/agent-protocol/tests/ranking-explainability.test.ts"
    And the behavior is covered by "lib/__tests__/manager-ard-candidate-diagnostics.test.ts"

  @B3.3 @read-model @explainability @ard
  Scenario: ARD candidate diagnostics separate relevance from every decision lane
    When ARD candidate diagnostics are derived for a hosted discovery candidate
    Then relevance, publisher identity, trust evidence, policy decision, budget/payment fit, receipt/evidence history, and reputation state are separate sections
    And the diagnostics compose the discovery actionability matrix, the source/trust conformance projections, and the attestation/reputation bridge listing projection
    And the behavior is covered by "lib/__tests__/manager-ard-candidate-diagnostics.test.ts"

  @B3.4 @read-model @explainability @supervisor
  Scenario: Supervisor diagnostics explain run linkage, child state, failure reason, and settlement/audit state
    When supervisor run diagnostics are derived from the economic-demo fixtures
    Then each run links the supervisor, scenario, mode, and receipt refs
    And each child invocation reports its state, failure reason when blocked, and settlement/attestation coverage
    And the behavior is covered by "lib/__tests__/manager-supervisor-run-diagnostics.test.ts"

  @B3.5 @read-model @explainability @fail-closed @structural
  Scenario: No source can silently bypass settlement or attestation constraints
    When explainability is derived for a candidate of any discovery source kind
    Then the settlement and attestation gates are always present and never default to passed
    And a settled child invocation without attestation coverage is surfaced as a constraint violation
    And a blocked child invocation with settlement receipts is surfaced as a constraint violation
    And the behavior is covered by "packages/agent-protocol/tests/ranking-explainability.test.ts"
    And the behavior is covered by "lib/__tests__/manager-supervisor-run-diagnostics.test.ts"
