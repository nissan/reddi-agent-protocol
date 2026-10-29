# Mainnet production readiness assessment

Originally assessed 2026-08-28; refreshed against `main` source commit
`17b99352c5827ba7a1116eca74248afb87bf1d0c` (2026-10-24).
This replaces the source assessment proposed in
https://github.com/nissan/reddi-agent-protocol/pull/646, not its Git history.

**Verdict: NOT READY.** The repository does not establish an approved production
contract, completed external audit, or registered mainnet deployment. This is a
bounded source/document review, not exploit reproduction or deployment evidence.

## Authority and claim boundaries

[The Quasar freeze](QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md) names stable
Anchor `1.1.2` in `programs/escrow/` as the authoritative source/reference regression
baseline. That does not select a deployment or establish product-contract acceptance,
audit status, production suitability, or mainnet readiness. Anchor v2 remains a
default-off alpha pilot. Quasar is frozen historical experimental evidence, retired
from product, deployment, submission, audit-readiness, and mainnet critical paths.
Its retained source, automatic regression workflows and loopback-only lane are not
adoption or permission to redeploy. The freeze's dated benchmark qualification does
not isolate a framework-version benefit.

[SECURITY.md](../SECURITY.md) and the
[public claim boundary](PUBLIC-CLAIM-BOUNDARY.md) control current claims. RAP Assurance
records paid-work evidence; payment proof alone does not prove work quality or
settlement finality. AUDD/USDC proof and payment-plan metadata are not program custody.
No completed external audit is claimed. Recorded devnet addresses are history, not
proof that deployed binaries match this source. No live-chain verification was done.

## 1. Anchor reputation findings requiring security review

The earlier assessment's core source concerns remain, but its stronger game-theory,
exploit and deployment conclusions are not established by source inspection alone.
All instruction paths below are relative to `programs/escrow/src/instructions/`.

### 1.1 No timeout exit from `BothCommitted`

The inspected Anchor rating state machine has no timeout resolution after both
commitments are recorded. A participant can therefore prevent rating finalization,
and the available expiry path does not cover that state. This is an availability and
reputation-integrity concern, not proof that all negative ratings are unrecordable or
that the behavior has been exploited in a deployment. Historical Quasar CRITICAL-4
material is context, not proof of identical behavior or an approved Anchor remedy.

### 1.2 Rating identity and expiry authorization are not job-bound

The inspected Anchor rating initialization accepts caller-supplied parties without a
verified completed-job account, while expiry authorization is not limited to a
recorded party. The committing signer is checked against its recorded role, and the
agent accounts used by expiry are constrained to the stored parties, but those checks
do not establish that the rating represents a real completed job. This boundary may
permit unauthorized reputation penalties and repeated integrity harm; no exploitation,
deployed exposure, or quantitative impact is asserted here.

These findings require independent security triage, behavioral regression coverage,
and an explicitly approved remediation before readiness can be reconsidered. Detailed
reproduction guidance belongs only in the private coordinated disclosure process in
[SECURITY.md](../SECURITY.md), not this public assessment. Frozen Quasar job-binding
code can inform comparison but is not an approved specification to port wholesale.
The historical audit packs inventory the Anchor rating instructions without resolving
these specific concerns.

## 2. Audit packet is historical, not ready for dispatch

The [readiness pack](SOLANA-CONTRACT-AUDIT-READINESS-2026-06-24.md),
[appendix](SOLANA-CONTRACT-AUDIT-APPENDIX-2026-06-24.md), and
[handoff](SOLANA-EXTERNAL-AUDIT-HANDOFF-2026-06-24.md) retain Quasar-era target language.
Their reconciliation notes identify `experiments/quasar-escrow` for historical
job binding and warn that the packet needs reconciliation. The handoff's source
freeze still refers to a merge commit to be recorded rather than a final exact SHA.

Crucially, current `SECURITY.md` already explicitly labels that packet historical,
not current, and not a pending Quasar auditor-engagement plan. The previous
assessment's suggestion of an active misdirected handoff must not override this
boundary. Future Anchor audit preparation requires separately approved scope,
exact source and binary provenance, current account/PDA/ABI inventory, known
findings and evidence. Merely replacing a target name cannot make this packet ready.
Quasar reconsideration requires its separate unfreeze decision; none is proposed here.

## 3. Earlier gates, reconciled

| Concern | Current evidence-qualified status |
|---|---|
| G-1 / reveal durability | Anchor source concern remains as described in §1.1; historical Quasar CRITICAL-4 remains unresolved, not an active promotion task. |
| G-2 / audit target | Historical packet remains unsuitable for external dispatch; current SECURITY already disclaims its currency. A new approved scope is needed, not automatic Quasar reactivation. |
| G-3 / trust-boundary wording | SECURITY explicitly distinguishes recorded Quasar addresses from Anchor constraints and source-only job binding from older binaries. This wording correction is not security closure. |
| G-4 / mainnet placeholder | `config/networks/mainnet.json` labels the legacy Anchor ID a placeholder and records `not_deployed`. `lib/config/network.ts` reports `submissionReady: false`, `mainnet-not-deployed`, and `external_audit_and_mainnet_deployment_required`; Quasar mainnet requests are refused. The legacy target still resolves an ID. This is disclosed blocked configuration, not a usable deployment or proof every possible caller enforces the gate. |
| Anchor job binding / expiry caller | Source concerns in §1.2 remain for independent review; no deployed exploit claim. |

## 4. Product and operational gaps, without prescribing architecture

- **SOL custody, not SPL custody.** `lock_escrow.rs` transfers lamports;
  `release_escrow.rs` and `cancel_escrow.rs` move lamports. `state.rs` records
  lamport amounts/rates. Economic-demo USDC fixtures are a separate model, not
  evidence of a USDC escrow implementation. Whether SPL custody belongs in any
  future contract is a product/security decision, not a prerequisite imposed here.
- **No implemented treasury take-rate.** `release_escrow.rs` transfers the full
  escrow amount to the payee without a treasury split. The planned 0.05% / 5 bps
  figure is fixture/product semantics only. `AGENT_REGISTRATION_FEE` is a 0.01 SOL
  registration burn, not treasury revenue. This assessment does not decide whether
  future fees should be on-chain or whether a launch must collect revenue.
- **Custody and operations remain unresolved.** SECURITY explicitly lists upgrade
  authority ownership, multisig/immutability policy, compromise procedure, paid
  mainnet RPC/fallback, on-chain monitoring, incident response, safe-harbour/bounty
  terms and historical Jupiter key rotation as outstanding. The onboarding operator
  key-rotation runbook concerns an application secret, not program authority.
  `DEPLOY.md` is historical/reference guidance and authorizes no deployment.
  Repository documentation cannot prove external infrastructure is absent or a
  human has not rotated a key; this review establishes no completed evidence of
  those gates, not an independent operational inventory.

The earlier waitlist count is omitted: a dated backup is not a current count or a
contract-readiness gate. No credentials, wallet files or live services were inspected.

## 5. Decision and review sequence

1. Independently triage the Anchor findings against an explicitly selected future
   product contract; decide required semantics and acceptance criteria. Do not assume
   frozen Quasar behavior is the target.
2. If implementation is separately approved, validate behavioral fixes and any
   custody/fee/layout decisions before freezing the code intended for audit. Later
   changes require appropriate re-review; no SPL or fee implementation is authorized.
3. Prepare a newly scoped, exact-commit audit packet and obtain approval for auditor
   selection, spend and external handoff. This document supplies none of those approvals.
4. Establish documented custody and operational evidence before any separately
   authorized deployment/mainnet consideration. An audit alone does not close them.

Two independent GO reviews of the same exact successor commit remain a merge
prerequisite. Pipeline self-review is not either independent approval. This document
and its successor branch confer no merge, deployment, signing, simulation, funding,
RPC, upgrade-authority, external-submission or mainnet activation authority.

## Verification basis and provenance

The source basis above is current `main` at the full SHA in the opening paragraph.
The original proposal was read in full at commit
`015b15f9ae92c6b5339947e073f4fe482bfab715` in
https://github.com/nissan/reddi-agent-protocol/pull/646. Its commit attribution includes
an agent co-author; carrying or amending that commit would not meet the delivery
constraint. This successor is authored anew from main without that trailer. The old
branch/commit history remains intact; this document does not retroactively alter it.

Validation for this docs-only refresh is offline/static: `git diff --check`, public
claim-boundary checks, and audit appendix/handoff guards. A passing guard establishes
its documented text/inventory contract only, not security correctness or audit readiness.
No transaction, simulation, validator, deployment, signer, funding or RPC command was
run for this assessment.
