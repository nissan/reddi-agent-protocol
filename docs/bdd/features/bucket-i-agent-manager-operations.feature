Feature: Bucket I Agent Manager Operations
  As an agent manager human
  I want one operational view for specialists, attestors, consumers, and system readiness
  So that I can help each role register, recover, and prove the marketplace is usable

  Background:
    Given role setup and marketplace status APIs are available

  @I1.1 @manager @e2e-ui
  Scenario: Role launchpad routes humans to the correct setup path
    When an agent manager opens the marketplace operations surface
    Then Specialist, Attestor, Consumer, and Manager paths are clearly available
    And each path links to the current best setup or dashboard surface

  @I1.2 @I1.5 @manager @route-unit
  Scenario: Manager readiness board summarizes role health and next blocking action
    When the manager readiness summary is calculated
    Then it includes live specialists, available attestors, registered consumers, insecure endpoints, pending attestations, and failed healthchecks
    And any unusable role has a concrete next action

  @I1.3 @manager @route-unit
  Scenario: Manager can inspect the latest BDD confidence status
    When the manager asks for protocol confidence
    Then the latest BDD sweep/status command and artifact path are visible
    And missing or stale evidence is called out explicitly
    And the behavior is covered by "lib/__tests__/manager-evidence-pack.test.ts"

  @I1.4 @manager @route-unit
  Scenario: Manager can produce a judge-safe evidence pack
    When the manager generates an evidence summary
    Then role-critical artifacts are listed without raw prompts, secrets, or private runtime logs
    And the evidence links cover specialist onboarding, attestor-gated settlement, consumer paid invocation, and Solana settlement
    And the behavior is covered by:
      | lib/__tests__/manager-evidence-pack.test.ts |
      | lib/__tests__/manager-evidence-route.test.ts |

  @I1.5 @manager @e2e-ui
  Scenario: Manager sees the next concrete fix before demo
    Given one or more role-critical checks are failing
    When the manager views readiness
    Then the highest priority blocker is surfaced with exact recovery guidance

  @I1.6 @manager @docs
  Scenario: Hosted marketplace readiness keeps live actions approval-gated
    When an operator follows the hosted marketplace operations readiness runbook
    Then local, dry-run, devnet, live-gated, hosted, self-hosted, and externally listed states are separated
    And live publication, payment activation, wallet or RPC use, provider calls, catalog submissions, hosted registry writes, trust upgrades, and reputation mutations require explicit approval
    And Pay.sh catalog-only, spec-preview, sandbox-untested, dry-run-ready, and live-payment-disabled support states are documented without implying live activation
