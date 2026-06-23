# Hosted Marketplace Operations Readiness Runbook

Issue: [#447](https://github.com/nissan/reddi-agent-protocol/issues/447)

This runbook is the operator checklist for moving a reviewed RAP marketplace candidate from static evidence toward a hosted marketplace surface. It documents readiness states and approval gates only. It does not authorize live publication, payment activation, wallet/RPC use, hosted registry writes, provider calls, catalog submissions, trust upgrades, or reputation mutation.

## Scope

Hosted services are an optional operations layer over open source RAP. A local or self-hosted RAP deployment can still use the same evidence contracts, review states, and dry-run export shapes without depending on a Reddi-hosted registry.

This runbook applies after static ingestion and operator review have produced a candidate from sources such as:

- Static agent-stack fixtures and reviews: [`docs/conformance/static-agent-stack/README.md`](conformance/static-agent-stack/README.md)
- Manager discovery workspace: `/manager/discovery`
- Manager listings and publication evidence preview: `/manager/listings`
- Marketplace readiness, eligibility, public export, and dry-run activation helpers under `lib/manager/`
- Pay.sh catalog/spec-preview helpers under `lib/integrations/source-adapter/`

Related roadmap owners:

- [#395](https://github.com/nissan/reddi-agent-protocol/issues/395) owns marketplace publication/export readiness.
- [#417](https://github.com/nissan/reddi-agent-protocol/issues/417), [#349](https://github.com/nissan/reddi-agent-protocol/issues/349), and [#386](https://github.com/nissan/reddi-agent-protocol/issues/386) are UI/demo proof surfaces that can consume this runbook's states without bypassing approval gates.
- [#476](https://github.com/nissan/reddi-agent-protocol/issues/476) owns live Pay.sh activation gates and spend policy. See [`docs/PAY-SH-LIVE-ACTIVATION-GATES-AND-SPEND-POLICY.md`](PAY-SH-LIVE-ACTIVATION-GATES-AND-SPEND-POLICY.md).

## State Model

Use these states in operator notes, issue comments, and support responses. Do not collapse them into a single "published" or "ready" label.

| State | Meaning | Allowed actions | Explicitly blocked |
| --- | --- | --- | --- |
| Local | Developer or operator runs RAP on a workstation or private environment. | Static checks, fixture tests, local docs validation, local UI evidence. | Hosted registry writes, live buyer traffic, production payment activation. |
| Dry-run | RAP computes readiness, public export snapshots, and activation decisions without side effects. | Generate evidence refs, inspect manager UI, create dry-run activation records. | Live publication, wallet signing, RPC probes, provider/MCP calls, payment execution. |
| Devnet | Approved Solana devnet or Surfpool evidence lane for a specific test. | Run the exact approved devnet command with funded-test-wallet and spend limits recorded. | Mainnet, production credentials, unbounded RPC, hidden top-ups, buyer-facing trust claims. |
| Live-gated | A future live action is proposed but not approved. | Write plan, list approvals, gather non-live evidence, attach risk review. | Any live mutation until the required approval record exists. |
| Hosted | Reddi-operated registry/export/monitoring path for reviewed candidates. | Publish dry-run snapshots and operational status after gates pass. | Making hosted services mandatory for OSS users; writing live registry state without approval. |
| Self-hosted | An operator runs RAP infrastructure outside Reddi hosting. | Reuse schemas, checks, and evidence refs; document operator-owned endpoints. | Claiming Reddi operational monitoring or hosted SLA. |
| Externally listed | Candidate came from an external catalog such as Pay.sh or Circle x402. | Preserve source URL/hash, diagnostics, and support states. | Treating external catalog metadata as RAP attestation, trust, reputation, or payment proof. |

## Preflight Checklist

Before representing a listing as hosted-marketplace ready, confirm every item below has an evidence reference or a blocker note.

1. Source proof
   - Source URL, fixture key, checked commit or source hash, and retrieval context are recorded.
   - Imported metadata is labelled external, static-only, and untrusted until reviewed.
   - License, provenance, and source authenticity questions have an operator disposition.

2. Static readiness proof
   - Static inventory, connector diagnostics, risk taxonomy, draft payload, and operator review payload are present when relevant.
   - Blocking diagnostics are either resolved or intentionally keep the candidate unpublished.
   - Unsafe metadata, malformed connectors, missing endpoints, and missing payment setup remain blockers.

3. Payment setup proof
   - Payment plan metadata exists only as policy/evidence shape until an approved live lane exists.
   - Dry-run receipt evidence is attached where required by the publication gate.
   - Payment proof does not imply settlement, custody, trust, or reputation beyond the supported evidence contract.

4. Operator approval proof
   - Approval includes approved flag, actor, timestamp, operator approval evidence ref, and current listing reference.
   - Approval is scoped to dry-run export unless a separate live approval explicitly says otherwise.
   - Rejected, suspended, unpublished, or needs-changes states override older approval evidence.

5. Publication audit proof
   - Latest lifecycle audit is current and matches the listing, readiness proof, operator approval ref, and evidence refs.
   - Publish/restore can support a dry-run export. Unpublish/suspend blocks export and activation.
   - Audit history is append-only from an operator perspective; do not hide older rejected or suspended states.

6. Hosted attestation and Quasar boundary
   - Hosted attestation claim guardrails show no reputation mutation, Quasar instruction, wallet signing, RPC call, hosted registry write, marketplace publication, live payment, or provider call.
   - Quasar compatibility is metadata-only or not required unless a separate Quasar issue approves instruction-building work.
   - Buyer-facing trust and reputation claims remain disabled until explicit attestation/reputation work permits them.

7. Monitoring and incident path
   - The operator knows where readiness evidence, UI evidence, build/check output, and issue/PR links live.
   - Rollback, unpublish, suspend, and incident notes are linked from the current issue or PR.
   - Support state is clear enough for an operator to explain why a listing is blocked.

## Approval Gates

The following actions require explicit approval in the active issue or a linked approval artifact before execution:

- Live publication or hosted registry write.
- Payment activation, paid request, `auto_pay`, spend-cap change, or buyer-facing paid endpoint.
- Wallet setup, wallet top-up, wallet signing, signer import, custody operation, or RPC/Solana call.
- Provider call, MCP tool invocation, live endpoint probe, or catalog submission/PR.
- Pay.sh setup, Pay.sh CLI/server run, Pay.sh catalog PR/submission, Pay.sh sandbox payment test, or live Pay.sh activation.
- Trust upgrade, reputation assignment/mutation, buyer-facing attestation claim, or Quasar instruction building.
- Mainnet action, production credential use, external service signup, or deployment that changes public availability.

Approval must name the action, actor, environment, spend cap if any, evidence refs, rollback/suspend plan, and the exact command or UI action allowed.

Pay.sh approvals must also name the exact payer, recipient/payee, endpoint, network, asset, cap, retry policy, evidence path, and single-use or expiry boundary from the live activation policy. A generic "enable Pay.sh" or "test stablecoin payments" note is not sufficient approval.

## Pay.sh Support States

Pay.sh catalog and provider-preview states are especially easy to overstate. Use these support-state labels:

- `catalog-only`: RAP saw external Pay.sh catalog metadata. It is untrusted external input and not RAP-attested.
- `catalog-visible`: Metadata appears in manager review or listing preview for operator inspection.
- `spec-preview`: RAP can produce in-memory PAY.md/provider YAML preview strings. This is not a Pay.sh submission.
- `sandbox-untested`: RAP has not run Pay.sh sandbox testing for this listing.
- `dry-run-ready`: The candidate can be represented in a dry-run policy/spec/export shape with live payment disabled.
- `live-payment-disabled`: Payment activation, wallet/RPC, provider call, paid request, and catalog submission are unavailable.
- `live-payment-enabled`: Reserved for a future explicitly approved live lane. Do not use this label for #447.

For the #471 Pay.sh tranche, the current shipped boundary is:

- Submitted to Pay.sh: no.
- Listed on Pay.sh by RAP: no.
- Sandbox-tested by RAP: no.
- Live payment enabled: no.
- Live activation policy exists: yes, as docs/process only in [`docs/PAY-SH-LIVE-ACTIVATION-GATES-AND-SPEND-POLICY.md`](PAY-SH-LIVE-ACTIVATION-GATES-AND-SPEND-POLICY.md).

## Publication Flow

1. Static source or external catalog candidate enters review.
2. Operator reviews provenance, diagnostics, risk, endpoint, payment, and evidence state.
3. Readiness gate returns publish-ready or blocked.
4. Publication eligibility checks operator approval, payment proof, receipt evidence, hosted attestation claim, Quasar compatibility, current lifecycle audit, safe metadata, and endpoint binding.
5. Public export builds a dry-run listing snapshot only when eligibility is satisfied.
6. Activation gate consumes the public export item and explicit activation approval.
7. Activation decision can become `dry_run_ready`; live activation remains unavailable in this runbook.

The current dry-run activation plan always keeps these false:

- hosted registry write
- ARD catalog write
- live publication
- wallet signing
- RPC probe
- live payment
- provider call
- MCP call

## Rollback, Unpublish, And Suspend

Operators should prefer reversible lifecycle actions before live systems exist:

- `unpublish`: removes public visibility from a previously publish-ready dry-run state. Latest unpublish audit blocks public export and activation.
- `suspend`: blocks visibility and activation because of safety, evidence, or incident risk.
- `restore`: may only re-enable dry-run export if current readiness, approval, audit, and evidence refs still match.
- `reject`: ends the current review candidate until a new review state is created.

Rollback notes must include the latest lifecycle audit ref, reason, affected listing id, operator, timestamp, and follow-up issue.

## Incident Handling

If an operator finds a boundary escalation, do the following:

1. Stop the lane and record the exact file, UI state, command, or artifact that implied a live action.
2. Mark the listing blocked or suspended in the current issue context.
3. File or update the issue with the escalation type: publication, payment, wallet/RPC, provider/MCP, hosted write, trust, reputation, or catalog submission.
4. Patch the smallest surface that overclaimed the state.
5. Re-run focused validation and attach evidence before resuming.

Examples of boundary escalation:

- UI says "published live" while activation is dry-run only.
- Pay.sh preview omits "not submitted" or implies sandbox testing happened.
- A docs command would run `pay setup`, call RPC, or invoke a provider without approval.
- A hosted attestation claim allows buyer-facing reputation before Quasar/reputation gates exist.

## Validation

Docs-only changes to this runbook should run:

```bash
npm run check:rap:naming
npm run test:bdd:index
git diff --check
```

Code changes that alter readiness, export, activation, Pay.sh preview, or manager UI state must also run the focused tests for the touched modules and include UI screenshots/video or trace when visible UI changes.
