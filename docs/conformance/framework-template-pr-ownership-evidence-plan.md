# Framework Template PR Ownership And Evidence Plan

Issue: #554

This plan is the dispatch gate for the first parallel framework-template tranche. It applies after #552 shared contract fixtures and #553 no-live conformance checker are merged, and before #544 LangGraph, #546 ADK, and #545 Strands implementation work starts.

## Upstream Contract Surfaces

Shared contract and conformance surfaces are owned by the #543/#552/#553 lane only:

- `packages/agent-protocol/src/framework-template-contract.ts`
- `packages/agent-protocol/src/framework-template-conformance.ts`
- `packages/agent-protocol/tests/framework-template-contract.test.ts`
- `packages/agent-protocol/tests/framework-template-conformance.test.ts`
- `packages/agent-protocol/dist/framework-template-contract.*`
- `packages/agent-protocol/dist/framework-template-conformance.*`
- package root exports and subpath exports for these two modules

Downstream framework PRs must consume these modules. They must not redefine buyer-authority, seller-wrapper, receipt/evidence, failure/refund, support-state, no-live, custody, or settlement-finality semantics.

## Parallel Worktree Ownership

Use one branch and one worktree per framework template:

- #544 LangGraph: `feat/544-langgraph-rap-template`
  - Suggested worktree: `/Users/loki/projects/reddi-agent-protocol-worktree-544-langgraph-template`
  - Owns LangGraph-specific template docs, examples, fixtures, tests, and generated dist for files it adds.
  - Must not edit Strands, ADK, #552 contract, or #553 conformance source except for additive package exports needed by its own module.

- #546 ADK: `feat/546-adk-a2a-rap-template`
  - Suggested worktree: `/Users/loki/projects/reddi-agent-protocol-worktree-546-adk-template`
  - Owns ADK/A2A Agent Card template docs, examples, fixtures, tests, and generated dist for files it adds.
  - Must not edit LangGraph, Strands, #552 contract, or #553 conformance source except for additive package exports needed by its own module.

- #545 Strands: `feat/545-strands-rap-template`
  - Suggested worktree: `/Users/loki/projects/reddi-agent-protocol-worktree-545-strands-template`
  - Owns Strands tool/plugin template docs, examples, fixtures, tests, and generated dist for files it adds.
  - Must not edit LangGraph, ADK, #552 contract, or #553 conformance source except for additive package exports needed by its own module.

If a framework PR discovers a necessary shared-contract or conformance change, stop that PR and open a separate #543/#552/#553 follow-up issue before changing shared files.

## Expected Directory Boundaries

Framework-specific files should use separate paths so PRs can run in parallel with low conflict risk:

- LangGraph: names containing `langgraph` under package source/tests/examples/docs.
- ADK: names containing `adk` or `a2a` under package source/tests/examples/docs.
- Strands: names containing `strands` under package source/tests/examples/docs.
- Shared comparison docs: #547 owns cross-framework matrix docs after #544/#545/#546 have concrete outputs.

Package `src/index.ts`, `dist/index.*`, and `package.json` exports are shared merge hot spots. Framework PRs may make additive export changes, but if multiple PRs touch them in parallel, rebase on main after each merge and preserve previous exports.

## Validation Gates

Every framework-template PR must run:

```bash
npm --prefix packages/agent-protocol test -- --runInBand
npm run check:rap:naming
npm run test:bdd:index
git diff --check
```

Every framework-template PR must also prove that the #553 checker passes:

```typescript
import { runFrameworkTemplateNoLiveConformanceCheck } from '@reddi/agent-protocol/framework-template-conformance';

const check = runFrameworkTemplateNoLiveConformanceCheck();
if (!check.valid) throw new Error(check.reasonCodes.join(','));
```

Framework-specific tests should include at least:

- discovery fixture consumption
- quote/preflight fixture consumption
- operator approval fixture consumption where relevant
- invocation fixture consumption without real framework/cloud execution
- receipt/evidence fixture consumption
- denial fixture consumption with machine-readable reason codes
- failure/refund fixture consumption
- rejection of credentials, wallet/RPC/provider URLs, live-payment approval, custody claims, transfer instructions, and settlement-finality claims
- rejection of spoofed lifecycle/profile labels if the PR adds any custom conformance cases

## UI Evidence Rule

No screenshots or video are required for pure package, fixture, checker, or docs-text work.

If a PR changes any visual route, docs-rendered product surface, onboarding screen, generated preview, or demo UI, commit evidence under:

```text
docs/evidence/<issue>/
```

Required UI evidence for visual changes:

- mobile screenshot
- tablet screenshot
- desktop screenshot
- short video or Playwright trace
- README or manifest describing what changed and what each artifact shows

## Review And Merge Sequencing

Recommended order:

1. #554 completes and refreshes #543/#542.
2. Start #544 LangGraph and #546 ADK in parallel first.
3. Start #545 Strands in parallel if capacity is available, or immediately after one of #544/#546 stabilizes.
4. After each framework PR merges, run a post-merge plan refresh on #543, #542, and #547.
5. Rebase remaining framework PRs on fresh main before review if shared export files changed.
6. Start #547 only after the framework PR outputs exist or their public contract surfaces are stable.

PRs may be approved and merged when:

- local validation is green
- Vercel/GitHub checks are green
- read-only review has no blockers or blockers are fixed and re-reviewed
- the PR is marked ready-to-approve
- UI evidence is present when visual surfaces changed

## Post-Merge Refresh

After each #544/#545/#546 PR merge, post a refresh on the child issue and #543 with:

- PR URL and merge commit
- files and package surfaces added
- validation commands and results
- #553 conformance result
- boundary confirmation
- UI evidence status
- whether #547 can proceed
- any issue edits/additions/closures needed

## Tranche Retrospective

After #544/#545/#546 are merged or intentionally paused, complete a tranche retrospective before #547 closeout:

- What parallelization worked?
- Which shared files caused conflicts?
- Did #552/#553 need hardening?
- Did the no-live/no-custody/no-finality boundary hold?
- Were screenshots/video needed and sufficient?
- Should any follow-up issues be added, edited, or closed?

## Boundaries

This plan authorizes planning, local package fixtures, static tests, and docs only. It does not authorize:

- LangGraph, Strands, or ADK package installation or scaffolding in this ownership plan. Any future package-install or scaffold need requires a separate explicit issue/PR approval before it happens.
- cloud/API calls
- hosted registry writes
- package publication
- wallet/RPC/provider calls
- live or devnet payment execution
- custody
- SPL transfers
- settlement-finality claims
