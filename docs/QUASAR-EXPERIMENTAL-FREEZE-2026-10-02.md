# Quasar experimental freeze and critical-path retirement — 2026-10-02

## Decision

Quasar is frozen as a historical, explicitly experimental implementation. It is not a RAP product dependency, production candidate, deployment target, submission target, or current optimization roadmap. Stable Anchor `1.1.2` under `programs/escrow/` remains the authoritative on-chain reference implementation. The isolated Anchor v2 `update_agent` pilot remains default-off alpha research and does not replace the stable lane.

No deployment, upgrade, transaction, signing, simulation, wallet/key creation, funding, RPC execution, mainnet activation, audit-readiness claim, or production-readiness claim is authorized by this decision.

The repository retains `experiments/quasar-*`, `third_party/quasar`, historical artifacts, and the loopback-only Surfpool lane for reproducibility and provenance. The four former devnet/PER operator entrypoints are retained at their original paths as unconditional refusal programs; unlike the former human-process approval boundary, they now fail closed before any SDK import, signer access, RPC use, or transaction work. The hosted `Surfpool Quasar Critical SDK` workflow also still invokes its separate local lane automatically for its existing broad path filters, including stable Anchor and root-manifest changes. This freeze does not physically remove the preserved experimental dependencies, evidence, or CI safeguards; retention and automated regression coverage are not product adoption. Any future reconsideration requires a new decision based on qualifying primary comparison evidence and a separate security review.

## Evidence decision

The existing Quasar benchmark does **not** establish a material advantage unavailable in Anchor 2:

| Existing evidence | Provenance/scope | Qualification verdict |
|---|---|---|
| `QUASAR-BENCHMARKS.md` binary-size table | Quasar hot-path POC (`12,832` bytes) compared with a full multi-instruction Anchor protocol (`386,520` bytes) | `not_comparable`; different feature sets |
| `QUASAR-BENCHMARKS.md` CU table | QuasarSVM measurements compared with undocumented Anchor estimates from a different implementation/runtime | `not_primary_comparison`; no measured Anchor comparator |
| Quasar POC commit `4bf5772` | Abbreviated commit named by the document | `not_reproducible_from_this_clone`; the object is absent from repository history |
| Anchor baseline `c42d47a` | Object exists, but it is the full protocol baseline rather than a semantics-matched hot path | `not_comparable` |
| Quasar POC semantics | Counter-based PDA and omitted cancel-window/clock behavior are disclosed in the benchmark | `not_equivalent`; unsuitable for a framework-only conclusion |
| Anchor v2 pilot | Commit-pinned, generated-client and Mollusk evidence for one non-custodial `update_agent` instruction | `bounded_only`; it shows substantial size/CU reduction is possible in Anchor v2 alpha, but does not compare escrow or establish general superiority/safety |
| Cross-runtime, deployed, security, throughput, or cost comparison | No qualifying primary artifact | `not_evaluated` |

The historical Quasar numbers remain observations about their original POC. They must not be presented as an Anchor comparison, a production benefit, or a reason to retain Quasar on RAP's critical path.

## What is retired

- Quasar is retired from product, production, submission, deployment, audit-readiness, and mainnet planning.
- Historical “Quasar canonical/final/critical submission path” language is superseded and must not be reused as current guidance.
- The blocked devnet IDs in `config/quasar/deployments.json` are provenance records only. Their client/ABI and job-binding mismatch remains unresolved; no redeployment is planned or authorized.
- Quasar-specific readiness commands describe experimental/historical compatibility only. A passing local guard cannot make Quasar submission-ready or reverse this freeze.
- The two root Quasar devnet/PER smoke aliases and all four direct historical operator paths are disabled entrypoints. They always exit nonzero and provide no approval flag, environment token, file, unsafe override, cluster opt-in, or dynamic activation branch. Historical implementations remain recoverable from immutable Git history, not from a second executable archive.
- The hosted Quasar Surfpool workflow remains an automatic regression dependency for its existing broad trigger set. That retained CI role must not be described as product adoption or primary benchmark evidence.
- No future work should add Quasar to a default package manifest, root Cargo workspace, web default, or production runtime path without a separately approved unfreeze decision.

## Dependency and runtime boundary

At this decision point:

- root `package.json` has no Quasar package dependency;
- root `Cargo.toml` includes `programs/*`, not `experiments/quasar-*` or `third_party/quasar`;
- `.env.example` selects `legacy-anchor`, and an unset selector resolves to `legacy-anchor`;
- the web/runtime selector blocks the recorded devnet Quasar target and refuses mainnet Quasar; the four separately owned historical operator entrypoints are now also disabled by their own unconditional refusals;
- current-source Quasar execution is confined to the separate local-Surfpool mechanism using loopback endpoints and four caller-supplied local program IDs; the four devnet/PER operator entrypoints are unconditionally disabled, while the existing hosted workflow invokes only its local Surfpool lane automatically when its path filters match;
- `experiments/quasar-*`, `third_party/quasar`, Quasar scripts, and their automatic hosted regression workflow remain preserved dependencies of the experimental evidence lane.

These boundaries are the minimum non-destructive **product/runtime** retirement: public receipt schemas, payment-rail-neutral interfaces, stable Anchor behavior, historical artifacts, and reproducibility sources remain intact while Quasar has no default product target, package dependency, or production runtime role. Quasar is not completely dependency- or CI-retired; its experimental source and automatic local-regression roles remain until separately authorized removal work is safe, while the four named devnet/PER operator paths are disabled.

## Historical operator provenance

The full pre-disable bodies of the four operator scripts remain exactly recoverable at source commit `801d0d1cb980b25448f400d6290b006e77a7a33d`:

| Current disabled entrypoint | Historical Git blob |
|---|---|
| `scripts/run-quasar-per-devnet-smoke.mjs` | `234638a34adc81772c3b5acdefad862f97ed35b3` |
| `scripts/run-quasar-per-magicblock-cpi-smoke.mjs` | `6621f244dddb7576431594c29f00e16952f907f5` |
| `scripts/run-quasar-per-agent-vault-delegation-smoke.mjs` | `3bfb976d756ad8f181b13ddd422ea6c44018c741` |
| `scripts/run-quasar-per-agent-vault-settlement-smoke.mjs` | `1e3a7195143cfd0d3d8ea153f8cdce4227902215` |

For inspection only, use `git show 801d0d1cb980b25448f400d6290b006e77a7a33d:<path>`. This provenance preserves the exact historical code without adding an executable archive or reactivation route. Existing generated artifacts are unchanged and remain dated historical evidence, not proof that the current entrypoints execute or that the former deployments were safe.

This control is deliberately narrow. It disables the four named owned entrypaths and their two existing npm aliases; it does not claim that every legacy-Anchor tool, read probe, third-party surface, local Surfpool lane, or arbitrary externally supplied Node preload is disabled. Reactivation would require a separately reviewed source change and authorization; there is no approval protocol in this delivery.

## Reconsideration bar

An unfreeze proposal must supply all of the following before implementation is considered:

1. A committed, machine-readable primary benchmark harness that builds both candidates from pinned sources and records commands, toolchain/runtime versions, source commits, binary hashes, and raw results.
2. Semantics-matched programs with the same instruction behavior, account validation, state transitions, and security checks.
3. Measurements in the same runtime profile, including repeated samples and variance; unsupported profiles must be marked `not_evaluated`.
4. A demonstrated material advantage that stable Anchor or an approved Anchor 2 release cannot provide. Estimated comparator values, full-protocol versus hot-path comparisons, and cross-runtime CU comparisons do not qualify.
5. Closure or explicit acceptance of all relevant security gaps, followed by an independent security review and a new authorization decision.

Anchor v2 remains alpha, unaudited, commit-pinned research. Its pilot cannot satisfy this bar for production adoption, but it invalidates the assumption that historical Anchor v1 framework overhead is necessarily unavailable to the Anchor line.

## Safe validation plan for this freeze

Only offline/static checks are in scope:

```bash
git diff --check
node scripts/check-public-claim-boundaries.mjs
npm run check:quasar:submission
npm run test:quasar:runtime-compatibility
npm run test:surfpool:lane-boundaries
```

The Quasar submission command above validates the legacy inventory/compatibility contracts and must print the recorded deployment as `BLOCKED`. Its historical `critical-success` subcheck may also print that old demo factors are satisfied; that line is superseded terminology, not a current readiness or unfreeze verdict. The command does not run a validator. Do **not** run any Surfpool smoke, devnet/live/evidence command, SBF deployment, signer path, transaction construction, simulation, faucet/funding, or RPC probe for this decision.
