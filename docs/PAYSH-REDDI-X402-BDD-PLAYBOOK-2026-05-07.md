# Pay.sh + `reddi-x402` BDD Iterative Playbook — 2026-05-07

## Naming rule — non-negotiable

- Product name: **Reddi Agent Protocol**.
- Key user package: **`reddi-x402`**.
- Do not use standalone “Reddi” as the product name in new collateral, docs, UI, plans, or evidence.
- Use “Reddi Agent Protocol API/endpoint/gateway/provider” when referring to the product surface.
- Use `reddi-x402` when referring to the user-facing package or x402 compatibility layer.

## Current strategic decision

Pay.sh is the fastest high-confidence layer for the agent-paid API story:

- Reddi Agent Protocol remains the protocol/product.
- `reddi-x402` is the package/compatibility surface.
- Pay.sh provides sandbox wallet approval, HTTP 402 retry UX, MPP/x402 client compatibility, paid gateway specs, usage metering, capped session payments, payment splits, and pay-skills discovery.
- Quasar remains the auditable on-chain proof path.
- Umbra remains the private settlement expansion lane.
- MagicBlock remains boundary/repro appendix unless sponsor guidance accepts delegation-only evidence.

## Iteration contract

Every phase must follow this loop:

1. **Expectation** — what should become true.
2. **Scenario / guard** — executable or reviewable BDD statement.
3. **Implementation** — smallest useful change.
4. **Validation** — command, test, build, smoke, or named blocker.
5. **Retrospective** — what surprised us, what changed, what to keep/stop/start.
6. **Plan refinement** — update this playbook and `STATUS.md` before moving on.

No phase is “done” until its retrospective is written.

## Phase 0 — Naming and claim-boundary guard

### Expectation

New Pay.sh/`reddi-x402` collateral never calls the product standalone “Reddi” and never overclaims MagicBlock or sandbox settlement.

### Scenarios / guards

- Given a new payment-integration doc, when it references the product, then it uses **Reddi Agent Protocol**.
- Given package/client language, when it references the package, then it uses **`reddi-x402`**.
- Given MagicBlock evidence, when the doc summarizes status, then it says delegation proven and TEE PER settlement not claimed.
- Given Pay.sh sandbox evidence, when the doc summarizes settlement, then it says sandbox compatibility, not real mainnet settlement.

### Implementation plan

- Add `scripts/check-product-naming.mjs` for active payment/submission docs.
- Add `npm run check:product:naming`.
- Correct current Pay.sh/Umbra/status/memory wording.

### Validation

- `npm run check:product:naming`
- `git diff --check`

### Retrospective

Phase 0 first gate passed. The key surprise was that broad mechanical replacement can accidentally turn “Reddi Agent Protocol” into “Reddi Agent Protocol Agent Protocol”; the guard now catches standalone “Reddi” in active payment/submission docs, but it intentionally allows lines that explain the rule itself.

Keep:

- Product references as “Reddi Agent Protocol”.
- Package/client references as `reddi-x402`.
- Active-doc naming guard before commits.

Stop:

- Bulk replacing the short product stem without first protecting already-correct “Reddi Agent Protocol”.

Start:

- Add new active payment docs to `scripts/check-product-naming.mjs` defaults as they become submission-relevant.

### Plan refinement

Proceed to Phase 1 with the naming guard in place. Scope the first Pay.sh provider spec to a single sandbox/local endpoint, and do not attempt mainnet or broad CLI exploration.

## Phase 1 — Pay.sh provider-spec boundary

### Expectation

A Pay.sh sandbox provider spec exists for one Reddi Agent Protocol economic-demo endpoint without committing secrets or requiring mainnet funds.

### Scenarios / guards

- Given a Pay.sh client requests the metered endpoint without proof, then the gateway should return HTTP 402.
- Given the request is retried through Pay.sh sandbox, then the gateway should forward only after payment proof verification.
- Given an unlisted path, then the gateway should not expose it.
- Given upstream credentials are needed, then they are read from env vars only.

### Implementation plan

- Add `config/pay-sh/reddi-x402-economic-demo-provider.yml`.
- Start with `routing.type: proxy` to a local app server endpoint, or `routing.type: respond` only if we need a first isolated smoke.
- Price by `requests` first.
- Include notes that this is sandbox/localnet only.

### Validation

Preferred, if Pay.sh CLI is available/approved:

```sh
pay --sandbox server start config/pay-sh/reddi-x402-economic-demo-provider.yml --bind 127.0.0.1:1402
pay --sandbox curl http://127.0.0.1:1402/<metered-endpoint>
```

Fallback before CLI availability:

- YAML parse/check.
- Static spec assertions: allowlist present, network not mainnet, no secret literals, endpoint descriptions mention Reddi Agent Protocol / `reddi-x402` correctly.

### Retrospective

Phase 1 first validation passed with a deliberately conservative sandbox provider spec at `config/pay-sh/reddi-x402-economic-demo-provider.yml`. The spec uses `routing.type: respond` rather than proxying a live app endpoint so we can validate Pay.sh gateway/payment semantics before coupling to the Next app runtime. Static validation now checks localnet-only configuration, endpoint allowlist, request metering, no secret-like literals, sandbox claim boundary, and naming discipline.

Keep:

- Start with a single metered endpoint.
- Keep mainnet out of the first Pay.sh loop.
- Treat `routing.type: respond` as a smoke/demo-only stepping stone.

Stop:

- Designing broad provider specs before proving one endpoint.

Start:

- Check whether `pay` CLI is installed and, if safe/available, run the sandbox gateway smoke.

### Plan refinement

Pay.sh CLI availability check completed after Nissan installed it with Homebrew: `pay 0.16.0` is available. Sandbox gateway smoke ran successfully with `pay --sandbox server start config/pay-sh/reddi-x402-economic-demo-provider.yml --bind 127.0.0.1:1402 --debugger`. Plain curl produced HTTP 402 / MPP challenges; `pay --sandbox curl -i` retried and returned HTTP 200 with a `payment-receipt` header. Proceed to Phase 2 evidence hardening and observed-output capture.

## Phase 2 — `reddi-x402` compatibility evidence artifact

### Expectation

The repo can generate an evidence artifact showing a Pay.sh-compatible challenge/retry/payment-proof flow or a clearly labelled sandbox/mock equivalent.

### Scenarios / guards

- Given Pay.sh returns a receipt/proof header, then the evidence pack records only fields actually returned.
- Given the run is sandbox, then the evidence pack says sandbox and does not claim real funds moved.
- Given the endpoint uses x402 sign-in only, then the evidence pack says auth-only and not payment settlement.

### Implementation plan

- Add/extend a script under `scripts/` to capture Pay.sh compatibility evidence.
- Store artifacts under `artifacts/pay-sh-reddi-x402/<timestamp>/`.
- Include challenge headers, response status, receipt/proof metadata, provider spec hash, and claim-boundary text.

### Validation

- `node --check` on script.
- Targeted unit/static assertions.
- If CLI smoke succeeds, artifact contains real sandbox receipt/proof fields.

### Retrospective

Phase 2 first sandbox evidence passed. Observed Pay.sh CLI shape differed slightly from docs: `pay --sandbox --output json curl ...` was invalid in `pay 0.16.0`; the working form was `pay --sandbox curl -i ...`. Plain curl returned HTTP 402 with two MPP challenges for USDC/USDT at $0.01/request. Pay.sh sandbox retry returned HTTP 200 with `payment-receipt`, receipt status `success`, method `solana`, and a sandbox reference signature. Evidence was captured under `artifacts/pay-sh-reddi-x402/20260507T064842Z/`.

Keep:

- Record only fields actually observed in CLI output.
- Label the result sandbox compatibility, not mainnet settlement.
- Keep provider spec hash in artifacts.

Stop:

- Relying on docs-only CLI flags without checking installed version behavior.

Start:

- Turn the ad-hoc evidence extraction into a reusable script before Phase 3 expands to sessions/splits.

### Plan refinement

Reusable evidence generator added: `scripts/generate-pay-sh-reddi-x402-evidence.mjs` and `npm run evidence:pay-sh:reddi-x402 -- <artifact-dir>`. It parses captured plain/pay outputs, verifies the expected HTTP 402 → Pay.sh sandbox HTTP 200 + `payment-receipt` transition, and emits `SUMMARY.json`/`SUMMARY.md`. Phase 3 can reuse this schema for cap/split metadata.

## Phase 3 — Capped session payments and split-payment story

### Expectation

Reddi Agent Protocol can demonstrate a safe spend envelope for repeated agent calls and a revenue-split model for downstream specialist agents/providers.

### Scenarios / guards

- Given a session cap, then docs call it “capped repeated-call authorization,” not streaming.
- Given a split recipient, then the provider spec defines the named recipient and keeps total splits below the price.
- Given specialist downstream use, then the disclosure ledger records the split/economic relationship.

### Implementation plan

- Extend provider spec with optional `session.cap_usdc`.
- Add a split-payment example using env-var wallet placeholders.
- Map split metadata into the existing disclosure-ledger narrative/evidence.

### Validation

- Static spec assertions.
- Pay.sh sandbox smoke if supported.
- Evidence pack includes cap/split metadata only if configured.

### Retrospective

Phase 3 produced mixed but valuable results. Static specs for session+split and split-only both validated. Runtime behavior in Pay.sh 0.16.0:

- `session` spec emitted an MPP `intent="session"` challenge with cap `1000000` base units, but `pay --sandbox curl` returned `Server returned 402 again after payment`.
- split-only charge spec emitted an MPP `intent="charge"` challenge with split metadata embedded (`amount: 4000`, recipient `d4ST3N4Vkio1Xsg2NaF6Zox7Xq8MdqWihvyip9AHioR`), but `pay --sandbox curl` also returned `Server returned 402 again after payment`.

Keep:

- Working Phase 2 single-recipient charge flow as the primary demo path.
- Session/split specs as extension evidence and compatibility probes.
- Explicit claim boundary: metadata observed, completed settlement not proven for session/split variants.

Stop:

- Treating sessions/splits as submission-critical until Pay.sh runtime behavior is clarified.

Start:

- Draft a concise maintainer question/repro if we need session/split support for the final demo.
- Move next to Pay-skills discovery draft using the working single-recipient charge endpoint.

### Plan refinement

For submission/demo, use the successful single-recipient Pay.sh sandbox charge flow. Keep capped sessions and split payments as documented roadmap/probe evidence unless Pay.sh maintainers confirm the retry behavior or we find a spec adjustment that completes the flow. Phase 4 should draft pay-skills discovery around the proven endpoint first, with sessions/splits marked as planned extensions.

## Phase 4 — Pay-skills discovery draft

### Expectation

A draft pay-skills provider entry exists so agents can discover Reddi Agent Protocol paid endpoints.

### Scenarios / guards

- Given an agent searches for x402/agent payments/specialist APIs, then Reddi Agent Protocol appears with concrete endpoint descriptions.
- Given usage notes are included, then they are helpful but cannot override system/user/tool instructions.
- Given pricing is listed, then it matches the provider spec.

### Implementation plan

- Draft provider metadata locally.
- Do not submit/open external PR without explicit approval.
- Include spend-aware usage notes.

### Validation

If CLI available:

```sh
pay skills build . --output /tmp/pay-skills-dist
pay skills probe . --files providers/<operator>/<name>.md --currencies USDC,USDT
pay skills validate . --files providers/<operator>/<name>.md
```

Fallback: static markdown/schema review.

### Retrospective

Write after first discovery draft validation.

### Plan refinement

If registry format differs, keep a local draft and request sponsor/maintainer confirmation.

## Phase 5 — Umbra private settlement expansion

### Expectation

The Pay.sh/`reddi-x402` flow can point to Umbra as a private settlement rail without claiming Umbra is Quasar-native.

### Scenarios / guards

- Given privacy mode is selected, then the docs route to Umbra as an SDK/privacy rail.
- Given Quasar proof is referenced, then it remains the public/auditable program-native path.
- Given Umbra is not live-smoked, then docs say planned/private-settlement expansion, not working live settlement.

### Implementation plan

- Keep Umbra adapter behind a separate feature flag / policy lane.
- Start with mocked SDK boundary before any devnet transaction.
- Only run devnet live smoke after local gates and explicit approval.

### Validation

- Unit/static checks first.
- Devnet smoke later, approval-gated.

### Retrospective

Write after first Umbra adapter boundary validation.

### Plan refinement

If Umbra integration is slower than expected, prioritize Pay.sh core demo for submission and leave Umbra as roadmap/prototype.

## Current next action

Begin Phase 0 now:

1. Add naming guard.
2. Fix active docs/memory wording.
3. Run naming/whitespace gates.
4. Write Phase 0 retrospective.
5. Move to Phase 1 provider-spec scaffold.

## Phase 4 — Pay-skills discovery metadata

### BDD scenario

Given the working `reddi-x402` single-recipient charge provider spec, when we sync it into Pay.sh skills registry markdown, then agents can discover the endpoint metadata without depending on handwritten registry structure.

### Implementation

- Use installed CLI path: `pay skills provider sync --operator redditech --origin reddi-agent-protocol --out providers --sandbox-service-url 'http://127.0.0.1:1402/{name}' config/pay-sh/reddi-x402-economic-demo-provider.yml`.
- Generated registry file: `providers/redditech/reddi-agent-protocol/reddi-x402-economic-demo-provider.md`.
- Guard: `npm run check:pay-skills:registry`.

### Retrospective

Installed `pay 0.16.0` does not expose the docs-ingested `pay skills build`, `pay skills probe`, or `pay skills validate` commands. It does expose `pay skills provider sync`, which generates registry markdown from runtime YAML. The hand-written registry draft was therefore replaced by generated output, and validation moved to repo-local static checks.

Keep:

- Runtime YAML remains source-of-truth.
- Registry markdown is generated/discovery metadata, not manually authored truth.
- Public publishing remains gated until the target pay-skills CLI/repo workflow is confirmed.

Stop:

- Assuming docs command names match the installed Homebrew CLI.

Start:

- Run `pay skills provider sync` as the registry update path for local evidence.
- Track CLI-version-dependent commands explicitly in retrospectives.

### Plan refinement

Next loop should package a maintainer-ready compatibility note: working single-recipient charge evidence, session/split 402-after-payment repro, installed CLI command differences, and the exact generated provider markdown path. That note can become a GitHub issue/PR body later, but do not publish externally without Nissan approval.

## Phase 5 — Compatibility note and maintainer-ready repro

### BDD scenario

Given the BDD loops have produced one working charge path and two extension blockers, when we package a compatibility note, then future agents and humans can resume from evidence instead of re-discovering CLI/runtime behavior.

### Implementation

- Note: `docs/PAYSH-REDDI-X402-COMPATIBILITY-NOTE-2026-05-07.md`.
- Includes working single-recipient charge path, session/split repros, CLI command differences, generated registry path, and a maintainer-ready question.

### Retrospective

The strongest artifact is not another speculative build step; it is a compatibility note that separates proven behavior from extension probes. This protects the final demo narrative and gives us a clean external question later without publishing prematurely.

Keep:

- Evidence-first claims.
- Maintainer questions as drafts until Nissan approves external posting.

Stop:

- Expanding Phase 3 until the retry behavior is understood.

Start:

- Use the compatibility note as the handoff artifact for Pay.sh integration decisions.

### Plan refinement

Next loop should move back into product-facing Reddi Agent Protocol demo integration: wire the working Pay.sh evidence into the economic-demo/readiness docs or UI, while clearly labelling sessions/splits as planned extensions.

## Phase 6 — Product-facing economic-demo evidence wiring

### BDD scenario

Given the Pay.sh single-recipient charge flow has proven HTTP 402 → sandbox payment → HTTP 200 receipt behavior, when a judge or operator opens the economic demo payment readiness panel, then the UI should show the proven `reddi-x402` evidence path and should label capped sessions/splits as extension probes, not final demo claims.

### Implementation

- Extended `lib/economic-demo/payment-readiness.ts` with `payShCompatibility` metadata:
  - package: `reddi-x402`
  - provider spec: `config/pay-sh/reddi-x402-economic-demo-provider.yml`
  - generated registry metadata: `providers/redditech/reddi-agent-protocol/reddi-x402-economic-demo-provider.md`
  - proven artifact: `artifacts/pay-sh-reddi-x402/20260507T064842Z/SUMMARY.md`
  - extension probes: capped sessions and split payments, both blocked by `pay_sh_0_16_returns_402_after_payment`
- Added a Pay.sh / `reddi-x402` compatibility panel inside `/economic-demo` payment readiness.
- Added the proven Pay.sh artifact to the local evidence list.
- Expanded `npm run check:product:naming` coverage to the economic demo UI/payment readiness files.

### Validation

- `npm run check:product:naming` — PASS across 11 files.
- `npm run check:pay-sh:provider-spec` — PASS.
- `npm run check:pay-skills:registry` — PASS.
- `npm run evidence:pay-sh:reddi-x402 -- artifacts/pay-sh-reddi-x402/20260507T064842Z` — PASS.
- `npx jest --runTestsByPath lib/__tests__/economic-demo-payment-readiness.test.ts --runInBand` — PASS 2/2.
- Targeted ESLint over changed UI/lib/test/script files — PASS.
- `npm run build` — PASS. Existing Turbopack broad filesystem tracing warnings remain unrelated to this slice.
- `git diff --check` — PASS.

### Retrospective

Keep:

- Show the working Pay.sh path directly in the demo instead of burying it in docs.
- Keep the extension-probe blocker visible so nobody accidentally claims session/split settlement.
- Guard naming in actual product-facing files, not just planning docs.

Stop:

- Using generic “x402 readiness” alone when the concrete proof is specifically Pay.sh sandbox compatibility for `reddi-x402`.

Start:

- Add a generated run-report/evidence-pack attachment for Pay.sh compatibility so the judge packet can consume the same metadata as the UI.

### Plan refinement

Next loop should wire Pay.sh compatibility into the generated economic demo run report or submission-prep artifact. That creates a single machine-readable evidence bundle for the UI, docs, and final packet while preserving the same claim boundary.

## Phase 7 — Generated run-report evidence bundle

### BDD scenario

Given the UI now surfaces Pay.sh / `reddi-x402` compatibility, when the economic demo run report is generated, then the report should include the same proven sandbox flow, registry metadata path, extension-probe blockers, and claim boundary for judge/evidence packet reuse.

### Implementation

- Extended `scripts/generate-economic-demo-run-report.mjs` to attach `payShReddix402Compatibility` from `artifacts/pay-sh-reddi-x402/20260507T064842Z/SUMMARY.json`.
- Attached extension-probe summaries from:
  - `artifacts/pay-sh-reddi-x402/20260507T065805Z-session-splits/SUMMARY.json`
  - `artifacts/pay-sh-reddi-x402/20260507T065908Z-splits/SUMMARY.json`
- Added a Pay.sh / `reddi-x402` section to generated `RUN-REPORT.md`.
- Generated latest artifact: `artifacts/economic-demo-run-report/20260507T072501Z/`.

### Validation

- `node --check scripts/generate-economic-demo-run-report.mjs` — PASS.
- `npm run report:economic-demo:run` — PASS, `payShReddix402Compatibility: true`.
- JSON assertions over latest `run-report.json` — PASS for package, HTTP statuses, receipt status, extension probes, and claim boundary.
- `npm run check:product:naming` — PASS across 11 files.
- `git diff --check` — PASS.

### Retrospective

Keep:

- One canonical evidence shape shared by UI, docs, and generated report.
- Explicit probe blockers in machine-readable artifacts, not only prose.

Stop:

- Letting the final run report omit Pay.sh evidence after the UI already claims it.

Start:

- Add submission-prep/judge packet checks that fail closed if Pay.sh evidence is missing or if session/split probes are represented as completed settlement.

### Plan refinement

Next loop should add a lightweight submission-prep guard for Pay.sh evidence boundaries: proven single-charge required, extension probes allowed only as `probe_only`, and no mainnet/Umbra/MagicBlock settlement claim from the Pay.sh lane.

## Phase 8 — Submission-prep Pay.sh boundary guard

### BDD scenario

Given Pay.sh compatibility is now visible in the UI and run report, when submission prep is generated and checked, then the prep pack must reference the proven `reddi-x402` evidence, must read a run report with `payShReddix402Compatibility`, and must fail closed if session/split probes are represented as completed settlement.

### Implementation

- Extended `scripts/generate-economic-demo-submission-prep.mjs` to include:
  - economic demo run report JSON
  - proven Pay.sh / `reddi-x402` summary
  - capped-session probe summary
  - split-payment probe summary
  - safe/not-safe Pay.sh claims
- Extended `scripts/check-economic-demo-submission-prep.mjs` to validate:
  - run report includes `payShReddix402Compatibility`
  - package is `reddi-x402`
  - proof status is `sandbox_http_402_to_pay_sh_200_receipt`
  - statuses are HTTP 402 → HTTP 200 with receipt success
  - claim boundary includes no-mainnet and no-MagicBlock-PER constraints
  - extension probes stay `probe_only` with `Server returned 402 again after payment`
  - safe-claims section does not overclaim Pay.sh session/split/mainnet/Umbra/MagicBlock settlement
- Generated latest prep artifact: `artifacts/economic-demo-submission-prep/20260507T072628Z/SUBMISSION-PREP.md`.

### Validation

- `node --check scripts/generate-economic-demo-submission-prep.mjs` — PASS.
- `node --check scripts/check-economic-demo-submission-prep.mjs` — PASS.
- `npm run generate:economic-demo:submission-prep` — PASS.
- `npm run check:economic-demo:submission-prep` — PASS, 12 evidence paths.
- `npm run check:product:naming` — PASS across 11 files.
- `git diff --check` — PASS.

### Retrospective

Keep:

- Submission prep should enforce evidence boundaries, not just list links.
- Safe claims and unsafe claims should be separated so the checker can inspect only the safe-claims section for overclaim patterns.

Stop:

- Treating `latest` symlinks as plain directories with `lstatSync`; use `statSync` when the target directory is what matters.

Start:

- Use this guard as the final packet gate before any public submission copy is produced.

### Plan refinement

Next loop should inspect the final submission/evidence packet surfaces and ensure they call the product Reddi Agent Protocol, package `reddi-x402`, and preserve the same Pay.sh/Quasar/MagicBlock/Jupiter claim boundaries.

## Phase 9 — Final packet claim-boundary audit

### BDD scenario

Given Pay.sh / `reddi-x402` evidence now appears in the UI, run report, and submission prep, when final recording/judge/showcase packet surfaces are audited, then they must consistently use the Reddi Agent Protocol product name and preserve Pay.sh, Quasar, MagicBlock, and Jupiter claim boundaries.

### Implementation

- Updated final packet, judge packet, proof hierarchy, and bounty showcase audit to include Pay.sh / `reddi-x402` evidence without overclaiming.
- Expanded product naming guard to cover those final packet surfaces.
- Added `scripts/check-submission-claim-boundaries.mjs` and npm script `check:submission:claim-boundaries`.
- Guard covers:
  - `artifacts/final-recording-packet-20260507.md`
  - `docs/ECONOMIC-DEMO-JUDGE-PACKET-2026-05-05.md`
  - `docs/ECONOMIC-DEMO-PROOF-HIERARCHY-2026-05-07.md`
  - `docs/HACKATHON-BOUNTY-SHOWCASE-AUDIT-2026-05-07.md`
  - `artifacts/economic-demo-submission-prep/latest/SUBMISSION-PREP.md` (generated symlink, not committed; the guard resolves the newest committed timestamped run — see `docs/PUBLIC-CLAIM-BOUNDARY.md` § Evidence artifacts that are not committed)

### Validation

- `npm run check:submission:claim-boundaries` — PASS, 5 files.
- `npm run check:product:naming` — PASS across 15 files.
- `node --check scripts/check-submission-claim-boundaries.mjs` — PASS.
- `git diff --check` — PASS.

### Retrospective

Keep:

- Boundary checks belong at the final packet layer, not only the implementation layer.
- Pay.sh / `reddi-x402` should be represented as strong sandbox charge compatibility, while sessions/splits remain probe-only.

Stop:

- Letting final recording packets point at stale run reports after new evidence is generated.

Start:

- Treat `check:submission:claim-boundaries` as part of the pre-recording/pre-submission gate.

### Plan refinement

Next loop should run the combined final gate set and, if it stays green, produce a concise current-state handoff for recording/submission. If any stale artifact path remains, refresh it before handoff.

## Phase 10 — Combined final gate and handoff

### BDD scenario

Given the UI, run report, submission prep, and final packet surfaces all include Pay.sh / `reddi-x402` evidence, when the combined final gate set runs, then all evidence and claim-boundary checks must pass before producing a recording/submission handoff.

### Validation

Initial combined gate set passed:

- `npm run check:product:naming` — PASS, 15 files.
- `npm run check:submission:claim-boundaries` — PASS, 5 packet surfaces.
- `npm run check:economic-demo:submission-prep` — PASS, 12 evidence paths.
- `npm run evidence:pay-sh:reddi-x402 -- artifacts/pay-sh-reddi-x402/20260507T064842Z` — PASS.
- `npm run report:economic-demo:run` — PASS, generated `artifacts/economic-demo-run-report/20260507T073104Z/` with `payShReddix402Compatibility=true`.
- `npm run test:bdd:index` — PASS.
- `npx jest --runTestsByPath lib/__tests__/economic-demo-payment-readiness.test.ts --runInBand` — PASS 2/2.
- `npm run check:quasar:submission` — PASS.

After the run-report step generated a newer artifact, submission prep was refreshed and the boundary checks were rerun:

- `npm run generate:economic-demo:submission-prep` — PASS, generated `artifacts/economic-demo-submission-prep/20260507T073116Z/`.
- `npm run check:economic-demo:submission-prep` — PASS.
- `npm run check:submission:claim-boundaries` — PASS.
- `npm run check:product:naming` — PASS.

### Handoff

Recording/submission handoff is drafted at `docs/RECORDING-SUBMISSION-HANDOFF-2026-05-07.md`.

### Retrospective

Keep:

- Always refresh submission prep after generating a newer run report.
- Final handoff should quote the latest artifacts, not just the latest committed script state.

Stop:

- Running run-report generation after submission-prep validation without a follow-up prep refresh.

Start:

- Treat the combined final gate set as the pre-recording checklist.

### Plan refinement

From an evidence-boundary perspective, the packet is ready for recording/submission handoff. Stronger proof now requires new approved external action: mainnet/Jupiter execution, Pay.sh maintainer clarification for session/split settlement, or deeper MagicBlock TEE compatibility work.

## Phase 11 — Single-command final recording gate

### BDD scenario

Given the combined final gate set is now known-good, when an operator wants to record or submit, then one command should run the safe pre-recording checks and confirm the latest submission prep points at a timestamped run report with Pay.sh / `reddi-x402` compatibility.

### Implementation

- Added `scripts/check-final-recording-submission.mjs`.
- Added npm script `check:final-recording`.
- The command runs:
  - product naming guard
  - final claim-boundary guard
  - submission-prep guard
  - Pay.sh / `reddi-x402` evidence generator
  - BDD index guard
  - payment-readiness Jest test
  - Quasar submission guard
- It also verifies the submission prep it resolves (the newest committed timestamped run, since the `latest` symlink is not committed) references a timestamped run report JSON and that the report includes `payShReddix402Compatibility`.

### Validation

- `node --check scripts/check-final-recording-submission.mjs` — PASS.
- `npm run check:final-recording` — PASS.
- Confirmed latest prep references `artifacts/economic-demo-run-report/20260507T073104Z/run-report.json` with proof status `sandbox_http_402_to_pay_sh_200_receipt`.

### Retrospective

Keep:

- A single pre-recording command reduces operator error.
- The final command should not generate fresh artifacts; generation order remains explicit so evidence timestamps do not drift unexpectedly.

Stop:

- Repeating long manual command chains in chat as the only source of truth.

Start:

- Use `npm run check:final-recording` before any recording/submission pass.

### Plan refinement

The final packet now has a stable pre-recording gate. Further autonomous work should shift from evidence-boundary hardening to either rehearsal/capture prep or an explicitly approved stronger-proof lane.

## Phase 12 — Umbra private-settlement adapter boundary carry-forward

### BDD scenario

Given Umbra was researched as the best secondary privacy-payments lane, when final packet surfaces describe the payment story, then they must include Umbra as a planned private x402 settlement adapter while explicitly avoiding any claim that Umbra SDK/devnet/private settlement has been executed.

### Implementation

- Updated final recording packet, judge packet, proof hierarchy, bounty showcase audit, and recording handoff to include Umbra.
- Framing: Umbra is the planned private-settlement adapter lane for future private x402 payments.
- Boundary: current evidence is architecture/bounty-fit analysis only; no SDK/devnet/live private settlement proof is claimed.
- Extended `check:submission:claim-boundaries` to require Umbra boundary language and reject unsafe Umbra execution claims.

### Validation

- `npm run check:submission:claim-boundaries` — PASS.
- `npm run check:product:naming` — PASS across 15 files.
- `node --check scripts/check-submission-claim-boundaries.mjs` — PASS.
- `git diff --check` — PASS.

### Retrospective

Keep:

- Nissan was right to flag this: Umbra was researched, but it had not been carried through the executable final-packet guard loop.
- Umbra belongs in the final story as a planned privacy rail, not as current proof.

Stop:

- Treating “planned lane” docs as enough if final packet/handoff/guards do not mention the lane.

Start:

- Add privacy-rail boundary checks before any future recording/submission pass.

### Plan refinement

Next useful Umbra work is a separate BDD lane: SDK feasibility spike with mocked adapter first, then approval-gated devnet smoke only after local tests pass. It should not block the current Quasar/Pay.sh recording handoff.
