# Quasar Surfpool And Devnet Promotion Checklist

Issue: [#441](https://github.com/nissan/reddi-agent-protocol/issues/441)

This checklist is the approval boundary for any future Solana or Quasar instruction-builder, program, or deploy-path PR. It does not authorize a deploy. It defines when local Surfpool evidence is required and what must be true before a devnet-funded wallet is used.

Package/read-model work does not need this gate. Examples include Quasar registry compatibility reports, hosted discovery/search read models, receipt/evidence bindings, off-chain reputation previews, documentation, and UI fixtures that do not build instructions, sign, submit, probe RPC, or mutate program state.

## Promotion States

| State | Allowed work | Required evidence | Wallet/RPC/deploy |
| --- | --- | --- | --- |
| `metadata_only` | Docs, package types, read models, fixtures, UI labels | Unit/docs checks for fail-closed behavior | None |
| `instruction_fixture` | Deterministic instruction intent or fixture records | Unit tests proving no signing/RPC/deploy side effects | None |
| `surfpool_required` | Instruction builders, transaction assembly, program-path behavior, local payment/reputation semantics | Local Surfpool summary artifacts and focused tests | Local validator only |
| `devnet_eligible` | Bounded devnet proof after Surfpool passes | Approved runbook, transaction scope, wallet limits, rollback plan | Devnet only after explicit approval |
| `live_blocked` | Mainnet, production wallet mutation, live payment activation, hosted publication with mutable trust/reputation | Out of scope for this checklist | Not allowed |

## Scope Triggers

Run this checklist before any PR that:

- imports or changes Quasar instruction builders
- changes transaction assembly, PDA derivation, account metas, account layout, or program ids
- changes `lib/program.ts`, active network profiles, or deployed program configuration
- adds wallet signing, keypair use, RPC reads/probes, SPL transfer, x402 live retry, or payment settlement
- claims Quasar-backed reputation, attestation, escrow, custody, or live publication
- introduces a deploy script, migration, or devnet/mainnet command path

This checklist is not required for PRs that only:

- validate static metadata
- derive read-only compatibility reports
- update package docs/types without instruction builders
- render disabled UI states or fixture-backed screenshots
- update issue planning, runbooks, or non-live guardrails

## Program Inventory

Current Quasar devnet targets are documented in [`README.md`](../README.md#solana-programs-devnet) and historical validation in [`QUASAR-DEVNET-VALIDATION-RUNBOOK-2026-05-06.md`](./QUASAR-DEVNET-VALIDATION-RUNBOOK-2026-05-06.md).

Any PR that depends on these programs must name which interface is in scope:

- Registry: provider/listing registration and compact `AgentAccount` state
- Escrow: payment/settlement custody paths
- Reputation: score or rating commit/reveal paths
- Attestation: quality attestation, confirm, or dispute paths

If a PR cannot name the interface and account layout it affects, it stays `metadata_only` or `blocked`.

## Required Local Evidence Before Devnet

A devnet proof is not eligible until all applicable local checks pass:

- threat model for any new or changed signing, settlement, custody, reputation, attestation, registry, or publication path
- account-layout, PDA, migration, and backwards-compatibility notes for any program or account change
- reviewer approval that explicitly names the program-changing scope as ready to promote
- focused unit tests for changed instruction/data/account behavior
- `npm run check:rap:naming`
- `git diff --check`
- a relevant Surfpool lane from [`SURFPOOL-ACCEPTANCE-GATE.md`](./SURFPOOL-ACCEPTANCE-GATE.md)
- an artifact path such as `artifacts/surfpool-*/<timestamp>/SUMMARY.md`
- explicit notes for any skipped lane and why it is not in scope

For UI PRs that expose these states, also include mobile/tablet/desktop screenshots and a video or Playwright trace for the changed interaction.

## Devnet Approval Gate

Devnet wallet use requires an issue or PR section named `Devnet Approval Gate` that includes:

- issue number and parent epic
- exact command block to run
- wallet/source of funds to use
- cluster and RPC endpoint
- expected program ids and account addresses
- max spend or fee-only statement
- expected transaction count
- rollback or cleanup plan
- artifact directory for signatures and readbacks
- explicit statement that mainnet and production wallets are out of scope

Do not run devnet commands until the gate is explicitly approved.

## Post-Run Evidence

After an approved devnet run, attach:

- transaction signatures
- account/PDA readbacks
- artifact paths
- command, cwd, and env profile used
- validation reruns after the mutation
- retrospective note under #461 and roadmap update under #340

If the result differs from the plan, stop and update the issue plan before attempting another transaction.

## Fail-Closed Rules

The PR must remain blocked or metadata-only when:

- Surfpool evidence is missing for instruction/program changes
- a program id, account layout, or PDA seed is ambiguous
- the devnet command would exceed the approved transaction/spend scope
- wallet/RPC access is required but the issue does not explicitly request it
- a read-only package or UI fixture starts importing live Solana, wallet, provider, hosted registry, or mutation paths
- a reputation/trust/publication claim is not backed by the required receipt/evidence/attestation and publication gates

## Relationship To Current Roadmap

- #390 completed read-only Quasar registry compatibility and did not require Surfpool/devnet.
- #442 may define hosted attestation-backed reputation claims without on-chain mutation.
- #443 may add fixture-only Quasar-backed intent gates without signing/RPC.
- Any future instruction-builder or deploy slice must pass this checklist before devnet use.
