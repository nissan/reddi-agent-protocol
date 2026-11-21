# RAP v0.1 Developer Quickstart and Conformance

Issue: [#353](https://github.com/nissan/reddi-agent-protocol/issues/353) (parent epic: #355 — OSS developer release and conformance readiness)

This is the single public entry point for an external developer adopting `@redditech/agent-protocol`. It was rebuilt on `reddi.receipt.v2` when receipt v1 and the modules built on it were removed before V1 (#776). Payments prove transfer; RAP Assurance proves paid work. This guide ties together the quickstart, the example specialist workflow, the consolidated conformance suite, the fixture coverage matrix, and the OSS-vs-hosted boundary docs. Everything here is local, offline, deterministic, and no-spend: no hosted services, no wallet, no RPC, no secrets, no live payment.

## 1. Quickstart: install to running proof in under five minutes

```bash
git clone https://github.com/nissan/reddi-agent-protocol.git
cd reddi-agent-protocol/packages/agent-protocol
npm ci
npm run example:ard:no-spend
```

This runs the deterministic Discover -> Decide -> Prove workflow described in the package README section [ARD No-Spend Quickstart](../packages/agent-protocol/README.md#ard-no-spend-quickstart). No external spend occurs; discovery input is the local fixture `examples/ard-no-spend-ai-catalog.json`, and the discovery policy, trust and receipt checks evaluate locally and fail closed.

A second runnable example, `npm run example:interpretation-guide`, prints the scenarios behind the [interpretation guide](./RAP-INTERPRETATION-GUIDE-INTERIM.md).

## 2. Example specialist workflow (what the demo proves)

`examples/ard-no-spend-demo.mjs` is the reference specialist workflow. Its single JSON output demonstrates each required surface:

| Required surface | Where it appears in the demo output |
| --- | --- |
| Discovery and trust | `catalog`, `discovery.candidate`, `discovery.diagnostics` |
| Policy decision | `discovery.policyDecision` (the buyer's discovery policy preflight) |
| Provider-signed receipt | `receipt` (`reddi.receipt.v2`, verified offline against the provider, hashes and payment the buyer knows) |
| Evidence reference | `evidence` (EvidenceArchive record that names the signed receipt by hash) |
| Attestation / reputation output | `attestation` block (attestation record, trust boundary `self_attested`, reputation projection score + routing impact) |
| Failure states | `failures` block: policy denial, unsupported network, tampered response, wrong provider, receipt edited after signing, different payment, removed receipt version, missing evidence, unsafe (credential-shaped) metadata |

The receipt's transaction signature is a made-up fixture value and `receipt.payment.fixtureTransaction` is `true`: no payment was made. A verified receipt shows what the provider declared, not which model ran. The `boundaries` block asserts that no hosted service, wallet, RPC, SPL transfer, custody, settlement-finality, model-execution, trust-upgrade, reputation-mutation, or live-payment claim is made.

## 3. Consolidated conformance suite

One deterministic command composes the per-module conformance suites:

```bash
# From the repo root
npm run check:conformance:public

# Or from packages/agent-protocol
npm run conformance
```

Both invoke `scripts/run-public-conformance.mjs`, which builds the package, compiles the test suites, then runs each conformance area and finishes with the packed-artifact secret/content guard:

| Area | Validates | Composed suites |
| --- | --- | --- |
| `receipt-shape` | `reddi.receipt.v2` shape, canonical signing bytes, offline signature verification, removed versions rejected | `receipt-v2` |
| `payment-records` | job, agreement, intent, observation and refund records, environment and eligibility labels, AUDD rail identity | `payment-records`, `audd-rail-config` |
| `source-metadata` | AI catalog, discovery sources and policy preflight, provider trust, source diagnostics, source/trust conformance matrix | `ai-catalog`, `discovery-source`, `provider-trust`, `source-diagnostics`, `source-trust-conformance-matrix` |
| `challenge-shapes` | MPP/Tempo challenge and receipt shapes fail closed | `mpp-tempo-receipt-shapes` |
| `evidence-and-attestation` | EvidenceArchive records, attestation records and reputation projection | `evidence-archive`, `attestation-reputation` |
| `secret-leakage-rejection` | a receipt with a field its version does not define is rejected; credential-shaped evidence metadata is rejected | `receipt-v2`, `evidence-archive` |
| `quickstart-no-spend-workflow` | the §2 demo end-to-end with each failure state refusing, and the interpretation guide scenarios | `ard-no-spend-demo`, `interpretation-guide-scenarios` |
| `interop-conformance-modules` | OKF adapter, conformance and instruction safety, Quasar registry compatibility, agent-stack fixture corpora | the per-module suites |
| `packed-artifact-guard` | `npm pack --dry-run` contains no secrets or forbidden paths | `scripts/check-package-artifact-contents.mjs` |

The suite exits non-zero on any failure and fails fast if any composed suite file has been renamed or removed (drift guard). CI runs it on every PR touching `packages/agent-protocol/**` via the `rap-package-guard` workflow (step "Public conformance suite (#353)", using `--skip-build` after the build/test steps).

## 4. Fixture coverage matrix

The cases the composed suites assert:

| Required case | Where it lives |
| --- | --- |
| Happy path | demo `receipt` (verified `reddi.receipt.v2`); `receipt-v2` tests |
| Policy denial | demo `failures.policyDenial` (`over_budget`); `discovery-source` tests |
| Malformed challenge | `mpp-tempo-receipt-shapes` `malformed_challenge` cases |
| Unsupported rail/network | demo `failures.unsupportedNetwork`; `receipt-v2` rejects networks and currencies outside the version |
| Tampered or mismatched receipt | demo `failures.tamperedResponse`, `wrongProvider`, `editedAfterSigning`, `differentPayment` |
| Missing evidence | demo `failures.missingEvidence` (`evidence_missing`) |
| Credential leakage rejection | demo `failures.unsafeMetadata` (`credential_leakage_rejected`); `evidence-archive` tests |
| No-custody labels | demo `boundaries` (custody, settlement and model-execution flags false) |

## 5. Self-hosted OSS path vs hosted path

These boundaries are normative and documented once — do not restate them elsewhere:

- [Discover/Decide/Prove Boundaries](./DISCOVER-DECIDE-PROVE-BOUNDARIES.md) (#452) — lane boundaries between OSS, hosted, and Quasar surfaces; discovery relevance is never trust, budget, payment, or publication approval.
- [RAP v0.1 Release Checklist](./RAP-V0.1-RELEASE-CHECKLIST.md) §8 (OSS/self-hosted release scope) and §9 (hosted marketplace/facilitator path, explicitly out of v0.1 launch scope).

Summary for adopters: everything in §1–§4 works from a clean checkout with no hosted dependency. Hosted catalog/search, facilitators, live payment, custody, production marketplace, runtime, and settlement-finality claims are out of v0.1 scope and mechanically excluded from package text by the claim-boundary scan.

## 6. Full local verification path

For the complete release-gate command set (release dry-run, exports guard, artifact guard, naming guard, clean-checkout OSS smoke), see the [RAP v0.1 Release Checklist](./RAP-V0.1-RELEASE-CHECKLIST.md) §2 and §7. The short loop for day-to-day development:

```bash
cd packages/agent-protocol
npm test                          # full package suite
npm run conformance               # consolidated public conformance suite
```

No secrets or network calls are required by any command in this document.
