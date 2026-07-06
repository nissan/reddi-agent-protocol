# RAP v0.1 Release Checklist

Issue: [#449](https://github.com/nissan/reddi-agent-protocol/issues/449) (parent epic: #355 — OSS developer release and conformance readiness)

This is the release-readiness checklist for the public RAP v0.1 package set. It defines what must be true — and which deterministic command proves each claim — before `@reddi/agent-protocol` v0.1 is treated as launch-ready. Nothing in this checklist publishes anything: every gate is a local, offline, no-spend dry-run. Actual npm publication requires a separate approved issue and explicit operator approval.

## 1. Package Candidate Set

Per [OSS v0.1 Release Smoke](./OSS-V0.1-RELEASE-SMOKE.md) (#512) and the [x402 Adapter Retention Decision](./X402-ADAPTER-RETENTION-DECISION-2026-06-24.md):

| Package | v0.1 role |
| --- | --- |
| `@reddi/agent-protocol` | Primary public package — protocol primitives, fixtures, local conformance helpers |
| `@reddi/x402-solana` | Repo-local OSS candidate with explicit x402/Solana boundaries |
| `@reddi/sendai-x402`, `@reddi/eliza-plugin-x402` | **Deferred** experimental packages — must not appear in v0.1 release claims |

## 2. Release Gates (deterministic commands)

Each row is a required PASS. All commands are offline and no-spend.

| Gate | Command | Proves |
| --- | --- | --- |
| Package release dry-run | `cd packages/agent-protocol && npm run release:dry-run` | clean rebuild, full test suite, exports resolution, artifact-contents guard, `npm pack --dry-run` |
| Exports resolution (#521 guard) | `cd packages/agent-protocol && npm run check:exports` | every `exports`/`main`/`types` target in `package.json` exists on disk (the guard prints the live target count — do not hardcode it; it grows with each new subpath) |
| Package artifact contents (#449 guard) | `npm run check:package:artifacts` (repo root) | packed tarballs for the whole candidate set contain only allowed files — see §6 |
| RAP naming guard | `npm run check:rap:naming` (repo root) | no banned standalone-Reddi shorthand in public-facing text |
| Clean-checkout OSS smoke (#512) | `npm run check:oss-release-smoke` (repo root) | tests + no-spend examples + import smoke + pack inspection + claim-boundary scan for the whole candidate set |
| x402 package dry-run | `cd packages/x402-solana && npm run release:dry-run` | clean rebuild, jest suite, artifact-contents guard, `npm pack --dry-run` |

CI coverage: the `rap-package-guard` workflow (`.github/workflows/rap-package-guard.yml`) runs build + test + exports guard + artifact-contents guard on every PR touching `packages/agent-protocol/**`.

## 3. Required Package Contents

The packed artifact for each candidate package must contain exactly:

- `package.json` — with `name`, `version`, `main`, `types`, `exports`, `files` whitelist (`dist` + `README.md` + `CHANGELOG.md`, plus `examples` for `@reddi/agent-protocol`), declared `license`, and no `private: true`.
- `README.md` — coverage requirements in §4.
- `LICENSE` — per-package MIT copy (npm auto-includes `LICENSE*` from the package directory; the repo-root file never lands in the tarball).
- `CHANGELOG.md` — per-package v0.1.0 release notes (§5), included via the `files` whitelist.
- `dist/` — compiled JS + `.d.ts` for every exported subpath. `dist/` is committed for these packages; the exports guard exists precisely because a source-only commit would ship broken subpaths.
- `examples/` (`@reddi/agent-protocol` only) — the no-spend runnable examples (`ard-no-spend-demo.mjs`, `buyer-seller-dry-run.mjs`, `ard-no-spend-ai-catalog.json`).

Nothing else. Presence is enforced by `scripts/check-package-artifact-contents.mjs` (missing `package.json`, `README.md`, or `dist/` output fails the guard).

## 4. README Coverage

`packages/agent-protocol/README.md` must document, per exported surface family: install, receipt validation, policy decisions, buyer-authority policy, framework template contract + conformance, AI catalog ingestion, provider trust, discovery sources, EvidenceArchive, source diagnostics, attestation/reputation, Quasar registry compatibility (metadata-only), buyer client / seller middleware, AUDD/Solana payment plans (preflight-only), the **ARD No-Spend Quickstart** (§7), and Local Validation. Every code sample must import from a declared exports subpath (proven transitively by the exports guard + package tests).

`packages/x402-solana/README.md` must state the repo-local candidate status and x402/Solana boundaries without publication or settlement-finality claims (enforced by the #512 claim-boundary scan).

## 5. Changelog / Release Notes, License, Security, Contributing

| Check | Status 2026-07-06 | Notes |
| --- | --- | --- |
| Repo `LICENSE` (MIT) | ✅ present | Root `LICENSE`, MIT, Redditech Pty Ltd |
| `license` field in each candidate `package.json` | ✅ present | `@reddi/x402-solana` gained its MIT declaration with #449; guard now enforces the field |
| Per-package `LICENSE` file in tarball | ✅ done 2026-07-06 | Root MIT `LICENSE` copied into `packages/agent-protocol/` and `packages/x402-solana/`. Verified via `npm pack --dry-run --json`: `LICENSE` present in both tarballs (agent-protocol 93 files, x402-solana 20 files); `npm run check:package:artifacts` PASS. |
| `SECURITY.md` | ✅ present | Repo root |
| `CONTRIBUTING.md` | ✅ present | Repo root |
| Package-level release notes | ✅ done 2026-07-06 | Per-package `CHANGELOG.md` added for both candidates (v0.1.0, 2026-07-06), added to each `files` whitelist so they ship in the tarball. Content grounded in the package READMEs: module areas + subpath-export families (counts deferred to the exports guard), the no-spend/no-custody/no-live-settlement boundary statement, quickstart commands, `npm run check:conformance:public`, and honest draft/unverified labels (Airwallex rail DRAFT v1; ERC-8004/AP2 external drafts with promoted RAP-side contracts). Root `CHANGELOG.md` remains app-focused and untouched. |

## 6. Artifact Exclusions (package artifact guard)

`scripts/check-package-artifact-contents.mjs` (npm: `check:package:artifacts`, per-package: `check:artifacts`) runs `npm pack --dry-run --json` **from each package directory** (never via `npm --prefix` from the root — that can inspect the root app package) and fails on any of:

- **Secrets:** `.env*`, `.npmrc`, wallet/keypair/`id_rsa`/`id_ed25519` JSON, `*secret*`, `*private-key*`, `.pem`/`.p12`/`.pfx`/`.keystore`.
- **Generated noise:** `node_modules/`, `dist-tests/`, `test-results/`, `artifacts/`, `coverage/`, `.next/`, `*.log`, `*.tsbuildinfo`, nested `*.tgz`, `.DS_Store`.
- **Private research / corpora:** `research/`, `ingests/`.
- **Unrelated app/repo files:** `app/`, `components/`, `config/`, `e2e/`, `tests/`, `programs/`, `third_party/`.

It also enforces manifest hygiene (§3). The guard is wired into: `release:dry-run` and `prepublishOnly` for `@reddi/agent-protocol`, `release:dry-run` for `@reddi/x402-solana`, and the `rap-package-guard` CI workflow. The heavier #512 smoke keeps its own pack inspection; this guard is the cheap standalone gate.

## 7. No-Spend Local Verification Path

The complete local proof path — no hosted services, no wallet, no RPC, no paid provider, no secrets, no network:

```bash
# Quickstart (README "ARD No-Spend Quickstart"): Discover -> Decide -> Prove on fixtures
cd packages/agent-protocol
npm ci
npm run example:ard:no-spend

# Package tests (includes conformance fixture suites and the exports guard in-suite)
npm test

# Deterministic conformance check for the quickstart itself
npm test -- --test-name-pattern "ARD no-spend demo"

# Consolidated public conformance suite (#353): composes the per-module conformance
# suites + packed-artifact guard (also `npm run check:conformance:public` from the repo root)
npm run conformance

# Full release dry-run (clean build + tests + exports guard + artifact guard + pack)
npm run release:dry-run
```

Conformance fixture surfaces shipped in the package (all deterministic, offline): framework-template conformance (`framework-template-conformance`, `framework-template-conformance-fixtures`), rail-neutral proof chain (`rail-neutral-proof-chain-fixture`, #416), ERC-8004 export conformance, AP2 mandate conformance, OKF conformance, and the agent-stack fixture corpora. Supporting docs live under `docs/conformance/`.

Clean-checkout equivalent for the whole candidate set: `npm run check:oss-release-smoke` from the repo root (#512).

## 8. OSS / Self-Hosted Path (release scope of this checklist)

RAP v0.1 launch scope is **only** the OSS/self-hosted path:

- Everything a developer needs must work from a clean checkout with the commands in §2 and §7 — no hosted RAP dependency, no live ARD registry, no facilitator.
- Discovery inputs are local fixtures (`examples/ard-no-spend-ai-catalog.json`, agent-stack fixture corpora); policy/trust/payment gates evaluate locally and fail closed; proof surfaces (receipts, EvidenceArchive, bindings, attestation drafts) are fixture-refs only.
- Lane boundaries are normative per [Discover/Decide/Prove Boundaries](./DISCOVER-DECIDE-PROVE-BOUNDARIES.md) (#452): discovery relevance is never trust, budget, payment, or publication approval.

Passing this checklist means the OSS path is releasable. It makes **no claim** about hosted services.

## 9. Hosted RAP Marketplace / Facilitator Path (explicitly out of v0.1 launch scope)

The hosted path is tracked and gated separately — it must not leak into v0.1 package claims:

- Hosted catalog/search surfaces (#369) are read-only projections and optional for OSS success — see [Hosted RAP Discovery Surfaces](./HOSTED-RAP-DISCOVERY-SURFACES.md).
- Live publication behavior is owned solely by the #395 activation-gate work (operator approval, audit evidence, publication claims from #393/#394 outputs only).
- Facilitator/live-payment, custody, settlement-finality, trust-upgrade, and reputation-mutation claims are forbidden in package text; the #512 claim-boundary scan enforces this mechanically.
- Nothing in the packed artifacts may require or embed hosted endpoints, credentials, or facilitator configuration (§6 guard).

A future hosted-marketplace release gets its own checklist; do not extend this one.

## 10. Checklist Inputs (#449 dependency clarification, 2026-06-20)

Live status as of 2026-07-06:

| Input | Scope | Status | Where it landed |
| --- | --- | --- | --- |
| #353 | Public developer quickstart, examples, and conformance suite (feature) | ✅ CLOSED 2026-07-06 | Quickstart + examples via #357; conformance-suite packaging via `npm run check:conformance:public` (`scripts/run-public-conformance.mjs`, also in the `rap-package-guard` CI lane) + [docs/RAP-V0.1-DEVELOPER-QUICKSTART-AND-CONFORMANCE.md](./RAP-V0.1-DEVELOPER-QUICKSTART-AND-CONFORMANCE.md) |
| #357 | Final public local no-spend quickstart and conformance polish | ✅ CLOSED 2026-06-22 | `packages/agent-protocol/README.md` § "ARD No-Spend Quickstart"; `npm run example:ard:no-spend` |
| #416 | Proof-chain fixture Discover → Attestation | ✅ CLOSED 2026-06-24 | `@reddi/agent-protocol/rail-neutral-proof-chain-fixture` export + fixtures |
| #417 | Public demo proof page data contract | ✅ CLOSED 2026-06-22 | `reddi.economic-demo.public-proof-page-data.v1` (referenced from the no-spend demo output) |
| #450 | Source/trust conformance matrix for auth.md and ARD metadata | ✅ CLOSED 2026-07-06 | Landed via PR #593: `reddi.source-trust-conformance-matrix.v1` (`@reddi/agent-protocol/source-trust-conformance-matrix`) — 7 trust states × 7 case classes on both source kinds, #343/#344 projections. |
| #451 | No-spend RAP conformance runner for public quickstart | ✅ CLOSED 2026-06-24 | Satisfied by #357/#492 (deterministic local path + fail-closed cases); release confidence superseded by the #512 smoke gate |
| #452 | Discover/Decide/Prove boundaries doc (OSS / hosted / Quasar lanes) | ✅ CLOSED 2026-07-06 | [docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md](./DISCOVER-DECIDE-PROVE-BOUNDARIES.md) (PR #591) |

Supporting machinery already landed: #512/#523 clean-checkout OSS smoke gate, #521/#573 exports-resolution guard + `rap-package-guard` CI lane.

**Launch gate:** every required checklist input (#353/#357/#416/#417/#450/#451/#452) is now CLOSED (2026-07-06). The §5 pre-publish follow-ups (per-package `LICENSE` files in tarballs, package-level v0.1.0 release notes) landed 2026-07-06 — see §5 rows and the §11 record. RAP v0.1 is ready when every §2 gate passes. The checklist itself, and every executable gate in it, is complete and runnable today.

## 11. Executed Dry-Run Record

First executed pass — **2026-07-06 (AEST)**, branch `feat/449-v01-release-checklist`, clean worktree from `origin/main` @ `7a4337ab`:

- `cd packages/agent-protocol && npm run release:dry-run` → **PASS**
  - `npm test`: 437 tests, 0 fail.
  - `check-package-exports`: OK — all declared export/main/types targets exist on disk (87 at time of run; use the command, not this number).
  - `check-package-artifact-contents`: OK — dry-run pack = 89 files, all bounded.
  - `npm pack --dry-run`: 89 files, ~234 kB tarball / ~1.1 MB unpacked; contents limited to `package.json`, `README.md`, `dist/`, `examples/` — no secrets, no `dist-tests/`, no `test-results/`, no `artifacts/`, no research, no app files.
- `npm run check:package:artifacts` (root, both candidates) → **PASS** (agent-protocol 89 files; x402-solana 18 files).
- Negative control: injecting `dist/.env` into the agent-protocol pack input made the guard **FAIL** with `forbidden path (dotenv file)` — the exclusion check is live, not vacuous.
- `npm run check:rap:naming` → PASS. No publish occurred; no network, wallet, RPC, or hosted service was touched.

Record subsequent passes here (date, commit, verdict) whenever the release candidate is re-cut.

Second executed pass — **2026-07-06 (AEST)**, branch `feat/449-license-release-notes`, clean worktree from `origin/main` @ `cca7ec29`, after adding per-package `LICENSE` + `CHANGELOG.md` (§5 follow-ups):

- `cd packages/agent-protocol && npm run release:dry-run` → **PASS**
  - `npm test`: 448 tests, 0 fail.
  - `check-package-exports`: OK — all 89 export/main/types targets exist on disk (use the command, not this number).
  - `check-package-artifact-contents`: OK — dry-run pack = 93 files, all bounded.
  - `npm pack --dry-run`: 93 files, ~247 kB tarball / ~1.1 MB unpacked; `LICENSE` and `CHANGELOG.md` now present at tarball top level alongside `package.json`, `README.md`, `dist/`, `examples/`.
- `cd packages/x402-solana && npm run release:dry-run` → **PASS** (Jest: 3 suites, 45 tests, 0 fail; pack = 20 files, ~18 kB, `LICENSE` + `CHANGELOG.md` included).
- `npm run check:package:artifacts` (root, both candidates) → **PASS** (agent-protocol 93 files; x402-solana 20 files).
- `npm run check:conformance:public` (root) → **PASS** — all 9 conformance areas passed (119 composed tests), packed-artifact guard OK.
- `npm run check:rap:naming` → PASS (new `CHANGELOG.md` files scanned). No publish occurred; no network, wallet, RPC, or hosted service was touched.
