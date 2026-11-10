# RAP devnet beta plan

Proposed planning-contract adoption, assessed 2026-11-10 against RAP base
`17b99352c5827ba7a1116eca74248afb87bf1d0c`. This document implements only the
planning slice of the RAP Reset Kickoff Brief. It authorizes no beta release,
signing, publication, grant claim, or external communication.

Payments prove transfer; RAP Assurance proves paid work.

## Source comparison and adoption

Sources were inspected read-only through `gh-axi`, without cloning. The refs below
were the repositories' `main` heads at inspection, not selected by document date.

| Source | Verified contract | RAP adaptation |
| --- | --- | --- |
| [nissan/reddi-ecosystem@420ac0900996f6ec0f842fa1c8e1dc55ee52a771](https://github.com/nissan/reddi-ecosystem/tree/420ac0900996f6ec0f842fa1c8e1dc55ee52a771) | `GOVERNANCE.md`; `planning/graph.yaml` schema 2; `tools/graph_lint.py`; `tools/project_issues.py`; `planning/issues/README.md`; `prompts/README.md`, `graph-planner.md`, `issue-writer.md`, `node-executor.md`, `grant-auditor.md` | Adopt explicit outcomes, owners, acceptance/evidence, typed dependencies and human gates. Cross-repository planning leaves component implementation authoritative. Prompts confer no authority. |
| [nissan/reddi-workbench@e0c833e047391bb9916ab70f9fdb4f0afb055e49](https://github.com/nissan/reddi-workbench/tree/e0c833e047391bb9916ab70f9fdb4f0afb055e49) | `planning/graph.json` schema 1; `scripts/plan.py`; `docs/delivery/outcome-development/{README,ADOPTION,SESSION-PROMPTS}.md` | Adopt observable acceptance, exact-build evidence, reconciliation with existing issues, and separation of implementation, demonstration and approval. Adapt to RAP rather than copying the generic kit. |

GitHub's repository API resolved `nissan/reddi-desktop` to canonical
`nissan/reddi-workbench`, with the same default branch and current head. Workbench's
graph still contains `sourceRepositoryPendingRename: nissan/reddi-desktop`; that
stale field does not establish a separate current repository. Its adoption mapping
also describes an older inspected base and a richer open-branch graph. Neither is
treated as the current `main` contract.

The checkers are not interchangeable: ecosystem lint requires portfolio registries,
specific ECO nodes and rail sequencing; its issue generator checks deterministic
projections. Workbench's stdlib checker validates IDs/dependencies/cycles and compares
Markdown mirrors to its own JSON graph. Neither validates this RAP Markdown plan.
No checker, graph registry, generated issue tree, prompt pack, outcome kit, fleet,
agent identity, CI rule, review-policy replacement, or project memory is imported.

## Ownership and dependency rules

This is a bounded beta sequencing view. Existing RAP code, accepted decisions,
[public claim boundary](../PUBLIC-CLAIM-BOUNDARY.md),
[contributor process](../../CONTRIBUTING.md), and linked implementation issues retain
their authority. M0–M4 below are local beta labels, not ecosystem milestone IDs or
AUDD grant release criteria. No new issue hierarchy or runtime control plane is created.

Use **HT** for a hard technical prerequisite, **EV** for required evidence, **EX**
for an existing implementation issue, **AP** for human approval, and **RS** for
recommended order only. Only HT/EV block technical acceptance; AP independently
blocks its protected action. Unresolved grant terms do not block authorized offline
engineering. Existing issue status must be checked before scheduling work.

Each implementation PR should identify its node, bounded file footprint, owner role,
acceptance, non-goals, source SHA, commands/results, evidence destination, unresolved
risks and exact next action. Reuse or link the owning RAP issue before creating work;
serialize overlapping footprints. Update this view when scope or dependencies change,
and reconcile through the existing [roadmap review](https://github.com/nissan/reddi-agent-protocol/issues/340).
An issue, plan entry or passing fixture is not completion evidence or approval.

## Beta outcomes

### M0 — Grant truth

- **Status / owner:** partial, unapproved / maintainer and grant-evidence owner.
- **Scope:** reconcile available governing text and amendments into a
  promise/evidence/gap/owner/status table. No grant acceptance is asserted here.
- **Dependencies:** none for evidence recovery; AP grantor communication and any
  representation of approval, eligibility or milestone satisfaction.
- **Acceptance / evidence:** each commitment cites its governing source/version,
  acceptance authority, due date, eligible measure/exclusions and reproducible
  evidence, or explicitly says unknown. Distinguish devnet, fixtures, owned activity
  and externally eligible outcomes. Obtain maintainer review of the remaining gaps.
- **Unknowns:** complete governing terms/amendments, grant identity and applicable
  commitment mapping, acceptance authority, deadlines, eligibility/deduplication
  rules, and whether current evidence qualifies remain unverified by this plan.
  The existing [AUDD grant program issue](https://github.com/nissan/reddi-agent-protocol/issues/615)
  is a reconciliation reference, not proof that these beta labels satisfy its terms.

### M1 — SPL escrow

- **Status / owner:** in validation / Solana implementation and validation owner.
- **Scope:** validate the intended SPL escrow beta path against maintained stable
  Anchor 1.1.2 source in `programs/escrow/` and client mirrors in `lib/program.ts`.
- **Dependencies:** no M0 completion prerequisite for offline validation; AP before
  any devnet signing. RS: validate this path before coupling a payment example to it.
- **Acceptance / evidence:** pin source, IDL/client compatibility, network/program
  identity and environment; show intended lock/release/refund behavior and rejection
  of unauthorized actors, wrong mint/accounts and replay, with commands and results.
  Separate local runtime evidence from any separately approved devnet observations.
- **Boundary:** this status is a validation target, not a deployed escrow claim.
  Follow the [toolchain baseline](../SOLANA-TOOLCHAIN-BASELINE.md) and
  [network profiles](../NETWORK-PROFILES.md). Quasar remains
  [frozen historical experimentation](../QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md);
  it is not the beta deployment target. No deployment or upgrade-authority change.

### M2 — x402 package and seller/buyer example

- **Status / owner:** planned beta validation / package and example owner.
- **Scope:** use `packages/x402-solana` and `packages/agent-protocol` for one
  reproducible seller challenge, buyer policy decision, proof handling and retry.
- **Dependencies:** HT/EV M1 only for an example claiming that escrow path; an
  explicitly no-spend fixture can proceed independently. EX
  [reference workflow](https://github.com/nissan/reddi-agent-protocol/issues/564) and
  [publication execution](https://github.com/nissan/reddi-agent-protocol/issues/603).
- **Acceptance / evidence:** clean consumer installation/build, package tests and
  pack dry-run; a bounded seller/buyer example showing success plus missing/invalid
  proof and policy refusal. Record exact versions, SHA, commands and lane labels.
  Use the existing [release checklist](../RAP-V0.1-RELEASE-CHECKLIST.md).
- **Gates:** AP npm publish and GitHub release separately; AP devnet signing for
  fresh transaction evidence. A dry-run pass does not mean published or settled.

### M3 — ElizaOS plugin, SendAI guide and truthful README

- **Status / owner:** planned, adapters deferred / integration and documentation owner.
- **Scope:** a bounded ElizaOS plugin validation slice, SendAI integration guide,
  and README describing what a developer can actually reproduce.
- **Dependencies:** HT M2's tested package interface; EV clean host-framework fixture
  evidence for each support claim. Inspect existing adapters before opening work.
- **Acceptance / evidence:** document install/use and experimental limitations;
  prove plugin loading/action registration and SendAI invocation in isolated mocked
  consumer fixtures, including refusal/failure paths. Label mock escrow outputs and
  identify unresolved live/runtime coverage. README links runnable examples and evidence.
- **Boundary:** the [adapter retention decision](../X402-ADAPTER-RETENTION-DECISION-2026-06-24.md)
  keeps both adapters experimental/private and outside the supported v0.1 set;
  package READMEs are absent at this base. This plan does not promote or publish them.
  Public inclusion requires a separate reviewed promotion and AP publication gate.

### M4 — Evidence and feedback path

- **Status / owner:** planned / evidence and beta-feedback owner.
- **Scope:** assemble a reproducible beta handoff and one issue-based feedback path.
- **Dependencies:** EV M1–M3 results or explicitly recorded gaps; EV M0 reconciliation
  before any grant claim. This join cannot mark a missing prerequisite complete.
- **Acceptance / evidence:** index exact commits, package versions, lane/environment,
  commands, results and redacted artifacts; distinguish fixture, local and approved
  devnet observations. Include reproducible setup, known limitations and a feedback
  issue template/body containing version, reproduction, expected/actual result and
  sanitized evidence. Triage reports into existing RAP issues and record KEEP/REVERT/HOLD
  after the beta cycle. No participation, traction or grant acceptance is fabricated.
- **Gates:** AP public release/announcement and grantor communication. Evidence preparation
  may proceed offline; external commitments remain pending explicit owner approval.

## Protected actions and completion

| Human gate | Required decision before action |
| --- | --- |
| npm publish | Operator approves exact package/version set and candidate commit under the existing release checklist and publication issue. |
| GitHub release/tag publication | Operator approves exact tag/commit, release notes and claims; npm approval alone does not authorize it. |
| Devnet signing | Operator approves network/programs, signer and instruction allowlist, recipients/mints, per-action and aggregate amount/fee caps, expiry and stop conditions. Follow the [browser-wallet preflight](../BROWSER-WALLET-SAFETY-PREFLIGHT.md) where applicable. Missing values mean no signing. |
| Grantor communication | Maintainer approves governing-text interpretation, recipient, exact message and evidence/unknowns before any submission, milestone claim or outreach. |

These are planning requirements, not newly implemented enforcement. All protected
actions are unapproved by this document. No wallet inspection/funding, faucet,
transaction simulation/submission, deployment, mainnet activation or external contact
is authorized by adoption. AUDD remains payment-plan/proof metadata; the planned 0.05%
fee is fixture/product economics, not implemented treasury collection.

This planning-only change is complete when source comparison, M0–M4 boundaries and
human gates are reviewable, `git diff --check`, `npm run check:claims:public` and
`npm run check:rap:naming` pass, and the isolated PR is ready for review. Beta completion
requires the outcome evidence and separate human decisions above; adopting a plan
does not deliver those outcomes.
