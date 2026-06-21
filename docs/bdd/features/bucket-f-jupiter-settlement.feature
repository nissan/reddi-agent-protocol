Feature: Bucket F Cross-Token Settlement (Jupiter)
  As a payer using different tokens
  I want automatic swap-aware settlement behavior
  So that specialist payments can still complete safely

  Background:
    Given Jupiter swap support is available in x402 settlement paths

  @F1.1 @F1.2 @F1.3 @F1.4 @route-unit
  Scenario: Auto-swap behavior and swap-required guardrails are enforced
    When payment flow evaluates token mismatch with and without swap client
    Then mismatch detection triggers swap path when enabled
    And swap-required without client fails fast explicitly
    And swap receipt metadata is persisted in payment receipt
    And the behavior is covered by package payment tests

  @F1.5 @F1.6 @route-unit
  Scenario: Jupiter client bootstrap respects API key configuration
    When Jupiter client factory is called with and without API key
    Then null is returned when key is missing
    And singleton client is returned when key is present
    And the behavior is covered by "lib/__tests__/jupiter-client.test.ts"

  @F1.7 @route-unit
  Scenario: Planner invoke wiring passes swap client to execution path
    When planner invoke route executes settlement path
    Then swap client wiring remains connected for cross-token calls
    And the behavior is covered by "lib/__tests__/planner-invoke-route.test.ts"

  @F2.1 @package-contract
  Scenario: MPP Tempo receipt shapes remain fixture-only until a live verifier is approved
    When MPP Tempo challenge and receipt fixtures are normalized
    Then single-charge receipt shapes can become binding candidates
    And session and split shapes remain probe-only without settlement claims
    And live Tempo receipts are rejected until a separate verifier lane is approved
    And the behavior is covered by "packages/agent-protocol/tests/mpp-tempo-receipt-shapes.test.ts"
