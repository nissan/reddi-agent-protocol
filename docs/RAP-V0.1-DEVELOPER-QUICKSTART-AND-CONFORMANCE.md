# RAP v0.1 Developer Quickstart and Conformance

Issue: [#353](https://github.com/nissan/reddi-agent-protocol/issues/353) (parent epic: #355 — OSS developer release and conformance readiness)

This is the single public entry point for an external developer adopting `@reddi/agent-protocol` v0.1. It ties together the quickstart, the example specialist workflow, the consolidated conformance suite, the fixture coverage matrix, and the OSS-vs-hosted boundary docs. Everything here is local, offline, deterministic, and no-spend: no hosted services, no wallet, no RPC, no secrets, no live payment.

## 1. Quickstart: install to running proof in under five minutes

```bash
git clone https://github.com/nissan/reddi-agent-protocol.git
cd reddi-agent-protocol/packages/agent-protocol
npm ci
npm run example:ard:no-spend
```

This runs the deterministic Discover -> Decide -> Prove workflow described in the package README section [ARD No-Spend Quickstart](../packages/agent-protocol/README.md#ard-no-spend-quickstart). No external spend occurs; discovery input is the local fixture `examples/ard-no-spend-ai-catalog.json`, and all policy/trust/payment gates evaluate locally and fail closed.

A second runnable example, `npm run example:buyer-seller:dry-run`, exercises the buyer client / seller middleware pair in isolation.

## 2. Example specialist workflow (what the demo proves)

`examples/ard-no-spend-demo.mjs` is the reference specialist workflow. Its single JSON output demonstrates each required surface:

| Required surface | Where it appears in the demo output |
| --- | --- |
| 402 payment challenge | `createPaymentChallenge` / `evaluateBuyerPaymentChallenge` (schema `reddi.payment-challenge.v1`, status 402) |
| Policy decision | `discovery.policyDecision` + AUDD preflight decision (`reddi.policy-decision.v1`) |
| Receipt creation | `execution.receiptId`, request/response hashes (`reddi.receipt.v1`) |
| Evidence reference | `execution.evidenceRef`, EvidenceArchive record, `receiptEvidenceBinding` (`bindingMode: "local_fixture_refs_only"`) |
| Attestation / reputation output | `attestation` block (attestation record, trust boundary `self_attested`, reputation preview score + routing impact) |
| Failure states | `failures` block: policy denial, malformed challenge, missing evidence, missing operator/payment setup, unsupported rail/network, unsafe (credential-shaped) metadata |

The output also carries the AUDD dry-run payment plan, the rail-neutral proof-chain cases, the downstream public-proof state labels (`fixture_zero_spend`, `planned_dry_run`, `simulated`, `devnet_proof_metadata`, `live_gated`, `production_live_disabled`), and a `boundaries` block asserting that no hosted service, wallet, RPC, SPL transfer, custody, settlement-finality, trust-upgrade, reputation-mutation, or live-payment claim is made.

## 3. Consolidated conformance suite

One deterministic command composes the existing per-module conformance suites — it defines no new checks:

```bash
# From the repo root
npm run check:conformance:public

# Or from packages/agent-protocol
npm run conformance
```

Both invoke `scripts/run-public-conformance.mjs`, which builds the package, compiles the test suites, then runs each conformance area and finishes with the packed-artifact secret/content guard:

| Area | Validates | Composed suites |
| --- | --- | --- |
| `receipt-shape` | `reddi.receipt.v1` shape + fixture cases | `receipts`, `rail-neutral-payment-receipts` |
| `policy-decision-shape` | `reddi.policy-decision.v1`, buyer-authority policy corpus, AUDD preflight fail-closed | `buyer-authority-policy`, `audd-payment-plan` |
| `source-metadata` | AI catalog, discovery sources, provider trust, source diagnostics, source/trust conformance matrix | `ai-catalog`, `discovery-source`, `provider-trust`, `source-diagnostics`, `source-trust-conformance-matrix` |
| `challenge-handling` | 402 challenge issue/accept, malformed-challenge + unsupported-rail fail-closed, MPP/Tempo challenge shapes | `buyer-seller`, `mpp-tempo-receipt-shapes` |
| `evidence-binding` | EvidenceArchive records, receipt-evidence binding, proof-chain fixture states | `evidence-archive`, `receipt-evidence-binding`, `rail-neutral-proof-chain-fixture` |
| `secret-leakage-rejection` | credential-shaped receipt/evidence metadata rejected | `receipts` (credential-leakage fixture), `evidence-archive` (unsafe metadata) |
| `quickstart-no-spend-workflow` | the §2 demo end-to-end, including failure states and AUDD proof-metadata/no-custody labels | `ard-no-spend-demo` |
| `interop-conformance-modules` | framework-template, OKF (+ instruction safety), ERC-8004 export, AP2 mandate, agent-stack fixture corpora | the per-module conformance suites |
| `packed-artifact-guard` | `npm pack --dry-run` contains no secrets or forbidden paths | `scripts/check-package-artifact-contents.mjs` |

The suite exits non-zero on any failure and fails fast if any composed suite file has been renamed or removed (drift guard). CI runs it on every PR touching `packages/agent-protocol/**` via the `rap-package-guard` workflow (step "Public conformance suite (#353)", using `--skip-build` after the build/test steps).

## 4. Fixture coverage matrix

Every fixture state required by #353 exists and is asserted by the composed suites:

| Required case | Where it lives |
| --- | --- |
| Happy path | `fixtures.ts` -> `reddiReceiptFixtureCases.happyPath`; demo happy-path output |
| Policy denial | `reddiReceiptFixtureCases.policyDenial`; demo `failures.policyDenial` |
| Malformed challenge | demo `failures.malformedChallenge`; `mpp-tempo-receipt-shapes` `malformed_challenge` cases; buyer-seller fail-closed tests |
| Unsupported rail/network | `reddiReceiptFixtureCases.unsupportedNetworkAsset`; demo `failures.unsupportedRailNetwork`; rail-neutral proof-chain blocked cases |
| Missing evidence | demo `failures.missingEvidence` (`evidence_missing`); buyer-authority `missingEvidenceRequirement` policy fixture |
| Credential leakage rejection | `reddiReceiptFixtureCases.credentialLeakage` (`credential_leakage_rejected`); demo `failures.unsafeMetadata` |
| AUDD proof-metadata / no-custody state labels | demo `downstreamPublicProofContracts.stateLabels` (`devnet_proof_metadata`, ...) + `boundaries` (custody/settlement flags false); rail-neutral receipts assert `custodyClaim: false` |

## 5. Self-hosted OSS path vs hosted path

These boundaries are normative and documented once — do not restate them elsewhere:

- [Discover/Decide/Prove Boundaries](./DISCOVER-DECIDE-PROVE-BOUNDARIES.md) (#452) — lane boundaries between OSS, hosted, and Quasar surfaces; discovery relevance is never trust, budget, payment, or publication approval.
- [RAP v0.1 Release Checklist](./RAP-V0.1-RELEASE-CHECKLIST.md) §8 (OSS/self-hosted release scope) and §9 (hosted marketplace/facilitator path, explicitly out of v0.1 launch scope).

Summary for adopters: everything in §1–§4 works from a clean checkout with no hosted dependency. Hosted catalog/search, facilitators, live payment, custody, and settlement-finality claims are out of v0.1 scope and mechanically excluded from package text by the claim-boundary scan.

## 6. Full local verification path

For the complete release-gate command set (release dry-run, exports guard, artifact guard, naming guard, clean-checkout OSS smoke), see the [RAP v0.1 Release Checklist](./RAP-V0.1-RELEASE-CHECKLIST.md) §2 and §7. The short loop for day-to-day development:

```bash
cd packages/agent-protocol
npm test                          # full package suite
npm run conformance               # consolidated public conformance suite
```

No secrets or network calls are required by any command in this document.
