Feature: Bucket M - Quasar-native MagicBlock PER escrow
  The hackathon MagicBlock PER proof must use a separate Quasar-native PER escrow
  program while preserving the reusable Quasar escrow program for future privacy rails.

  Background:
    Given the reusable Quasar escrow program already exists with a single-byte ABI
    And MagicBlock undelegation callbacks require the exact 8-byte discriminator [196, 28, 41, 206, 48, 37, 51, 167]

  Scenario: Preserve the reusable Quasar escrow rail
    When the MagicBlock PER build starts
    Then the existing experiments/quasar-escrow program remains the reusable non-PER escrow rail
    And the PER-specific implementation is built in a separate Quasar program path
    And future privacy rails can still evaluate the reusable escrow ABI independently

  Scenario: PER escrow uses an 8-byte discriminator policy
    Given the PER-specific Quasar escrow program is created
    Then every exported PER instruction uses an 8-byte discriminator
    And the undelegate callback discriminator is exactly [196, 28, 41, 206, 48, 37, 51, 167]
    And the build fails if single-byte PER discriminators are introduced

  Scenario: MagicBlock PER final path forbids Anchor fallback
    Given a MagicBlock PER demo or evidence packet is generated
    Then it cites Quasar-native PER program IDs and devnet evidence
    And it does not claim success from Anchor-compiled Solana programs
    And Anchor MagicBlock macros are allowed only as reference fixtures, not final runtime code

  Scenario: Every PER build phase retrospectives before proceeding
    Given a phase in the PER build completes
    Then the phase records expected versus observed behavior
    And validation evidence is captured before moving on
    And the next phase plan is refined from the retrospective

  Scenario: Package read models stay outside the Quasar program boundary
    Given a package or read-model lane claims metadata-only Quasar scope
    Then the Quasar boundary guard forbids instruction builders, wallet signing, RPC probes, Surfpool/devnet calls, deploy commands, PDA/account-layout mutations, and Quasar state mutation
    And a forbidden surface requires an explicit program-boundary handoff before using the Surfpool/devnet promotion checklist
